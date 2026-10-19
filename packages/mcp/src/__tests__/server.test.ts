import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiCallError } from '../errors.js';
import { createMcpServer, type McpServerOptions } from '../server.js';
import { fromOperation, inputFrom, tool } from '../tool.js';
import { KEY, SPEC, fakeFetch, json } from './fixtures.js';

const getOrder = fromOperation('getOrdersById', {
	name: 'get_order',
	description: 'One order.',
	shape: (body) => `Order ${(body as { name: string }).name}`
});
const listOrders = fromOperation('getOrders', { name: 'list_orders', description: 'Orders.' });
const createOrder = tool({
	name: 'create_order',
	description: 'Create, or return the one with this ERP ref.',
	input: inputFrom('postOrders', { extend: { externalRef: { type: 'string' } } }),
	calls: ['getOrders', 'postOrders'],
	async run(api, args) {
		const { externalRef, ...body } = args;
		const found = (await api.call('getOrders', { query: { externalRef } })) as { items: unknown[] };
		if (found.items.length) return 'exists';
		await api.call('postOrders', { body });
		return 'created';
	}
});
const release = tool({
	name: 'release_job',
	description: 'Solve and release.',
	input: z.object({ id: z.string() }),
	calls: ['postJobsByIdSolve'],
	run: async (api, { id }) => {
		await api.call('postJobsByIdSolve', { params: { id } });
		return `Released ${id}, key ${KEY}`;
	}
});
const deleteOrder = fromOperation('deleteOrdersById', { name: 'delete_order' });

function serve(
	responses: (Response | Error)[],
	tools = [getOrder, listOrders, createOrder, release, deleteOrder]
) {
	const f = fakeFetch(responses);
	const server = createMcpServer({
		name: 'test',
		version: '0.0.0',
		baseUrl: 'https://host',
		apiKey: KEY,
		fetch: f.fetch,
		openapi: SPEC,
		tools
	});
	return { server, calls: f.calls };
}

function mcpRequest(method: string, params: unknown, key?: string) {
	return new Request('https://host/mcp', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			...(key && { Authorization: `Bearer ${key}` })
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	});
}

/** One JSON-RPC request through the streamable-HTTP handler, SSE reply parsed. */
async function rpc(
	server: ReturnType<typeof createMcpServer>,
	method: string,
	params: unknown = {},
	key = KEY
) {
	const res = await server.handle(mcpRequest(method, params, key));
	const text = await res.text();
	const data = text
		.split('\n')
		.filter((l) => l.startsWith('data:'))
		.map((l) => JSON.parse(l.slice(5)) as { result?: Record<string, unknown>; error?: unknown })
		.find((m) => 'result' in m || 'error' in m);
	return data!.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON-RPC results are untyped; each test reads its own shape
}

/** A `2026-07-28` request: version and identity in `_meta`, routing headers mirrored. */
function modernRequest(method: string, params: Record<string, unknown>, key = KEY) {
	return new Request('https://host/mcp', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${key}`,
			'MCP-Protocol-Version': '2026-07-28',
			'Mcp-Method': method,
			...(typeof params.name === 'string' && { 'Mcp-Name': params.name })
		},
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method,
			params: {
				...params,
				_meta: {
					'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' },
					'io.modelcontextprotocol/clientCapabilities': {}
				}
			}
		})
	});
}

async function body(res: Response) {
	const text = await res.text();
	const line = text.split('\n').find((l) => l.startsWith('data:'));
	return JSON.parse(line ? line.slice(5) : text) as {
		result?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- as in `rpc`
		error?: { code: number; message: string };
	};
}

describe('createMcpServer', () => {
	it('serves protocol 2026-07-28 with a private cache hint on tools/list', async () => {
		const { server } = serve([json({ ok: true })]);
		const list = await body(await server.handle(modernRequest('tools/list', {})));
		expect(list.result?.tools.map((t: { name: string }) => t.name)).toContain('release_job');
		expect(list.result).toMatchObject({ ttlMs: 300_000, cacheScope: 'private' });
		const call = await body(
			await server.handle(
				modernRequest('tools/call', { name: 'release_job', arguments: { id: 'j1' } })
			)
		);
		expect(call.result?.content[0].text).toBe('Released j1, key [redacted]');
	});

	it('refuses a browser Origin it does not know, and allows its own and listed ones', async () => {
		const f = fakeFetch([json({ items: [] }), json({ items: [] }), json({ items: [] })]);
		const server = createMcpServer({
			name: 'test',
			version: '0.0.0',
			baseUrl: 'https://host',
			fetch: f.fetch,
			openapi: SPEC,
			tools: [listOrders],
			allowedOrigins: ['https://inspector.test']
		});
		const withOrigin = (origin?: string) => {
			const req = mcpRequest('tools/call', { name: 'list_orders', arguments: {} }, KEY);
			if (origin) req.headers.set('Origin', origin);
			return server.handle(req);
		};
		const evil = await withOrigin('https://evil.test');
		expect(evil.status).toBe(403);
		expect(await evil.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32600 } });
		expect(f.calls).toHaveLength(0);
		expect((await withOrigin('https://host')).status).toBe(200);
		expect((await withOrigin('https://inspector.test')).status).toBe(200);
		expect((await withOrigin()).status).toBe(200);

		// DNS rebinding: the request's own URL is the attacker's name, so it proves nothing.
		const rebound = new Request('https://rebound.test/mcp', mcpRequest('tools/list', {}, KEY));
		rebound.headers.set('Origin', 'https://rebound.test');
		expect((await server.handle(rebound)).status).toBe(403);
	});

	it('points a 401 at the resource metadata and names the scopes to ask for', async () => {
		const server = createMcpServer({
			name: 'test',
			version: '0.0.0',
			baseUrl: 'https://host',
			openapi: SPEC,
			tools: [getOrder],
			challenge: {
				resourceMetadataUrl: 'https://host/.well-known/oauth-protected-resource/mcp',
				scopes: ['read', 'solve']
			}
		});
		const res = await server.handle(mcpRequest('tools/list', {}));
		expect(res.status).toBe(401);
		expect(res.headers.get('WWW-Authenticate')).toBe(
			'Bearer resource_metadata="https://host/.well-known/oauth-protected-resource/mcp", scope="read solve"'
		);
	});

	describe('with grantedActions', () => {
		function scoped(grantedActions: McpServerOptions['grantedActions']) {
			const f = fakeFetch([json({ ok: true })]);
			const server = createMcpServer({
				name: 'test',
				version: '0.0.0',
				baseUrl: 'https://host',
				fetch: f.fetch,
				openapi: SPEC,
				tools: [getOrder, release],
				grantedActions,
				challenge: { resourceMetadataUrl: 'https://host/prm', scopes: ['read', 'solve'] }
			});
			return { server, calls: f.calls };
		}

		it('lists only the tools the key can use', async () => {
			const { server } = scoped(async () => ['read']);
			const { tools } = await rpc(server, 'tools/list');
			expect(tools.map((t: { name: string }) => t.name)).toEqual(['get_order']);
		});

		it('answers a call to a tool beyond the key with an insufficient_scope 403', async () => {
			const { server, calls } = scoped(async () => ['read']);
			const res = await server.handle(
				mcpRequest('tools/call', { name: 'release_job', arguments: { id: 'j1' } }, KEY)
			);
			expect(res.status).toBe(403);
			expect(res.headers.get('WWW-Authenticate')).toBe(
				'Bearer error="insufficient_scope", scope="read solve", resource_metadata="https://host/prm"'
			);
			expect(calls).toHaveLength(0);
		});

		it('runs the tool when the key covers it', async () => {
			const { server } = scoped(async () => ['read', 'solve']);
			const ok = await rpc(server, 'tools/call', { name: 'release_job', arguments: { id: 'j1' } });
			expect(ok.content[0].text).toBe('Released j1, key [redacted]');
		});

		it('turns a key the host rejects into a 401, so OAuth clients sign in again', async () => {
			const { server } = scoped(async () => {
				throw new ApiCallError('getMe', 401, 'UNAUTHORIZED', 'expired');
			});
			const res = await server.handle(mcpRequest('tools/list', {}, KEY));
			expect(res.status).toBe(401);
			expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
		});
	});

	it('declares an output schema from Zod or JSON Schema', async () => {
		const sized = tool({
			name: 'sized',
			description: 'A size.',
			input: z.object({}),
			output: z.object({ width: z.number() }),
			calls: ['getOrders'],
			run: async () => ({ text: '3', structured: { width: 3 } })
		});
		const listed = fromOperation('getOrders', {
			name: 'listed',
			output: { type: 'object', properties: { items: { type: 'array' } } }
		});
		const { server } = serve([], [sized, listed]);
		const { tools } = await rpc(server, 'tools/list');
		const schemas = Object.fromEntries(
			(tools as { name: string; outputSchema?: object }[]).map((t) => [t.name, t.outputSchema])
		);
		expect(schemas.sized).toMatchObject({
			type: 'object',
			properties: { width: { type: 'number' } },
			required: ['width']
		});
		expect(schemas.listed).toEqual({ type: 'object', properties: { items: { type: 'array' } } });
	});

	it('answers an unknown tool with a protocol error, not a tool result', async () => {
		const { server } = serve([]);
		const res = await body(await server.handle(mcpRequest('tools/call', { name: 'nope' }, KEY)));
		expect(res.error).toMatchObject({ code: -32602 });
	});

	it('derives annotations from each tool’s calls', async () => {
		const { server } = serve([]);
		const { tools } = await rpc(server, 'tools/list');
		const byName = Object.fromEntries(
			(tools as { name: string; annotations: object }[]).map((t) => [t.name, t.annotations])
		);
		expect(byName.get_order).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false
		});
		expect(byName.create_order).toMatchObject({ readOnlyHint: false, idempotentHint: false });
		expect(byName.release_job).toMatchObject({ openWorldHint: true, idempotentHint: false });
		expect(byName.delete_order).toMatchObject({ destructiveHint: true });
	});

	it('flattens path, query and body into one input schema', async () => {
		const { server } = serve([]);
		const { tools } = await rpc(server, 'tools/list');
		const create = (
			tools as { name: string; inputSchema: { properties: object; required: string[] } }[]
		).find((t) => t.name === 'create_order')!;
		expect(Object.keys(create.inputSchema.properties).sort()).toEqual([
			'externalRef',
			'name',
			'notes'
		]);
		expect(create.inputSchema.required).toEqual(['name']);
	});

	it('runs a shaped tool, and returns the raw body on detail: full', async () => {
		const { server, calls } = serve([json({ name: 'A' }), json({ name: 'A', id: '1' })]);
		const shaped = await rpc(server, 'tools/call', { name: 'get_order', arguments: { id: '1' } });
		expect(shaped.content[0].text).toBe('Order A');
		const full = await rpc(server, 'tools/call', {
			name: 'get_order',
			arguments: { id: '1', detail: 'full' }
		});
		expect(full.structuredContent).toEqual({ name: 'A', id: '1' });
		expect(calls[0].url).toBe('https://host/api/v1/orders/1');
	});

	it('pages list operations with a small default', async () => {
		const { server, calls } = serve([json({ items: [] })]);
		await rpc(server, 'tools/call', { name: 'list_orders', arguments: {} });
		expect(calls[0].url).toBe('https://host/api/v1/orders?limit=20');
	});

	it('returns API failures as tool results with the next step', async () => {
		const { server } = serve([json({ message: 'nope', code: 'NOT_FOUND' }, 404)]);
		const result = await rpc(server, 'tools/call', { name: 'get_order', arguments: { id: 'x' } });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/404 NOT_FOUND: nope[\s\S]*list tool/);
	});

	it('validates Zod inputs and never echoes the key', async () => {
		const { server } = serve([json({ ok: true })]);
		const bad = await rpc(server, 'tools/call', { name: 'release_job', arguments: {} });
		expect(bad.isError).toBe(true);
		expect(bad.content[0].text).toMatch(/Invalid arguments/);
		const ok = await rpc(server, 'tools/call', { name: 'release_job', arguments: { id: 'j1' } });
		expect(ok.content[0].text).toBe('Released j1, key [redacted]');
	});

	it('returns pictures after the text', async () => {
		const plan = tool({
			name: 'plan',
			description: 'The plan.',
			input: z.object({}),
			calls: ['getOrders'],
			run: async () => ({ text: 'Plan', images: [{ data: 'iVBORw0K', mimeType: 'image/png' }] })
		});
		const { server } = serve([], [plan]);
		const result = await rpc(server, 'tools/call', { name: 'plan', arguments: {} });
		expect(result.content).toEqual([
			{ type: 'text', text: 'Plan' },
			{ type: 'image', data: 'iVBORw0K', mimeType: 'image/png' }
		]);
	});

	it('answers HTTP as each request’s own key, never the configured one', async () => {
		const f = fakeFetch([json({ ok: true }), json({ ok: true })]);
		const server = createMcpServer({
			name: 'test',
			version: '0.0.0',
			baseUrl: 'https://host',
			apiKey: KEY,
			fetch: f.fetch,
			openapi: SPEC,
			tools: [release]
		});
		const call = { name: 'release_job', arguments: { id: 'j1' } };

		const anonymous = await server.handle(mcpRequest('tools/call', call));
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get('WWW-Authenticate')).toBe('Bearer');
		// A bearer that isn't a Selva key must not fall through to "no key".
		const junk = await server.handle(mcpRequest('tools/call', call, 'not-a-key'));
		expect(junk.status).toBe(401);
		expect(f.calls).toHaveLength(0);

		const a = await rpc(server, 'tools/call', call, 'selva_a');
		await rpc(server, 'tools/call', call, 'selva_b');
		expect(f.calls.map((c) => c.headers.Authorization)).toEqual([
			'Bearer selva_a',
			'Bearer selva_b'
		]);
		expect(a.content[0].text).toBe('Released j1, key [redacted]');
	});

	it('needs `apiKey` only for listen and verify', async () => {
		const server = createMcpServer({
			name: 'test',
			version: '0.0.0',
			baseUrl: 'https://host',
			openapi: SPEC,
			tools: [getOrder]
		});
		await expect(server.verify()).rejects.toThrow(/need `apiKey`/);
		await expect(server.listen({ transport: 'stdio' })).rejects.toThrow(/need `apiKey`/);
	});

	it('refuses internal, multipart and unknown operations at startup', () => {
		expect(() => serve([], [fromOperation('getSecret', { name: 's' })])).toThrow(/x-internal/);
		expect(() => serve([], [fromOperation('postUploads', { name: 'u' })])).toThrow(/multipart/);
		expect(() => serve([], [fromOperation('getNothing', { name: 'n' })])).toThrow(
			/not in the host/
		);
	});

	it('verify names every operation the live host lacks or scopes differently', async () => {
		const live = structuredClone(SPEC) as {
			paths: Record<string, Record<string, Record<string, unknown>>>;
		};
		delete live.paths['/api/v1/orders/{id}'].get;
		live.paths['/api/v1/jobs/{id}/solve'].post['x-scope'] = 'write';
		const { server } = serve([json(live)]);
		await expect(server.verify()).rejects.toThrow(
			/getOrdersById is missing[\s\S]*postJobsByIdSolve needs `write`/
		);
	});
});
