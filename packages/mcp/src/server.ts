import {
	createMcpHandler,
	ProtocolError,
	ProtocolErrorCode,
	Server,
	type CallToolResult
} from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createApiClient, type Api, type ApiClientOptions, type UntypedApi } from './client.js';
import { ApiCallError, describeError, type ErrorHint } from './errors.js';
import type { ToolOutput } from './output.js';
import { indexOperations, type JsonSchema, type OperationIndex, type ScopeAction } from './spec.js';
import {
	annotationsFor,
	resolveInput,
	resolveOutput,
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

export interface McpServerOptions extends Omit<ApiClientOptions, 'apiKey'> {
	/**
	 * The key `listen` and `verify` send. `handle` never uses it: each HTTP request brings
	 * its own, so a remote caller can't borrow the server's.
	 */
	apiKey?: string;
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
	/**
	 * Browser origins `handle` accepts besides `baseUrl`'s, e.g. a web MCP inspector.
	 * Native clients send no `Origin` and are unaffected. `baseUrl` must be the
	 * configured origin, not one read from the request's `Host`, or a rebinding page passes.
	 * A host that only has the request's origin screens with `refuseEarly` first.
	 */
	allowedOrigins?: string[];
	/**
	 * Every action the request's key may perform, read through the host's API. With it,
	 * `tools/list` leaves out tools the key can't use and a call to one gets an
	 * `insufficient_scope` 403. The host decides what implies what: return `read` for a
	 * `solve` key if `solve` includes it. A 401 from the host becomes a 401 here.
	 */
	grantedActions?: (api: UntypedApi) => Promise<Iterable<ScopeAction>>;
	/** Advertised on 401 and 403, so OAuth clients can find the authorization server. */
	challenge?: { resourceMetadataUrl: string; scopes: string[] };
}

interface ResolvedTool {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason as `McpServerOptions.tools`
	def: ToolDefinition<any, any>;
	input: ResolvedInput;
	output?: JsonSchema;
	annotations: Annotations;
	/** The scope actions its calls need, all of which the key must hold. */
	actions: ScopeAction[];
}

const HEARTBEAT_MS = 15_000;
// A key's scopes never change, so this only bounds how long a revoked key keeps
// its tool list. Its calls still fail at /api/v1 immediately.
const GRANTS_TTL_MS = 60_000;
const GRANTS_MAX = 1_000;
// Tools change on deploy, not per call. Private: the list varies by key.
const TOOLS_LIST_CACHE = { ttlMs: 300_000, cacheScope: 'private' } as const;

export interface SelvaMcpServer {
	/** Checks every tool's calls against the live spec: same operations, same scopes. */
	verify(): Promise<void>;
	/** Serves over stdio after `verify` passes. */
	listen(options: { transport: 'stdio'; verify?: boolean }): Promise<void>;
	/**
	 * Answers one streamable-HTTP request, stateless, with the request's own bearer key.
	 * Without one it answers 401. Mount it at `/mcp`. `fetch` overrides the configured one
	 * for this request, for hosts whose fetch is bound to the incoming request.
	 */
	handle(request: Request, overrides?: { fetch?: typeof fetch }): Promise<Response>;
}

export function createMcpServer(options: McpServerOptions): SelvaMcpServer {
	const spec = indexOperations(options.openapi);
	const tools = resolveTools(options.tools, spec);
	for (const r of options.resources ?? []) checkCalls(`resource ${r.uri}`, r.calls, spec);

	/** `visible` limits which tools this request sees; undefined means all of them. */
	function build(apiKey: string, fetch = options.fetch, visible?: ReadonlySet<string>): Server {
		const clientOptions = { ...options, apiKey, fetch };
		// No key may reach the model, even echoed back inside an upstream message.
		const keys = [apiKey, ...(options.apiKey ? [options.apiKey] : [])];
		const redact = (text: string) =>
			keys.reduce((out, key) => out.split(key).join('[redacted]'), text);

		function toResult(out: ToolOutput): CallToolResult {
			return {
				content: [
					{ type: 'text', text: redact(out.text) },
					...(out.images ?? []).map(({ data, mimeType }) => ({
						type: 'image' as const,
						data,
						mimeType
					}))
				],
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

		const server = new Server(
			{ name: options.name, version: options.version },
			{
				capabilities: {
					tools: {},
					...(options.resources?.length && { resources: {} }),
					...(options.prompts?.length && { prompts: {} })
				},
				instructions: options.instructions,
				cacheHints: { 'tools/list': TOOLS_LIST_CACHE }
			}
		);

		const listed = [...tools.values()].filter((t) => !visible || visible.has(t.def.name));

		server.setRequestHandler('tools/list', () => ({
			tools: listed.map(({ def, input, output, annotations }) => ({
				name: def.name,
				title: def.title,
				description: def.description,
				inputSchema: input.schema as { type: 'object' },
				...(output && { outputSchema: output as { type: 'object' } }),
				annotations: { title: def.title, ...annotations }
			}))
		}));

		server.setRequestHandler('tools/call', async (req, ctx): Promise<CallToolResult> => {
			const resolved = tools.get(req.params.name);
			// A protocol error, not a tool result: the model can't fix a name the server never offered.
			if (!resolved || (visible && !visible.has(resolved.def.name))) {
				throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown tool ${req.params.name}`);
			}

			const token = ctx.mcpReq._meta?.progressToken;
			const started = Date.now();
			let tick = 0;
			// Solves hold the request open for minutes; without a heartbeat some clients give up.
			const heartbeat =
				token === undefined
					? undefined
					: setInterval(() => {
							void ctx.mcpReq
								.notify({
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
				const api = createApiClient(spec, clientOptions, new Set(resolved.def.calls));
				const args: unknown = resolved.input.parse(req.params.arguments ?? {});
				const out = await resolved.def.run(api, args, { signal: ctx.mcpReq.signal, spec });
				return toResult(typeof out === 'string' ? { text: out } : out);
			} catch (err) {
				return errorResult(describe(err, resolved.def.errorHint ?? options.errorHint));
			} finally {
				clearInterval(heartbeat);
			}
		});

		if (options.resources?.length) {
			const resources = options.resources;
			server.setRequestHandler('resources/list', () => ({
				resources: resources.map(({ uri, name, description, mimeType }) => ({
					uri,
					name,
					description,
					mimeType
				}))
			}));
			server.setRequestHandler('resources/read', async (req) => {
				const resource = resources.find((r) => r.uri === req.params.uri);
				if (!resource) {
					throw new ProtocolError(
						ProtocolErrorCode.InvalidParams,
						`Unknown resource ${req.params.uri}`
					);
				}
				const api = createApiClient(spec, clientOptions, new Set(resource.calls));
				const text = redact(await resource.read(api));
				return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text }] };
			});
		}

		if (options.prompts?.length) {
			const prompts = options.prompts;
			server.setRequestHandler('prompts/list', () => ({
				prompts: prompts.map(({ name, description, arguments: args }) => ({
					name,
					description,
					arguments: args
				}))
			}));
			server.setRequestHandler('prompts/get', (req) => {
				const prompt = prompts.find((p) => p.name === req.params.name);
				if (!prompt) {
					throw new ProtocolError(
						ProtocolErrorCode.InvalidParams,
						`Unknown prompt ${req.params.name}`
					);
				}
				const text = prompt.render(req.params.arguments ?? {});
				return { messages: [{ role: 'user', content: { type: 'text', text } }] };
			});
		}

		return server;
	}

	function configuredKey(): string {
		if (!options.apiKey) throw new Error('`listen` and `verify` need `apiKey`');
		return options.apiKey;
	}

	async function verify(): Promise<void> {
		const doFetch = options.fetch ?? fetch;
		const url = options.baseUrl.replace(/\/$/, '') + (options.specPath ?? '/api/v1/openapi.json');
		const res = await doFetch(url, { headers: { Authorization: `Bearer ${configuredKey()}` } });
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

	const grants = new Map<string, { at: number; actions: Promise<Set<ScopeAction>> }>();

	/** Tool names the key may use, or undefined when the host doesn't say. */
	async function visibleTools(apiKey: string, fetch?: typeof globalThis.fetch) {
		if (!options.grantedActions) return undefined;
		const id = await sha256(apiKey);
		let entry = grants.get(id);
		if (!entry || Date.now() - entry.at > GRANTS_TTL_MS) {
			const api = createApiClient(spec, { ...options, apiKey, fetch: fetch ?? options.fetch });
			entry = { at: Date.now(), actions: options.grantedActions(api).then((a) => new Set(a)) };
			if (grants.size >= GRANTS_MAX) grants.delete(grants.keys().next().value!);
			grants.set(id, entry);
			// A failure isn't remembered: the next request asks again.
			entry.actions.catch(() => grants.delete(id));
		}
		const granted = await entry.actions;
		return new Set(
			[...tools.values()]
				.filter((t) => t.actions.every((a) => granted.has(a)))
				.map((t) => t.def.name)
		);
	}

	/** The tool a `tools/call` body names, when the server has one by that name. */
	async function calledTool(request: Request): Promise<ResolvedTool | undefined> {
		const message = (await request
			.clone()
			.json()
			.catch(() => null)) as { method?: string; params?: { name?: unknown } } | null;
		if (message?.method !== 'tools/call' || typeof message.params?.name !== 'string') return;
		return tools.get(message.params.name);
	}

	// Not the request's own URL: under DNS rebinding that is the attacker's name.
	const trusted = new Set([new URL(options.baseUrl).origin, ...(options.allowedOrigins ?? [])]);

	// One handler for every request; the key and fetch ride in `authInfo`, which the
	// SDK passes through to the factory untouched. 2025-era clients are served statelessly.
	const http = createMcpHandler(({ authInfo }) =>
		build(
			authInfo!.token,
			authInfo!.extra?.fetch as typeof fetch | undefined,
			authInfo!.extra?.visible as Set<string> | undefined
		)
	);

	return {
		verify,
		async listen({ verify: check = true }) {
			const apiKey = configuredKey();
			if (check) await verify();
			serveStdio(() => build(apiKey));
		},
		async handle(request, overrides) {
			const refused = refuseEarly(request, {
				trustedOrigins: trusted,
				challenge: options.challenge
			});
			if (refused) return refused;
			const apiKey = bearerOf(request)!;
			const fetch = overrides?.fetch ?? options.fetch;

			let visible: Set<string> | undefined;
			try {
				visible = await visibleTools(apiKey, fetch);
			} catch (err) {
				if (err instanceof ApiCallError && err.status === 401) {
					return keyRequired(options.challenge, 'invalid_token');
				}
				// Anything else: list every tool and let /api/v1 refuse what the key can't do.
			}
			if (visible) {
				const called = await calledTool(request);
				if (called && !visible.has(called.def.name)) {
					return insufficientScope(called.actions, options.challenge);
				}
			}

			return http.fetch(request, {
				authInfo: { token: apiKey, clientId: 'bearer', scopes: [], extra: { fetch, visible } }
			});
		}
	};
}

/**
 * The refusals `handle` makes before any work: a browser origin outside
 * `trustedOrigins`, or no Selva key. A host that builds a server per request
 * origin calls this first, with its configured origins, so an anonymous request
 * can't make it build one.
 */
export function refuseEarly(
	request: Request,
	{ trustedOrigins, challenge }: { trustedOrigins: ReadonlySet<string>; challenge?: Challenge }
): Response | undefined {
	// DNS rebinding: a page on another origin that resolves to this host.
	const origin = request.headers.get('Origin');
	if (origin && !trustedOrigins.has(origin)) return originRefused();
	// Anything else would reach /api/v1 as "no key" and, on a host whose fetch
	// forwards cookies, run as the browser session instead.
	if (!bearerOf(request)?.startsWith(API_KEY_PREFIX)) return keyRequired(challenge);
	return undefined;
}

function bearerOf(request: Request): string | undefined {
	return /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
}

/** The prefix every Selva API token carries (`API_TOKEN_PREFIX` in `@selvajs/server/tokens`). */
const API_KEY_PREFIX = 'selva_';

function originRefused(): Response {
	return new Response(
		JSON.stringify({
			jsonrpc: '2.0',
			error: { code: -32600, message: 'Origin not allowed' }
		}),
		{ status: 403, headers: { 'Content-Type': 'application/json' } }
	);
}

type Challenge = McpServerOptions['challenge'];

function bearerChallenge(params: [string, string | undefined][]): string {
	const set = params.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`);
	return set.length ? `Bearer ${set.join(', ')}` : 'Bearer';
}

function keyRequired(challenge: Challenge, error?: 'invalid_token'): Response {
	return new Response(
		JSON.stringify({
			message: 'Send a Selva API key as `Authorization: Bearer selva_…`.',
			code: 'UNAUTHORIZED'
		}),
		{
			status: 401,
			headers: {
				'Content-Type': 'application/json',
				'WWW-Authenticate': bearerChallenge([
					['error', error],
					['resource_metadata', challenge?.resourceMetadataUrl],
					['scope', challenge?.scopes.join(' ')]
				])
			}
		}
	);
}

/** Every scope the tool needs in one challenge, so the client re-authorizes once. */
function insufficientScope(actions: ScopeAction[], challenge: Challenge): Response {
	const needed = [...new Set(['read', ...actions])].join(' ');
	return new Response(
		JSON.stringify({
			message: `This key lacks the scopes this tool needs: ${needed}.`,
			code: 'FORBIDDEN'
		}),
		{
			status: 403,
			headers: {
				'Content-Type': 'application/json',
				'WWW-Authenticate': bearerChallenge([
					['error', 'insufficient_scope'],
					['scope', needed],
					['resource_metadata', challenge?.resourceMetadataUrl]
				])
			}
		}
	);
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function resolveTools(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason as `McpServerOptions.tools`
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
			output: def.output && resolveOutput(def.output),
			annotations: annotationsFor(def.calls, spec),
			actions: [...new Set(def.calls.map((id) => spec.get(id)!.scope))]
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
