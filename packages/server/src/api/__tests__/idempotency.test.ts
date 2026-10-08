import { describe, it, expect, beforeEach } from 'vitest';
import { NoopLogger, narrowApiTokenContext, type RequestContext } from '@selvajs/platform';
import { runHandler } from '../respond.js';
import { apiError, ApiErrorCode } from '../errors.js';
import { createApiIdempotencyStore, type ApiIdempotencyStore } from '../idempotency.js';
import type { ApiHandler, ApiRequest } from '../types.js';
import type { SelvaDeps } from '../deps.js';

const ORG = 'org-a';

function session(userId = 'u1'): RequestContext {
	return { userId, actingOrgId: ORG, platformPermissions: [], orgPermissions: [] };
}

function keyed(tokenId: string): RequestContext {
	return narrowApiTokenContext(session(), { id: tokenId, orgId: ORG, scopes: ['write:all'] });
}

let store: ApiIdempotencyStore;
let created: number;

beforeEach(() => {
	store = createApiIdempotencyStore(60_000);
	created = 0;
});

const create: ApiHandler = async (req) => {
	created++;
	const body = await req.request.json();
	return { status: 201, body: { id: `p${created}`, name: body.name } };
};

function request(ctx: RequestContext, body: unknown, key?: string): ApiRequest {
	const url = new URL('http://selva.test/api/v1/projects');
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (key !== undefined) headers['Idempotency-Key'] = key;
	return {
		ctx,
		log: new NoopLogger(),
		params: {},
		url,
		request: new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }),
		deps: { apiRateLimiter: null, idempotency: store } as SelvaDeps
	};
}

const run = (req: ApiRequest, handler = create, idempotent = true) =>
	runHandler(handler, req, { fallback: 'x', idempotent });

describe('runHandler idempotency', () => {
	it('replays the first response to a repeat and marks it', async () => {
		const first = await run(request(session(), { name: 'A' }, 'k1'));
		const second = await run(request(session(), { name: 'A' }, 'k1'));
		expect(created).toBe(1);
		expect(second.status).toBe(201);
		expect(await second.json()).toEqual(await first.json());
		expect(first.headers.get('Idempotency-Replayed')).toBeNull();
		expect(second.headers.get('Idempotency-Replayed')).toBe('true');
	});

	it('refuses a reused key with a different body with 422', async () => {
		await run(request(session(), { name: 'A' }, 'k1'));
		const res = await run(request(session(), { name: 'B' }, 'k1'));
		expect(res.status).toBe(422);
		expect((await res.json()).code).toBe(ApiErrorCode.UNPROCESSABLE);
		expect(created).toBe(1);
	});

	it('namespaces per token, and separates a token from its owner session', async () => {
		await run(request(keyed('t1'), { name: 'A' }, 'k1'));
		await run(request(keyed('t2'), { name: 'A' }, 'k1'));
		await run(request(session(), { name: 'A' }, 'k1'));
		expect(created).toBe(3);
	});

	it('joins a concurrent retry to the in-flight run', async () => {
		const [a, b] = await Promise.all([
			run(request(session(), { name: 'A' }, 'k1')),
			run(request(session(), { name: 'A' }, 'k1'))
		]);
		expect(created).toBe(1);
		expect([a.status, b.status]).toEqual([201, 201]);
	});

	it('does not keep a failure, so a corrected retry runs', async () => {
		let fail = true;
		const flaky: ApiHandler = async (req) => {
			if (fail) apiError(409, ApiErrorCode.CONFLICT, 'busy');
			return create(req);
		};
		expect((await run(request(session(), { name: 'A' }, 'k1'), flaky)).status).toBe(409);
		fail = false;
		const res = await run(request(session(), { name: 'A' }, 'k1'), flaky);
		expect(res.status).toBe(201);
		expect(res.headers.get('Idempotency-Replayed')).toBeNull();
	});

	it('ignores the header on routes that did not opt in', async () => {
		await run(request(session(), { name: 'A' }, 'k1'), create, false);
		await run(request(session(), { name: 'A' }, 'k1'), create, false);
		expect(created).toBe(2);
	});

	it('replays a multipart retry despite a fresh boundary, and refuses a different file', async () => {
		const upload: ApiHandler = async (req) => {
			created++;
			const file = (await req.request.formData()).get('file') as File;
			return { status: 201, body: { id: `d${created}`, size: file.size } };
		};
		const multipart = (contents: string, boundary: string): ApiRequest => {
			const body =
				`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nDef\r\n` +
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.gh"\r\n` +
				`Content-Type: application/octet-stream\r\n\r\n${contents}\r\n--${boundary}--\r\n`;
			const url = new URL('http://selva.test/api/v1/definitions');
			return {
				...request(session(), {}),
				url,
				request: new Request(url, {
					method: 'POST',
					headers: {
						'content-type': `multipart/form-data; boundary=${boundary}`,
						'Idempotency-Key': 'k1'
					},
					body
				})
			};
		};

		await run(multipart('gh-bytes', 'aaa'), upload);
		const retry = await run(multipart('gh-bytes', 'bbb'), upload);
		expect(retry.headers.get('Idempotency-Replayed')).toBe('true');
		expect((await run(multipart('other-bytes', 'ccc'), upload)).status).toBe(422);
		expect(created).toBe(1);
	});

	it('rejects an empty or oversized key with 400', async () => {
		expect((await run(request(session(), {}, ''))).status).toBe(400);
		expect((await run(request(session(), {}, 'x'.repeat(256)))).status).toBe(400);
		expect(created).toBe(0);
	});
});
