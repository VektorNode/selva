/**
 * Contract tests for the Rhino Compute transport (`fetchRhinoCompute`).
 *
 * The transport is the deepest module in the library — retry/backoff, the
 * HTTP-status → error-code mapping table, the timeout-vs-caller-abort
 * distinction, partial-success 500 handling, and JSON-parse failure all live
 * here. These tests drive it through the global `fetch` (stubbed in
 * tests/setup.ts), which is the same seam the library uses in production.
 *
 * Time is controlled with fake timers so backoff sleeps resolve instantly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRhinoCompute } from '@/core/compute-fetch/compute-fetch';
import { getResponseWireSize } from '@/core/compute-fetch/wire-size';
import { setLogger } from '@/core/utils/logger';
import { createMockResponse } from '@tests/helpers/mock-fetch';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const config = { serverUrl: 'http://localhost:6500' };

afterEach(() => {
	fetchMock.mockReset();
});

describe('fetchRhinoCompute — request shape', () => {
	it('POSTs to <serverUrl>/<endpoint> with JSON body and request id header', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchRhinoCompute('grasshopper', { values: [1, 2] }, config);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://localhost:6500/grasshopper');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ values: [1, 2] });
		expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect((init.headers as Record<string, string>)['X-Request-ID']).toBeTruthy();
	});

	it('sends the API key as the RhinoComputeKey header when configured', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchRhinoCompute('io', {}, { ...config, apiKey: 'secret' });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.RhinoComputeKey).toBe('secret');
	});

	it('sends the API key under a caller-configured apiKeyHeader', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchRhinoCompute(
			'solve',
			{},
			{ ...config, apiKey: 'secret', apiKeyHeader: 'X-Backend-Key' }
		);

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-Backend-Key']).toBe('secret');
		expect(headers.RhinoComputeKey).toBeUndefined();
	});

	it('lets config.headers set RhinoComputeKey once apiKeyHeader has moved the real key elsewhere', async () => {
		// With a custom apiKeyHeader the default name is no longer a transport
		// header, so it falls under the caller-headers layer like any other. The
		// header that actually carries the key still can't be clobbered.
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchRhinoCompute(
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

		await fetchRhinoCompute('io', {}, { ...config, authToken: 'Bearer xyz' });

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer xyz');
	});

	it('sends caller-supplied config.headers on the request', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchRhinoCompute(
			'grasshopper',
			{},
			{ ...config, headers: { 'X-Selva-Definition': 'guid-123' } }
		);

		const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-Selva-Definition']).toBe('guid-123');
	});

	it('never lets config.headers override the transport/auth headers', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));

		await fetchRhinoCompute(
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

	it('does not warn about missing credentials when an auth token is configured', async () => {
		// Regression: the warning only checked apiKey, so authToken-authenticated
		// requests to remote servers logged a spurious "no API key" warning.
		const warn = vi.fn();
		setLogger({ debug: () => {}, info: () => {}, warn, error: () => {} });
		try {
			fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
			await fetchRhinoCompute(
				'io',
				{},
				{ serverUrl: 'https://compute.example.com', authToken: 'Bearer xyz' }
			);
			expect(warn).not.toHaveBeenCalled();

			fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
			await fetchRhinoCompute('io', {}, { serverUrl: 'https://compute.example.com' });
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			setLogger(null);
		}
	});

	it('returns the parsed JSON response', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ values: [], extra: 7 }));
		const res = await fetchRhinoCompute('grasshopper', {}, config);
		expect(res).toEqual({ values: [], extra: 7 });
	});

	it('records the response wire size for downstream byte-budgeted caches', async () => {
		const body = JSON.stringify({ values: [1, 2, 3] });
		fetchMock.mockResolvedValueOnce(createMockResponse(null, { body }));
		const res = await fetchRhinoCompute('grasshopper', {}, config);
		expect(getResponseWireSize(res)).toBe(body.length);
	});
});

describe('fetchRhinoCompute — HTTP status → error code mapping', () => {
	const cases: Array<[number, string, string]> = [
		[401, 'Unauthorized', 'AUTH_ERROR'],
		[403, 'Forbidden', 'AUTH_ERROR'],
		[404, 'Not Found', 'NOT_FOUND'],
		[413, 'Payload Too Large', 'VALIDATION_ERROR'],
		[429, 'Too Many Requests', 'RATE_LIMIT'],
		[500, 'Internal Server Error', 'COMPUTATION_ERROR']
	];

	it.each(cases)('maps HTTP %i (%s) to %s', async (status, statusText, code) => {
		fetchMock.mockResolvedValueOnce(
			createMockResponse({ msg: 'fail' }, { ok: false, status, statusText })
		);

		await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code,
			statusCode: status
		});
	});

	it('maps an unmapped status (418) to UNKNOWN_ERROR', async () => {
		fetchMock.mockResolvedValueOnce(
			createMockResponse({}, { ok: false, status: 418, statusText: "I'm a teapot" })
		);
		await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'UNKNOWN_ERROR',
			statusCode: 418
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
		await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toThrow(/invalid api key/);
	});
});

describe('fetchRhinoCompute — partial success (HTTP 500 with values)', () => {
	it('returns the body instead of throwing when a 500 carries values + errors', async () => {
		const partial = { values: [{ ParamName: 'out' }], errors: ['boom'], warnings: [] };
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: JSON.stringify(partial)
			})
		);

		const res = await fetchRhinoCompute('grasshopper', {}, config);
		expect(res).toEqual(partial);
	});

	it('still throws COMPUTATION_ERROR for a 500 with no values', async () => {
		// Real Compute8 exception shape: { error, message, stackTrace? }. The
		// detailed `message` must surface to the caller (regression-pinned in
		// error-surface.test.ts), not be swallowed by the generic "error" label.
		fetchMock.mockResolvedValue(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: JSON.stringify({
					error: 'Internal Server Error',
					message: 'Invalid argument: bad input'
				})
			})
		);
		await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'COMPUTATION_ERROR',
			statusCode: 500
		});
		await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toThrow(
			/Invalid argument: bad input/
		);
	});
});

describe('fetchRhinoCompute — malformed responses', () => {
	it('throws NETWORK_ERROR when a 200 body with no declared Content-Type is not valid JSON', async () => {
		// No Content-Type header → could be a stream cut mid-body, so this stays
		// the retryable NETWORK_ERROR classification.
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, { ok: true, status: 200, body: 'not json {' })
		);
		await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'NETWORK_ERROR'
		});
	});

	it('does NOT retry a 200 that declares a non-JSON body — INVALID_RESPONSE (issue 87)', async () => {
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
			fetchRhinoCompute(
				'grasshopper',
				{},
				{ ...config, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 } }
			)
		).rejects.toMatchObject({ code: 'INVALID_RESPONSE', statusCode: 200 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('wraps a network-layer TypeError as NETWORK_ERROR', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'NETWORK_ERROR'
		});
	});

	it('classifies a fetch TypeError as CORS_ERROR in a browser context (issue 90)', async () => {
		// tests/setup.ts stubs `window = {}` (no document), which the transport
		// treats as non-browser; adding a document simulates a real browser, where
		// an opaque fetch TypeError is most likely a CORS misconfiguration.
		(globalThis as any).window.document = {};
		try {
			fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
			await expect(fetchRhinoCompute('grasshopper', {}, config)).rejects.toMatchObject({
				code: 'CORS_ERROR'
			});
		} finally {
			delete (globalThis as any).window.document;
		}
	});
});

describe('fetchRhinoCompute — retry', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const retryCfg = { ...config, retry: { attempts: 2, baseDelayMs: 100, maxDelayMs: 100 } };

	it('retries a retryable 503 and resolves on a later success', async () => {
		fetchMock
			.mockResolvedValueOnce(createMockResponse({}, { ok: false, status: 503, statusText: 'down' }))
			.mockResolvedValueOnce(createMockResponse({ ok: 'recovered' }));

		const promise = fetchRhinoCompute('grasshopper', {}, retryCfg);
		await vi.advanceTimersByTimeAsync(200);

		await expect(promise).resolves.toEqual({ ok: 'recovered' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('throws after retries are exhausted, surfacing the last error', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse({}, { ok: false, status: 502, statusText: 'bad gateway' })
		);

		const promise = fetchRhinoCompute('grasshopper', {}, retryCfg);
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
		await expect(fetchRhinoCompute('grasshopper', {}, retryCfg)).rejects.toMatchObject({
			code: 'AUTH_ERROR'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('honors a Retry-After header ABOVE maxDelayMs — the server window wins (issue 101)', async () => {
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

		const promise = fetchRhinoCompute('grasshopper', {}, retryCfg);

		// Retry-After 5s wins over the policy's maxDelayMs (100ms) — retrying
		// earlier would all but guarantee another 429.
		await vi.advanceTimersByTimeAsync(4900);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(200);
		await expect(promise).resolves.toEqual({ ok: 'after-wait' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('caps a pathological Retry-After at the 60s absolute bound (issue 101)', async () => {
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

		const promise = fetchRhinoCompute('grasshopper', {}, retryCfg);

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

		const promise = fetchRhinoCompute('grasshopper', {}, retryCfg);

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
		const promise = fetchRhinoCompute(
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

		const promise = fetchRhinoCompute('grasshopper', {}, retryCfg);
		await vi.advanceTimersByTimeAsync(500);

		await expect(promise).resolves.toEqual({ values: [1, 2] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('fetchRhinoCompute — abort and timeout', () => {
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
			fetchRhinoCompute(
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

			const promise = fetchRhinoCompute(
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
		const promise = fetchRhinoCompute(
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

	it('a runtime-internal abort with no armed timeout is not reported as a timeout (issue 88)', async () => {
		vi.useFakeTimers();
		try {
			// No timeoutMs configured and no caller signal: an AbortError here comes
			// from the runtime itself (e.g. undici socket teardown). It must not be
			// labeled "timed out after undefinedms" / TIMEOUT_ERROR — but it IS as
			// transient as a network drop, so it stays retryable.
			fetchMock.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

			const promise = fetchRhinoCompute(
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

	it('re-arms the timeout per attempt — each retry composes a fresh signal (issue 89 doc pin)', async () => {
		vi.useFakeTimers();
		try {
			fetchMock
				.mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
				.mockResolvedValueOnce(createMockResponse({ ok: true }));

			const promise = fetchRhinoCompute(
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
