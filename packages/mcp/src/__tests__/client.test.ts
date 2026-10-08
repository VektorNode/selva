import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client.js';
import { ApiCallError, describeError } from '../errors.js';
import { indexOperations } from '../spec.js';
import { KEY, SPEC, fakeFetch, json } from './fixtures.js';

const spec = indexOperations(SPEC);
const client = (responses: (Response | Error)[]) => {
	const f = fakeFetch(responses);
	return {
		api: createApiClient(spec, { baseUrl: 'https://host/', apiKey: KEY, fetch: f.fetch }),
		calls: f.calls
	};
};

describe('indexOperations', () => {
	it('reads scope, idempotency, params and body from the shared builder', () => {
		const create = spec.get('postOrders')!;
		expect(create).toMatchObject({
			method: 'POST',
			path: '/api/v1/orders',
			scope: 'write',
			idempotent: true
		});
		expect(create.body?.properties).toHaveProperty('name');
		expect(spec.get('postJobsByIdSolve')!.scope).toBe('solve');
		expect(spec.get('getOrders')!.paginated).toBe(true);
		expect(spec.get('getOrders')!.queryParams.map((q) => q.name)).toContain('externalRef');
		expect(spec.get('getSecret')!.internal).toBe(true);
		expect(spec.get('postUploads')!.multipart).toBe(true);
	});

	it('refuses a document without x-scope', () => {
		const doc = { paths: { '/x': { get: { operationId: 'getX' } } } };
		expect(() => indexOperations(doc)).toThrow(/x-scope/);
	});
});

describe('api.call', () => {
	it('fills the path, sends the key as a bearer and the body as JSON', async () => {
		const { api, calls } = client([json({ id: 'o1' })]);
		await api.call('getOrdersById', { params: { id: 'a b' } });
		expect(calls[0].url).toBe('https://host/api/v1/orders/a%20b');
		expect(calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
	});

	it('sends one Idempotency-Key across a retried create', async () => {
		const { api, calls } = client([new TypeError('socket hang up'), json({ id: 'o1' }, 201)]);
		await expect(api.call('postOrders', { body: { name: 'A' } })).resolves.toEqual({ id: 'o1' });
		expect(calls).toHaveLength(2);
		expect(calls[0].headers['Idempotency-Key']).toBeTruthy();
		expect(calls[1].headers['Idempotency-Key']).toBe(calls[0].headers['Idempotency-Key']);
	});

	it('does not retry a write that has no idempotency key', async () => {
		const { api, calls } = client([new TypeError('reset')]);
		await expect(api.call('deleteOrdersById', { params: { id: '1' } })).rejects.toMatchObject({
			code: 'UNREACHABLE'
		});
		expect(calls).toHaveLength(1);
	});

	it('waits out a short 429 and retries', async () => {
		const { api, calls } = client([
			json({ message: 'slow', code: 'RATE_LIMITED' }, 429, { 'Retry-After': '0' }),
			json({ items: [] })
		]);
		await expect(api.call('getOrders')).resolves.toEqual({ items: [] });
		expect(calls).toHaveLength(2);
	});

	it('hands a long 429 back with the wait', async () => {
		const { api, calls } = client([
			json({ message: 'budget', code: 'RATE_LIMITED' }, 429, { 'Retry-After': '7200' })
		]);
		const err = await api.call('getOrders').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiCallError);
		expect((err as ApiCallError).retryAfterSeconds).toBe(7200);
		expect(describeError(err as ApiCallError)).toMatch(/2h 0min.*do not retry/);
		expect(calls).toHaveLength(1);
	});

	it('maps the error envelope, naming the missing scope', async () => {
		const { api } = client([
			json({ message: 'no', code: 'FORBIDDEN', details: { requiredScope: 'solve:org:o1' } }, 403)
		]);
		const err = (await api
			.call('postJobsByIdSolve', { params: { id: 'j' } })
			.catch((e: unknown) => e)) as ApiCallError;
		expect(err.code).toBe('FORBIDDEN');
		expect(describeError(err)).toContain('`solve:org:o1`');
	});

	it('refuses an operation outside the tool’s declared calls', async () => {
		const f = fakeFetch([]);
		const api = createApiClient(
			spec,
			{ baseUrl: 'https://host', apiKey: KEY, fetch: f.fetch },
			new Set(['getOrders'])
		);
		await expect(api.call('deleteOrdersById', { params: { id: '1' } })).rejects.toThrow(/calls/);
		expect(f.calls).toHaveLength(0);
	});
});
