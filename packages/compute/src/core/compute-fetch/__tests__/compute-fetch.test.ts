/**
 * Contract tests for the Rhino Compute transport (`fetchCompute`).
 *
 * The transport is the deepest module in the library — retry/backoff, the
 * HTTP-status → error-code mapping table, the timeout-vs-caller-abort
 * distinction, partial-success 500 handling, and JSON-parse failure all live
 * here. These tests drive it through the global `fetch` (stubbed in
 * tests/setup.ts), which is the same seam the library uses in production.
 *
 * Time is controlled with fake timers so backoff sleeps resolve instantly.
 */
import { gunzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCompute } from '@/core/compute-fetch/compute-fetch';
import { ComputeError } from '@/core/errors';
import { getResponseWireSize } from '@/core/compute-fetch/wire-size';
import { setLogger } from '@/core/utils/logger';
import { createMockResponse } from '@tests/helpers/mock-fetch';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const config = { serverUrl: 'http://localhost:6500' };

const rejection = (call: Promise<unknown>): Promise<ComputeError> =>
	call.then(
		() => {
			throw new Error('expected a rejection');
		},
		(error: ComputeError) => error
	);

afterEach(() => {
	fetchMock.mockReset();
});

describe('fetchCompute — request shape', () => {
	it('POSTs to <serverUrl>/<endpoint> with JSON body and request id header', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute('grasshopper', { values: [1, 2] }, config);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://localhost:6500/grasshopper');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ values: [1, 2] });
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect((init.headers as Record<string, string>)['X-Request-ID']).toBeTruthy();
	});

	it('rejects a non-JSON-serializable body with INVALID_INPUT before touching the network', async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;

		await expect(fetchCompute('grasshopper', circular, config)).rejects.toMatchObject({
			name: 'ComputeError',
			code: 'INVALID_INPUT'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sends the API key as the RhinoComputeKey header when configured', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute('io', {}, { ...config, apiKey: 'secret' });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.RhinoComputeKey).toBe('secret');
	});

	it('sends the API key under a caller-configured apiKeyHeader', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute('solve', {}, { ...config, apiKey: 'secret', apiKeyHeader: 'X-Backend-Key' });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-Backend-Key']).toBe('secret');
		expect(headers.RhinoComputeKey).toBeUndefined();
	});

	it('lets config.headers set RhinoComputeKey once apiKeyHeader has moved the real key elsewhere', async () => {
		// With a custom apiKeyHeader the default name is no longer a transport
		// header, so it falls under the caller-headers layer like any other. The
		// header that actually carries the key still can't be clobbered.
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute(
			'solve',
			{},
			{
				...config,
				apiKey: 'real-key',
				apiKeyHeader: 'X-Backend-Key',
				headers: { RhinoComputeKey: 'stale', 'X-Backend-Key': 'attacker-key' }
			}
		);

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-Backend-Key']).toBe('real-key');
		expect(headers.RhinoComputeKey).toBe('stale');
	});

	it('sends the auth token as the Authorization header when configured', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute('io', {}, { ...config, authToken: 'Bearer xyz' });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer xyz');
	});

	it('sends caller-supplied config.headers on the request', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute(
			'grasshopper',
			{},
			{ ...config, headers: { 'X-Selva-Definition': 'guid-123' } }
		);

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-Selva-Definition']).toBe('guid-123');
	});

	it('sends sessionId as X-Session-Id, and nothing without one', async () => {
		fetchMock.mockResolvedValue(createMockResponse({ ok: true }));

		await fetchCompute('grasshopper', {}, { ...config, sessionId: 'a1b2c3' });
		await fetchCompute('grasshopper', {}, config);

		const [withId, withoutId] = fetchMock.mock.calls.map(
			(call) => call[1].headers as Record<string, string>
		);
		expect(withId['X-Session-Id']).toBe('a1b2c3');
		expect(withoutId['X-Session-Id']).toBeUndefined();
	});

	it('does not let config.headers send a second X-Session-Id', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute(
			'grasshopper',
			{},
			{ ...config, sessionId: 'real', headers: { 'x-session-id': 'forged' } }
		);

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-Session-Id']).toBe('real');
		expect(headers['x-session-id']).toBeUndefined();
	});

	it.each(['', 'has space', 'ü', 'x'.repeat(129)])(
		'rejects sessionId %j, which compute would ignore, before sending',
		async (sessionId) => {
			await expect(fetchCompute('grasshopper', {}, { ...config, sessionId })).rejects.toMatchObject(
				{ name: 'ComputeError', code: 'INVALID_CONFIG' }
			);
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('never lets config.headers override the transport/auth headers', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute(
			'grasshopper',
			{},
			{
				...config,
				apiKey: 'real-key',
				headers: {
					RhinoComputeKey: 'attacker-key',
					'Content-Type': 'text/plain',
					'X-Request-ID': 'forged'
				}
			}
		);

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.RhinoComputeKey).toBe('real-key');
		expect(headers['Content-Type']).toBe('application/json');
		expect(headers['X-Request-ID']).not.toBe('forged');
	});

	it('drops a caller header that differs from a transport header only in case', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchCompute(
			'grasshopper',
			{},
			{
				...config,
				apiKey: 'real-key',
				authToken: 'Bearer real',
				headers: {
					rhinocomputekey: 'attacker-key',
					authorization: 'Bearer forged',
					'content-type': 'text/plain',
					'x-request-id': 'forged',
					'x-selva-definition': 'guid-123'
				}
			}
		);

		// fetch joins same-name headers that differ in case: read them the way it sends them.
		const headers = new Headers(fetchMock.mock.calls[0][1].headers);
		expect(headers.get('RhinoComputeKey')).toBe('real-key');
		expect(headers.get('Authorization')).toBe('Bearer real');
		expect(headers.get('Content-Type')).toBe('application/json');
		expect(headers.get('X-Request-ID')).not.toContain('forged');
		expect(headers.get('X-Selva-Definition')).toBe('guid-123');
	});

	it('does not warn about missing credentials when an auth token is configured', async () => {
		const warn = vi.fn();
		setLogger({ debug: () => {}, info: () => {}, warn, error: () => {} });
		try {
			fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
			await fetchCompute(
				'io',
				{},
				{ serverUrl: 'https://compute.example.com', authToken: 'Bearer xyz' }
			);
			expect(warn).not.toHaveBeenCalled();

			fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
			await fetchCompute('io', {}, { serverUrl: 'https://compute.example.com' });
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			setLogger(null);
		}
	});

	it('returns the parsed JSON response', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ values: [], extra: 7 }));
		const res = await fetchCompute('grasshopper', {}, config);
		expect(res).toEqual({ values: [], extra: 7 });
	});

	it('records the response wire size for downstream byte-budgeted caches', async () => {
		const body = JSON.stringify({ values: [1, 2, 3] });
		fetchMock.mockResolvedValueOnce(createMockResponse(null, { body }));
		const res = await fetchCompute('grasshopper', {}, config);
		expect(getResponseWireSize(res)).toBe(body.length);
	});
});

describe('fetchCompute — HTTP status → error code mapping', () => {
	const cases: Array<[number, string, string]> = [
		[401, 'Unauthorized', 'AUTH_ERROR'],
		[403, 'Forbidden', 'AUTH_ERROR'],
		[404, 'Not Found', 'NOT_FOUND'],
		[413, 'Payload Too Large', 'VALIDATION_ERROR'],
		[429, 'Too Many Requests', 'RATE_LIMIT'],
		[500, 'Internal Server Error', 'COMPUTATION_ERROR'],
		[504, 'Gateway Timeout', 'NETWORK_ERROR'],
		[418, "I'm a teapot", 'UNKNOWN_ERROR']
	];

	it.each(cases)('maps HTTP %i (%s) to %s', async (status, statusText, code) => {
		fetchMock.mockResolvedValueOnce(
			createMockResponse({ msg: 'fail' }, { ok: false, status, statusText })
		);

		await expect(fetchCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code,
			statusCode: status
		});
	});

	it('includes a body excerpt in the error message', async () => {
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, {
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				body: 'invalid api key'
			})
		);
		await expect(fetchCompute('grasshopper', {}, config)).rejects.toThrow(/invalid api key/);
	});

	it("reads a 400's message out of its JSON body and does not retry it", async () => {
		fetchMock.mockResolvedValue(
			createMockResponse(
				{ error: 'Bad Request', message: "The algo isn't valid base64", code: 'bad_request' },
				{ ok: false, status: 400, statusText: 'Bad Request' }
			)
		);

		const error = await rejection(
			fetchCompute('grasshopper', {}, { ...config, retry: { attempts: 2, baseDelayMs: 0 } })
		);

		expect(error.code).toBe('VALIDATION_ERROR');
		expect(error.message).toBe("Bad request: Bad Request — The algo isn't valid base64");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('fetchCompute — request compression', () => {
	const big = { values: 'x'.repeat(4096) };
	const advertising = () => createMockResponse({}, { headers: { 'Accept-Encoding': 'gzip' } });

	it('gzips a large body once the server advertised gzip, and stops when it no longer does', async () => {
		const gz = { serverUrl: 'http://gzip-server:6500' };
		fetchMock
			.mockResolvedValueOnce(advertising())
			.mockResolvedValueOnce(createMockResponse({}))
			.mockResolvedValueOnce(createMockResponse({}));

		await fetchCompute('grasshopper', big, gz);
		await fetchCompute('grasshopper', big, gz);
		await fetchCompute('grasshopper', big, gz);

		const [first, second, third] = fetchMock.mock.calls.map(([, init]) => init as RequestInit);
		expect(typeof first.body).toBe('string');
		expect((second.headers as Record<string, string>)['Content-Encoding']).toBe('gzip');
		expect(JSON.parse(strFromU8(gunzipSync(second.body as Uint8Array)))).toEqual(big);
		expect(typeof third.body).toBe('string');
		expect(third.headers as Record<string, string>).not.toHaveProperty('Content-Encoding');
	});

	it('sends a small body uncompressed', async () => {
		const gz = { serverUrl: 'http://gzip-small:6500' };
		fetchMock.mockResolvedValueOnce(advertising()).mockResolvedValueOnce(createMockResponse({}));

		await fetchCompute('grasshopper', {}, gz);
		await fetchCompute('grasshopper', { a: 1 }, gz);

		expect(typeof (fetchMock.mock.calls[1][1] as RequestInit).body).toBe('string');
	});
});

describe('fetchCompute — partial success (HTTP 500 with values)', () => {
	it.each([
		['camelCase', { values: [{ ParamName: 'out' }], errors: ['boom'], warnings: [] }],
		['PascalCase (stock mcneel)', { Values: [{ ParamName: 'out' }], Errors: ['boom'] }]
	])('returns a %s partial success instead of throwing', async (_casing, partial) => {
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: JSON.stringify(partial)
			})
		);

		const res = await fetchCompute('grasshopper', {}, config);
		expect(res).toEqual(partial);
	});
});

describe('fetchCompute — malformed responses', () => {
	it('throws NETWORK_ERROR when a 200 body with no declared Content-Type is not valid JSON', async () => {
		// No Content-Type header → could be a stream cut mid-body, so this stays
		// the retryable NETWORK_ERROR classification.
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, { ok: true, status: 200, body: 'not json {' })
		);
		await expect(fetchCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'NETWORK_ERROR'
		});
	});

	it('does NOT retry a 200 that declares a non-JSON body — INVALID_RESPONSE', async () => {
		// A captive portal / reverse-proxy login page is deterministic: retrying
		// refetches the same HTML. It must fail immediately with an honest code
		// instead of burning the backoff schedule as NETWORK_ERROR + statusCode 200.
		fetchMock.mockResolvedValue(
			createMockResponse(null, {
				ok: true,
				status: 200,
				body: '<html><body>Please log in</body></html>',
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			})
		);
		await expect(
			fetchCompute(
				'grasshopper',
				{},
				{ ...config, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 } }
			)
		).rejects.toMatchObject({ code: 'INVALID_RESPONSE', statusCode: 200 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('wraps a network-layer TypeError as NETWORK_ERROR', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await expect(fetchCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'NETWORK_ERROR'
		});
	});

	it('treats a bare window with no document as non-browser', async () => {
		vi.stubGlobal('window', {});
		try {
			fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
			await expect(fetchCompute('grasshopper', {}, config)).rejects.toMatchObject({
				code: 'NETWORK_ERROR'
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// In a real browser an opaque fetch TypeError is most likely a CORS misconfiguration.
	it('classifies a fetch TypeError as CORS_ERROR in a browser context', async () => {
		vi.stubGlobal('window', { document: {} });
		try {
			fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
			await expect(fetchCompute('grasshopper', {}, config)).rejects.toMatchObject({
				code: 'CORS_ERROR'
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('fetchCompute — retry', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const retryCfg = { ...config, retry: { attempts: 2, baseDelayMs: 100, maxDelayMs: 100 } };

	it('retries a retryable 503 and resolves on a later success', async () => {
		fetchMock
			.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 503, statusText: 'down' }))
			.mockResolvedValueOnce(createMockResponse({ ok: 'recovered' }));

		const promise = fetchCompute('grasshopper', {}, retryCfg);
		await vi.advanceTimersByTimeAsync(200);

		await expect(promise).resolves.toEqual({ ok: 'recovered' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('throws after retries are exhausted, surfacing the last error', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse({}, { ok: false, status: 502, statusText: 'bad gateway' })
		);

		const promise = fetchCompute('grasshopper', {}, retryCfg);
		const assertion = expect(promise).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
		await vi.advanceTimersByTimeAsync(1000);
		await assertion;

		// 1 initial + 2 retries = 3 attempts
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('does NOT retry a non-retryable status (401)', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse({}, { ok: false, status: 401, statusText: 'Unauthorized' })
		);
		await expect(fetchCompute('grasshopper', {}, retryCfg)).rejects.toMatchObject({
			code: 'AUTH_ERROR'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('honors a Retry-After header ABOVE maxDelayMs — the server window wins', async () => {
		fetchMock
			.mockResolvedValueOnce(
				createMockResponse(
					{},
					{
						ok: false,
						status: 429,
						statusText: 'Too Many Requests',
						headers: { 'Retry-After': '5' }
					}
				)
			)
			.mockResolvedValueOnce(createMockResponse({ ok: 'after-wait' }));

		const promise = fetchCompute('grasshopper', {}, retryCfg);

		// Retry-After 5s wins over the policy's maxDelayMs (100ms) — retrying
		// earlier would all but guarantee another 429.
		await vi.advanceTimersByTimeAsync(4900);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(200);
		await expect(promise).resolves.toEqual({ ok: 'after-wait' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('caps a pathological Retry-After at the 60s absolute bound', async () => {
		fetchMock
			.mockResolvedValueOnce(
				createMockResponse(
					{},
					{
						ok: false,
						status: 429,
						statusText: 'Too Many Requests',
						headers: { 'Retry-After': '3600' }
					}
				)
			)
			.mockResolvedValueOnce(createMockResponse({ ok: 'after-cap' }));

		const promise = fetchCompute('grasshopper', {}, retryCfg);

		await vi.advanceTimersByTimeAsync(59_000);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1_100);
		await expect(promise).resolves.toEqual({ ok: 'after-cap' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('honors an HTTP-date Retry-After header', async () => {
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		fetchMock
			.mockResolvedValueOnce(
				createMockResponse(
					{},
					{
						ok: false,
						status: 429,
						statusText: 'Too Many Requests',
						headers: { 'Retry-After': new Date(Date.now() + 5000).toUTCString() }
					}
				)
			)
			.mockResolvedValueOnce(createMockResponse({ ok: 'after-date' }));

		const promise = fetchCompute('grasshopper', {}, retryCfg);

		await vi.advanceTimersByTimeAsync(4900);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(200);
		await expect(promise).resolves.toEqual({ ok: 'after-date' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does not retry 429 when retryOn429 is false — surfaced as RATE_LIMIT', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse({}, { ok: false, status: 429, statusText: 'Too Many Requests' })
		);
		const promise = fetchCompute(
			'grasshopper',
			{},
			{
				...config,
				retry: { attempts: 2, baseDelayMs: 100, maxDelayMs: 100, retryOn429: false }
			}
		);
		await expect(promise).rejects.toMatchObject({ code: 'RATE_LIMIT', statusCode: 429 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retries a 200 whose JSON-declared body is truncated (stream cut mid-body)', async () => {
		fetchMock
			.mockResolvedValueOnce(
				createMockResponse(null, {
					ok: true,
					status: 200,
					body: '{"values": [1,',
					headers: { 'Content-Type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(createMockResponse({ values: [1, 2] }));

		const promise = fetchCompute('grasshopper', {}, retryCfg);
		await vi.advanceTimersByTimeAsync(500);

		await expect(promise).resolves.toEqual({ values: [1, 2] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('fetchCompute — abort and timeout', () => {
	// Real fetch rejects with `signal.reason`, whatever the caller aborted with.
	const rejectWithReason = (_url: unknown, init: unknown) =>
		new Promise((_resolve, reject) => {
			const { signal } = init as RequestInit;
			signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
		});

	it.each([
		['an Error', new Error('user left the page')],
		['a TypeError', new TypeError('stale')],
		['a string', 'stale']
	])('aborting with %s as the reason still rejects ABORTED, unretried', async (_name, reason) => {
		fetchMock.mockImplementation(rejectWithReason);
		const controller = new AbortController();
		const promise = fetchCompute('grasshopper', {}, { ...config, signal: controller.signal });
		const assertion = expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
		controller.abort(reason);
		await assertion;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('aborting with a reason while the body streams rejects ABORTED, unretried', async () => {
		const controller = new AbortController();
		fetchMock.mockImplementation(async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(body) {
					controller.signal.addEventListener('abort', () => body.error(controller.signal.reason));
					body.enqueue(new TextEncoder().encode('{"values":'));
				}
			});
			return new Response(stream, { status: 200 });
		});
		const promise = fetchCompute(
			'grasshopper',
			{},
			{
				...config,
				signal: controller.signal,
				maxResponseBytes: 1024
			}
		);
		const assertion = expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		controller.abort(new Error('user left the page'));
		await assertion;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a caller-aborted request rejects and is never retried', async () => {
		const controller = new AbortController();
		controller.abort();

		fetchMock.mockImplementation((_url, init) => {
			if ((init as RequestInit).signal?.aborted) {
				return Promise.reject(new DOMException('Aborted', 'AbortError'));
			}
			return Promise.resolve(createMockResponse({ ok: true }));
		});

		await expect(
			fetchCompute(
				'grasshopper',
				{},
				{
					...config,
					signal: controller.signal,
					retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }
				}
			)
		).rejects.toThrow(/aborted by caller/i);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a timeout is retryable and reported as TIMEOUT_ERROR when exhausted', async () => {
		vi.useFakeTimers();
		try {
			// fetch rejects with a non-caller TimeoutError each attempt.
			fetchMock.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'));

			const promise = fetchCompute(
				'grasshopper',
				{},
				{
					...config,
					timeoutMs: 1000,
					retry: { attempts: 1, baseDelayMs: 100, maxDelayMs: 100 }
				}
			);
			const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
			await vi.advanceTimersByTimeAsync(500);
			await assertion;
			// 1 initial + 1 retry
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('aborting mid-flight rejects ABORTED and is never retried', async () => {
		// The fetch stays pending until the composed signal aborts — the abort
		// fires while the request is in flight, not before it starts.
		fetchMock.mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					(init as RequestInit).signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Aborted', 'AbortError')),
						{ once: true }
					);
				})
		);

		const controller = new AbortController();
		const promise = fetchCompute(
			'grasshopper',
			{},
			{
				...config,
				signal: controller.signal,
				retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 }
			}
		);
		const assertion = expect(promise).rejects.toMatchObject({ code: 'ABORTED' });

		controller.abort();

		await assertion;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	/** A 200 whose body never finishes streaming; `text()` rejects with the signal's reason. */
	function stalledBodyResponse(signal: AbortSignal | null | undefined): Response {
		return {
			...createMockResponse(null, { headers: { 'Content-Type': 'application/json' } }),
			text: () =>
				new Promise<string>((_resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				})
		} as Response;
	}

	it('a timeout while the body streams is TIMEOUT_ERROR, not a JSON parse failure', async () => {
		fetchMock.mockImplementation((_url, init) =>
			Promise.resolve(stalledBodyResponse((init as RequestInit).signal))
		);

		await expect(
			fetchCompute('grasshopper', {}, { ...config, timeoutMs: 20 })
		).rejects.toMatchObject({ code: 'TIMEOUT_ERROR' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a caller abort while the body streams is ABORTED, not a JSON parse failure', async () => {
		fetchMock.mockImplementation((_url, init) =>
			Promise.resolve(stalledBodyResponse((init as RequestInit).signal))
		);

		const controller = new AbortController();
		const promise = fetchCompute('grasshopper', {}, { ...config, signal: controller.signal });
		const assertion = expect(promise).rejects.toMatchObject({ code: 'ABORTED' });

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		controller.abort();

		await assertion;
	});

	it('a runtime-internal abort with no armed timeout is not reported as a timeout', async () => {
		vi.useFakeTimers();
		try {
			// No timeoutMs configured and no caller signal: an AbortError here comes
			// from the runtime itself (e.g. undici socket teardown). It must not be
			// labeled "timed out after undefinedms" / TIMEOUT_ERROR — but it IS as
			// transient as a network drop, so it stays retryable.
			fetchMock.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

			const promise = fetchCompute(
				'grasshopper',
				{},
				{ ...config, retry: { attempts: 1, baseDelayMs: 100, maxDelayMs: 100 } }
			);
			const assertion = expect(promise).rejects.toSatisfy(
				(e: any) =>
					e.code === 'NETWORK_ERROR' &&
					/aborted by the runtime/i.test(e.message) &&
					!/undefined/.test(e.message)
			);
			await vi.advanceTimersByTimeAsync(500);
			await assertion;
			// Retried once — runtime aborts are treated as transient.
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('re-arms the timeout per attempt — each retry composes a fresh signal', async () => {
		vi.useFakeTimers();
		try {
			fetchMock
				.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
				.mockResolvedValueOnce(createMockResponse({ ok: true }));

			const promise = fetchCompute(
				'grasshopper',
				{},
				{
					...config,
					timeoutMs: 30_000,
					retry: { attempts: 1, baseDelayMs: 100, maxDelayMs: 100 }
				}
			);
			await vi.advanceTimersByTimeAsync(500);
			await expect(promise).resolves.toEqual({ ok: true });

			// timeoutMs is per-attempt: each attempt gets its own composed signal,
			// so the documented worst-case wall clock is attempts × timeoutMs + backoff.
			expect(fetchMock).toHaveBeenCalledTimes(2);
			const firstSignal = fetchMock.mock.calls[0][1].signal;
			const secondSignal = fetchMock.mock.calls[1][1].signal;
			expect(firstSignal).toBeInstanceOf(AbortSignal);
			expect(secondSignal).toBeInstanceOf(AbortSignal);
			expect(firstSignal).not.toBe(secondSignal);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('fetchCompute — config validation', () => {
	it.each([
		['timeoutMs Infinity', { timeoutMs: Infinity }],
		['timeoutMs NaN', { timeoutMs: NaN }],
		['timeoutMs past what AbortSignal.timeout takes', { timeoutMs: 2 ** 32 }],
		['retry.attempts NaN', { retry: { attempts: NaN } }],
		['retry.attempts Infinity', { retry: { attempts: Infinity } }],
		['retry.attempts negative', { retry: { attempts: -1 } }],
		['retry.baseDelayMs NaN', { retry: { baseDelayMs: NaN } }],
		['retry.maxDelayMs NaN', { retry: { maxDelayMs: NaN } }],
		['maxResponseBytes NaN', { maxResponseBytes: NaN }]
	])('rejects %s before touching the network', async (_name, bad) => {
		await expect(fetchCompute('grasshopper', {}, { ...config, ...bad })).rejects.toMatchObject({
			code: 'INVALID_CONFIG'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('accepts a fractional timeoutMs', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
		await expect(
			fetchCompute('grasshopper', {}, { ...config, timeoutMs: 1500.5 })
		).resolves.toEqual({ ok: true });
	});

	it('still treats timeoutMs 0 as no timeout', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
		await fetchCompute('grasshopper', {}, { ...config, timeoutMs: 0 });
		expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeUndefined();
	});
});

describe('fetchCompute — invalid header values', () => {
	it.each([
		['apiKey', { apiKey: 'super-secret\nkey' }],
		['authToken', { authToken: 'Bearer super-secret\nkey' }],
		['a caller header', { headers: { 'X-Tenant': 'super-secret\nkey' } }]
	])('rejects a bad %s with INVALID_CONFIG, never quoting it', async (_name, bad) => {
		const error = await rejection(
			fetchCompute('grasshopper', {}, { ...config, ...bad, retry: { attempts: 3, baseDelayMs: 1 } })
		);
		expect(error).toBeInstanceOf(ComputeError);
		expect(error.code).toBe('INVALID_CONFIG');
		expect(JSON.stringify({ message: error.message, context: error.context })).not.toContain(
			'super-secret'
		);
		expect(error.originalError).toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('fetchCompute — custom fetch', () => {
	it('sends through ComputeConfig.fetch instead of the global', async () => {
		const custom = vi.fn().mockResolvedValue(createMockResponse({ ok: true }));
		await fetchCompute('grasshopper', {}, { ...config, fetch: custom });
		expect(custom).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('fetchCompute — error context', () => {
	it('keeps diagnostic response headers and drops the rest', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response('nope', {
				status: 403,
				headers: {
					'Set-Cookie': 'sid=topsecret',
					'Retry-After': '5',
					'Content-Type': 'text/plain',
					'X-Request-ID': 'abc'
				}
			})
		);
		const error = await rejection(fetchCompute('grasshopper', {}, config));
		expect(error.context?.responseHeaders).toEqual({
			'content-type': 'text/plain',
			'retry-after': '5',
			'x-request-id': 'abc'
		});
	});
});
