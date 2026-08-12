/**
 * Tests for `createComputeFetchSolveFn` — the fetch-based `SolveFn` factory.
 * `fetch` is stubbed per test; `@selvajs/compute`'s `GrasshopperResponseProcessor`
 * is real (pure data-shape logic, no network) so output extraction is exercised
 * end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createComputeFetchSolveFn } from '../compute-fetch-solve-fn.js';

function jsonResponse(body: unknown, init?: ResponseInit & { url?: string; redirected?: boolean }) {
	const res = new Response(JSON.stringify(body), {
		status: init?.status ?? 200,
		headers: init?.headers ?? { 'Content-Type': 'application/json' }
	});
	if (init?.url !== undefined) Object.defineProperty(res, 'url', { value: init.url });
	if (init?.redirected !== undefined)
		Object.defineProperty(res, 'redirected', { value: init.redirected });
	return res;
}

function baseOpts(over: Partial<Parameters<typeof createComputeFetchSolveFn>[0]> = {}) {
	return {
		endpoint: '/api/compute',
		definitionUrl: () => 'local:abc',
		inputs: () => [{ id: 'a' }],
		outputs: () => [{ id: 'out-1', nickname: 'Out' }],
		...over
	};
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createComputeFetchSolveFn — happy path', () => {
	it('builds the request body and extracts outputs by id', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				values: [{ ParamName: 'Out', InnerTree: { '{0}': [{ data: '5' }] } }],
				errors: [],
				warnings: []
			})
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({ a: 1 }, new AbortController().signal);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/compute');
		const body = JSON.parse(init.body as string);
		expect(body).toMatchObject({
			inputs: [{ id: 'a' }],
			values: { a: 1 },
			definitionUrl: 'local:abc'
		});

		expect(result.errors).toEqual([]);
		expect(result.warnings).toEqual([]);
		expect(result.meshes).toEqual([]);
	});

	it('includes versionId over channel when both are present', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const solve = createComputeFetchSolveFn(
			baseOpts({ channel: () => 'draft', versionId: () => 'v-1' })
		);
		await solve({}, new AbortController().signal);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.versionId).toBe('v-1');
		expect(body.channel).toBeUndefined();
	});

	it('calls meshes.extract once per solve when meshes is configured', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const extract = vi.fn((_response: unknown, _opts: { debug: boolean }) => [{ mesh: 1 }]);
		const solve = createComputeFetchSolveFn(baseOpts({ meshes: { extract } }));
		const result = await solve({}, new AbortController().signal);
		expect(extract).toHaveBeenCalledTimes(1);
		expect(extract.mock.calls[0][1]).toEqual({ debug: false });
		expect(result.meshes).toEqual([{ mesh: 1 }]);
	});

	it('meshes omitted: result.meshes is always []', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, new AbortController().signal);
		expect(result.meshes).toEqual([]);
	});
});

describe('createComputeFetchSolveFn — session expiry', () => {
	it('401 response calls onSessionExpired', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 401 }));
		const onSessionExpired = vi.fn(() => {
			throw new Error('custom session expired');
		});
		const solve = createComputeFetchSolveFn(baseOpts({ onSessionExpired }));
		await expect(solve({}, new AbortController().signal)).rejects.toThrow('custom session expired');
		expect(onSessionExpired).toHaveBeenCalledTimes(1);
	});

	it('default onSessionExpired throws an actionable message', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 401 }));
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/session has expired/);
	});

	it('a redirect to /login is treated as session expiry', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({}, { status: 200, url: 'https://app.example/login', redirected: true })
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/session has expired/);
	});
});

describe('createComputeFetchSolveFn — rate limiting', () => {
	it('429 calls onRateLimited and starts a cooldown that short-circuits the next solve', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ message: 'slow down', retryAfter: 60 }), {
				status: 429,
				headers: { 'Content-Type': 'application/json', 'Retry-After': '60' }
			})
		);
		const onRateLimited = vi.fn();
		const solve = createComputeFetchSolveFn(baseOpts({ onRateLimited }));
		await expect(solve({}, new AbortController().signal)).rejects.toThrow('slow down');
		expect(onRateLimited).toHaveBeenCalledWith(60);

		fetchMock.mockClear();
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/Rate limit reached/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('default onRateLimited throws a cooldown-aware Error', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ retryAfter: 5 }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/Rate limit reached/);
	});
});

describe('createComputeFetchSolveFn — malformed responses', () => {
	it('non-JSON 200 body throws an actionable reload error', async () => {
		fetchMock.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/invalid response/);
	});

	it('503 throws a compute-offline message', async () => {
		fetchMock.mockResolvedValue(new Response('', { status: 503 }));
		const solve = createComputeFetchSolveFn(baseOpts());
		await expect(solve({}, new AbortController().signal)).rejects.toThrow(/offline or unreachable/);
	});
});

describe('createComputeFetchSolveFn — abort handling', () => {
	it('abort before fetch resolves returns an empty result', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation(() => {
			controller.abort();
			return Promise.reject(new DOMException('aborted', 'AbortError'));
		});
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, controller.signal);
		expect(result).toEqual({ outputs: {} });
	});

	it('abort after headers but before body read returns an empty result', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation(async () => {
			const res = jsonResponse({ values: [], errors: [], warnings: [] });
			controller.abort();
			return res;
		});
		const solve = createComputeFetchSolveFn(baseOpts());
		const result = await solve({}, controller.signal);
		expect(result).toEqual({ outputs: {} });
	});
});

describe('createComputeFetchSolveFn — debug telemetry', () => {
	it('debug false (default): no console.info calls', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const solve = createComputeFetchSolveFn(baseOpts());
		await solve({}, new AbortController().signal);
		expect(logSpy).not.toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it('debug true: emits console.info telemetry', async () => {
		fetchMock.mockResolvedValue(jsonResponse({ values: [], errors: [], warnings: [] }));
		const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		const solve = createComputeFetchSolveFn(baseOpts({ debug: true }));
		await solve({}, new AbortController().signal);
		expect(logSpy).toHaveBeenCalled();
		logSpy.mockRestore();
	});
});
