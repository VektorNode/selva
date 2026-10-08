import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpServer } from '../server.js';
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

/** One JSON-RPC request through the streamable-HTTP handler, SSE reply parsed. */
async function rpc(
	server: ReturnType<typeof createMcpServer>,
	method: string,
	params: unknown = {}
) {
	const res = await server.handle(
		new Request('https://host/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		})
	);
	const text = await res.text();
	const data = text
		.split('\n')
		.filter((l) => l.startsWith('data:'))
		.map((l) => JSON.parse(l.slice(5)) as { result?: Record<string, unknown>; error?: unknown })
		.find((m) => 'result' in m || 'error' in m);
	return data!.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('createMcpServer', () => {
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
		expect(byName.create_order).toMatchObject({ readOnlyHint: false, idempotentHint: true });
		expect(byName.release_job).toMatchObject({ openWorldHint: true });
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
