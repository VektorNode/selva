import { describe, it, expect } from 'vitest';
import { NoopLogger, narrowApiTokenContext, type RequestContext } from '@selvajs/platform';
import { runHandler } from '../respond.js';
import {
	createApiRateLimiter,
	resolveApiRateLimitConfig,
	withRateLimitHeaders,
	DEFAULT_API_RATE_LIMIT,
	type ApiRateLimiter
} from '../rate-limit.js';
import { codeForStatus } from '../errors.js';
import type { ApiHandler, ApiRequest } from '../types.js';
import type { SelvaDeps } from '../deps.js';

const ORG = 'org-a';

function session(userId = 'u1'): RequestContext {
	return { userId, actingOrgId: ORG, platformPermissions: [], orgPermissions: [] };
}

function keyed(tokenId: string, userId = 'u1'): RequestContext {
	return narrowApiTokenContext(session(userId), { id: tokenId, orgId: ORG, scopes: ['write:all'] });
}

function request(ctx: RequestContext, limiter: ApiRateLimiter | null): ApiRequest {
	const url = new URL('http://selva.test/api/v1/x');
	return {
		ctx,
		log: new NoopLogger(),
		params: {},
		url,
		request: new Request(url),
		deps: { apiRateLimiter: limiter } as SelvaDeps
	};
}

let calls = 0;
const ok: ApiHandler = async () => {
	calls++;
	return { body: { ok: true } };
};

const run = (req: ApiRequest) => runHandler(ok, req, { fallback: 'x' });

describe('runHandler per-token rate limit', () => {
	it('refuses past the cap with 429 RATE_LIMITED, Retry-After, and no handler call', async () => {
		const limiter = createApiRateLimiter({ windowMs: 60_000, maxPerWindow: 2 });
		await run(request(keyed('t1'), limiter));
		await run(request(keyed('t1'), limiter));
		calls = 0;
		const res = await run(request(keyed('t1'), limiter));
		expect(res.status).toBe(429);
		expect(calls).toBe(0);
		expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
		expect(res.headers.get('RateLimit-Remaining')).toBe('0');
		const body = await res.json();
		expect(body.code).toBe('RATE_LIMITED');
		expect(body.details.retryAfter).toBe(res.headers.get('Retry-After'));
	});

	it('stamps RateLimit headers on every token response', async () => {
		const limiter = createApiRateLimiter({ windowMs: 60_000, maxPerWindow: 5 });
		const res = await run(request(keyed('t2'), limiter));
		expect(res.headers.get('RateLimit-Limit')).toBe('5');
		expect(res.headers.get('RateLimit-Remaining')).toBe('4');
	});

	it('keys per token, so two keys of one user have separate budgets', async () => {
		const limiter = createApiRateLimiter({ windowMs: 60_000, maxPerWindow: 1 });
		expect((await run(request(keyed('ta'), limiter))).status).toBe(200);
		expect((await run(request(keyed('tb'), limiter))).status).toBe(200);
		expect((await run(request(keyed('ta'), limiter))).status).toBe(429);
	});

	it('never charges a browser session', async () => {
		const limiter = createApiRateLimiter({ windowMs: 60_000, maxPerWindow: 1 });
		for (let i = 0; i < 3; i++) {
			const res = await run(request(session(), limiter));
			expect(res.status).toBe(200);
			expect(res.headers.get('RateLimit-Limit')).toBeNull();
		}
	});

	it('is off when the host passes null', async () => {
		for (let i = 0; i < 3; i++) {
			expect((await run(request(keyed('t3'), null))).status).toBe(200);
		}
	});

	it('charges before the scope target loads', async () => {
		const limiter = createApiRateLimiter({ windowMs: 60_000, maxPerWindow: 1 });
		let targetLoads = 0;
		const scopeTarget = () => {
			targetLoads++;
			return {};
		};
		await runHandler(ok, request(keyed('t4'), limiter), { fallback: 'x', scopeTarget });
		await runHandler(ok, request(keyed('t4'), limiter), { fallback: 'x', scopeTarget });
		expect(targetLoads).toBe(1);
	});
});

describe('rate limit config', () => {
	it('maps 429 to RATE_LIMITED', () => {
		expect(codeForStatus(429)).toBe('RATE_LIMITED');
	});

	it('reads env, with 0 meaning off', () => {
		expect(resolveApiRateLimitConfig({})).toEqual(DEFAULT_API_RATE_LIMIT);
		const off = resolveApiRateLimitConfig({ API_TOKEN_RATE_LIMIT_MAX: '0' });
		expect(createApiRateLimiter(off)).toBeNull();
		expect(
			resolveApiRateLimitConfig({
				API_TOKEN_RATE_LIMIT_MAX: '10',
				API_TOKEN_RATE_LIMIT_WINDOW_MS: '1000'
			})
		).toEqual({ windowMs: 1000, maxPerWindow: 10 });
	});

	it('adds headers to an immutable response', async () => {
		const frozen = Response.redirect('http://selva.test/', 302);
		const res = withRateLimitHeaders(frozen, { allowed: true, limit: 3, remaining: 2 });
		expect(res.headers.get('RateLimit-Remaining')).toBe('2');
		expect(res.status).toBe(302);
	});
});
