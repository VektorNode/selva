import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
	type CallToolResult
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createApiClient, type Api, type ApiClientOptions } from './client.js';
import { ApiCallError, describeError, type ErrorHint } from './errors.js';
import type { ToolOutput } from './output.js';
import { indexOperations, type OperationIndex } from './spec.js';
import {
	annotationsFor,
	resolveInput,
	type Annotations,
	type ResolvedInput,
	type ToolDefinition
} from './tool.js';

export interface ResourceDefinition {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
	calls: string[];
	read(api: Api): Promise<string>;
}

export interface PromptDefinition {
	name: string;
	description?: string;
	arguments?: { name: string; description?: string; required?: boolean }[];
	render(args: Record<string, string>): string;
}

export interface McpServerOptions extends ApiClientOptions {
	name: string;
	version: string;
	/** Read by clients as the server's system prompt: conventions every tool shares. */
	instructions?: string;
	/** The host's own spec, imported at build time. */
	openapi: unknown;
	// `any`: each tool binds its own `Ops` and `Args`, and a list of them has no common type.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tools: ToolDefinition<any, any>[];
	resources?: ResourceDefinition[];
	prompts?: PromptDefinition[];
	errorHint?: ErrorHint;
	/** Where the live spec is served, for `verify`. Default `/api/v1/openapi.json`. */
	specPath?: string;
}

interface ResolvedTool {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	def: ToolDefinition<any, any>;
	input: ResolvedInput;
	annotations: Annotations;
}

const HEARTBEAT_MS = 15_000;

export interface SelvaMcpServer {
	/** Checks every tool's calls against the live spec: same operations, same scopes. */
	verify(): Promise<void>;
	/** Serves over stdio after `verify` passes. */
	listen(options: { transport: 'stdio'; verify?: boolean }): Promise<void>;
	/** Answers one streamable-HTTP request, stateless. Mount it at `/mcp`. */
	handle(request: Request): Promise<Response>;
}

export function createMcpServer(options: McpServerOptions): SelvaMcpServer {
	const spec = indexOperations(options.openapi);
	const tools = resolveTools(options.tools, spec);
	for (const r of options.resources ?? []) checkCalls(`resource ${r.uri}`, r.calls, spec);

	function build(): Server {
		const server = new Server(
			{ name: options.name, version: options.version },
			{
				capabilities: {
					tools: {},
					...(options.resources?.length && { resources: {} }),
					...(options.prompts?.length && { prompts: {} })
				},
				instructions: options.instructions
			}
		);

		server.setRequestHandler(ListToolsRequestSchema, () => ({
			tools: [...tools.values()].map(({ def, input, annotations }) => ({
				name: def.name,
				title: def.title,
				description: def.description,
				inputSchema: input.schema as { type: 'object' },
				annotations: { title: def.title, ...annotations }
			}))
		}));

		server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
			const resolved = tools.get(req.params.name);
			if (!resolved) return errorResult(`Unknown tool ${req.params.name}.`);

			const token = extra._meta?.progressToken;
			const started = Date.now();
			let tick = 0;
			// Solves hold the request open for minutes; without a heartbeat some clients give up.
			const heartbeat =
				token === undefined
					? undefined
					: setInterval(() => {
							void extra
								.sendNotification({
									method: 'notifications/progress',
									params: {
										progressToken: token,
										progress: ++tick,
										message: `Still working (${Math.round((Date.now() - started) / 1000)}s)`
									}
								})
								.catch(() => {});
						}, HEARTBEAT_MS);

			try {
				const api = createApiClient(spec, options, new Set(resolved.def.calls));
				const args: unknown = resolved.input.parse(req.params.arguments ?? {});
				const out = await resolved.def.run(api, args, { signal: extra.signal, spec });
				return toResult(typeof out === 'string' ? { text: out } : out);
			} catch (err) {
				return errorResult(describe(err, resolved.def.errorHint ?? options.errorHint));
			} finally {
				clearInterval(heartbeat);
			}
		});

		if (options.resources?.length) {
			const resources = options.resources;
			server.setRequestHandler(ListResourcesRequestSchema, () => ({
				resources: resources.map(({ uri, name, description, mimeType }) => ({
					uri,
					name,
					description,
					mimeType
				}))
			}));
			server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
				const resource = resources.find((r) => r.uri === req.params.uri);
				if (!resource) throw new Error(`Unknown resource ${req.params.uri}`);
				const api = createApiClient(spec, options, new Set(resource.calls));
				const text = redact(await resource.read(api));
				return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] };
			});
		}

		if (options.prompts?.length) {
			const prompts = options.prompts;
			server.setRequestHandler(ListPromptsRequestSchema, () => ({
				prompts: prompts.map(({ name, description, arguments: args }) => ({
					name,
					description,
					arguments: args
				}))
			}));
			server.setRequestHandler(GetPromptRequestSchema, (req) => {
				const prompt = prompts.find((p) => p.name === req.params.name);
				if (!prompt) throw new Error(`Unknown prompt ${req.params.name}`);
				const text = prompt.render(req.params.arguments ?? {});
				return { messages: [{ role: 'user', content: { type: 'text', text } }] };
			});
		}

		return server;
	}

	// The key must never reach the model, even echoed back inside an upstream message.
	function redact(text: string): string {
		return options.apiKey ? text.split(options.apiKey).join('[redacted]') : text;
	}

	function toResult(out: ToolOutput): CallToolResult {
		return {
			content: [{ type: 'text', text: redact(out.text) }],
			...(out.structured && {
				structuredContent: JSON.parse(redact(JSON.stringify(out.structured))) as Record<
					string,
					unknown
				>
			})
		};
	}

	function errorResult(text: string): CallToolResult {
		return { isError: true, content: [{ type: 'text', text: redact(text) }] };
	}

	async function verify(): Promise<void> {
		const doFetch = options.fetch ?? fetch;
		const url = options.baseUrl.replace(/\/$/, '') + (options.specPath ?? '/api/v1/openapi.json');
		const res = await doFetch(url, { headers: { Authorization: `Bearer ${options.apiKey}` } });
		if (!res.ok)
			throw new Error(`Could not read the host's API document at ${url}: HTTP ${res.status}`);
		const live = indexOperations(await res.json());

		const problems: string[] = [];
		const calls = new Set([
			...options.tools.flatMap((t) => t.calls),
			...(options.resources ?? []).flatMap((r) => r.calls)
		]);
		for (const id of calls) {
			const want = spec.get(id)!;
			const have = live.get(id);
			if (!have) problems.push(`${id} is missing`);
			else if (have.scope !== want.scope)
				problems.push(`${id} needs \`${have.scope}\`, not \`${want.scope}\``);
			else if (have.method !== want.method || have.path !== want.path) {
				problems.push(`${id} moved to ${have.method} ${have.path}`);
			}
		}
		if (problems.length) {
			throw new Error(
				`This MCP server does not match the host at ${options.baseUrl}; upgrade whichever is older.\n` +
					problems.join('\n')
			);
		}
	}

	return {
		verify,
		async listen({ verify: check = true }) {
			if (check) await verify();
			await build().connect(new StdioServerTransport());
		},
		async handle(request) {
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: undefined
			});
			await build().connect(transport);
			return transport.handleRequest(request);
		}
	};
}

function resolveTools(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	defs: ToolDefinition<any, any>[],
	spec: OperationIndex
): Map<string, ResolvedTool> {
	const tools = new Map<string, ResolvedTool>();
	for (const def of defs) {
		if (tools.has(def.name)) throw new Error(`Two tools are named ${def.name}`);
		if (!def.calls.length) throw new Error(`Tool ${def.name} declares no \`calls\``);
		checkCalls(`tool ${def.name}`, def.calls, spec);
		tools.set(def.name, {
			def,
			input: resolveInput(def.input, spec),
			annotations: annotationsFor(def.calls, spec)
		});
	}
	return tools;
}

function checkCalls(owner: string, calls: string[], spec: OperationIndex): void {
	for (const id of calls) {
		const op = spec.get(id);
		if (!op) throw new Error(`${owner} calls ${id}, which is not in the host's OpenAPI document`);
		// Internal operations carry no stability promise; a tool built on one breaks silently.
		if (op.internal) throw new Error(`${owner} calls ${id}, which is x-internal`);
	}
}

function describe(err: unknown, hint?: ErrorHint): string {
	if (err instanceof ApiCallError) return describeError(err, hint);
	if (err instanceof z.ZodError) {
		const issues = err.issues.map((i) => `  ${i.path.join('.') || '(input)'}: ${i.message}`);
		return ['Invalid arguments:', ...issues, 'Fix them and call again.'].join('\n');
	}
	return err instanceof Error ? err.message : String(err);
}
