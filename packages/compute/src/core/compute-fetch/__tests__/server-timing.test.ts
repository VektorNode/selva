/**
 * Server-Timing seam: the solve endpoint emits a per-request timing breakdown
 * (`decode;dur=N, solve;dur=N, encode;dur=N`) on every response. These pin the
 * parser and the onServerTiming callback wiring.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCompute } from '../compute-fetch';
import { parseServerTiming } from '../server-timing';
import { createMockResponse } from '@tests/helpers/mock-fetch';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const config = { serverUrl: 'http://localhost:6500' };

afterEach(() => fetchMock.mockReset());

describe('parseServerTiming', () => {
	it('parses the solve endpoint format', () => {
		expect(parseServerTiming('decode;dur=3, solve;dur=120, encode;dur=8')).toEqual({
			decode: 3,
			solve: 120,
			encode: 8,
			raw: 'decode;dur=3, solve;dur=120, encode;dur=8'
		});
	});

	it.each([
		['a subset of metrics', 'solve;dur=42', { solve: 42 }],
		['an unknown metric beside a known one', 'cache;dur=5, solve;dur=10', { solve: 10 }]
	])('parses %s', (_name, header, expected) => {
		expect(parseServerTiming(header)).toEqual({ ...expected, raw: header });
	});

	it.each([
		['a missing header', null],
		['no recognizable metric', 'miss'],
		['only an unknown metric', 'cache;dur=5'],
		['a non-numeric dur', 'solve;dur=abc'],
		['a malformed recomputed count', 'recomputed;desc="n/a"']
	])('returns null for %s', (_name, header) => {
		expect(parseServerTiming(header)).toBeNull();
	});

	it("reads the fork compute server's gh time and recomputed count through the proxy", () => {
		expect(
			parseServerTiming(
				'decode;dur=2, solve;dur=900, gh;dur=870, harvest;dur=30, encode;dur=5, ' +
					'recomputed;desc="4/97", proxy_wait;dur=0, proxy_child;dur=910'
			)
		).toMatchObject({
			decode: 2,
			solve: 900,
			gh: 870,
			encode: 5,
			recomputed: { ran: 4, total: 97 }
		});
	});

	it('reads a result-cache hit, which carries no durations', () => {
		expect(parseServerTiming('cache;desc="hit", proxy_child;dur=12')).toEqual({
			cacheHit: true,
			raw: 'cache;desc="hit", proxy_child;dur=12'
		});
	});
});

describe('onServerTiming callback', () => {
	it('fires with the parsed timing on a successful solve', async () => {
		const onServerTiming = vi.fn();
		fetchMock.mockResolvedValueOnce(
			createMockResponse(
				{ values: [] },
				{ headers: { 'Server-Timing': 'decode;dur=2, solve;dur=50, encode;dur=4' } }
			)
		);

		await fetchCompute('grasshopper', {}, { ...config, onServerTiming });

		expect(onServerTiming).toHaveBeenCalledTimes(1);
		expect(onServerTiming).toHaveBeenCalledWith(
			expect.objectContaining({ decode: 2, solve: 50, encode: 4 }),
			expect.any(String)
		);
	});

	it('passes the same requestId sent as the X-Request-ID header', async () => {
		const onServerTiming = vi.fn();
		fetchMock.mockResolvedValueOnce(
			createMockResponse({ values: [] }, { headers: { 'Server-Timing': 'solve;dur=1' } })
		);

		await fetchCompute('grasshopper', {}, { ...config, onServerTiming });

		const sentHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
		const [, requestId] = onServerTiming.mock.calls[0];
		expect(requestId).toBe(sentHeaders['X-Request-ID']);
		expect(requestId).toEqual(expect.any(String));
		expect(requestId.length).toBeGreaterThan(0);
	});

	it('does not fire when the response has no Server-Timing header', async () => {
		const onServerTiming = vi.fn();
		fetchMock.mockResolvedValueOnce(createMockResponse({ values: [] }));

		await fetchCompute('grasshopper', {}, { ...config, onServerTiming });

		expect(onServerTiming).not.toHaveBeenCalled();
	});

	it('fires on the 500 partial-success path too (values + errors)', async () => {
		const onServerTiming = vi.fn();
		fetchMock.mockResolvedValueOnce(
			createMockResponse(null, {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				body: JSON.stringify({ values: [{ ParamName: 'out' }], errors: ['boom'], warnings: [] }),
				headers: { 'Server-Timing': 'decode;dur=2, solve;dur=77, encode;dur=4' }
			})
		);

		const res = await fetchCompute('grasshopper', {}, { ...config, onServerTiming });

		// The partial-success body is returned, not thrown — and its timing (often
		// the slowest solves) must not be dropped from telemetry.
		expect(res).toMatchObject({ errors: ['boom'] });
		expect(onServerTiming).toHaveBeenCalledTimes(1);
		expect(onServerTiming).toHaveBeenCalledWith(
			expect.objectContaining({ solve: 77 }),
			expect.any(String)
		);
	});

	it('a throwing callback does not fail the request', async () => {
		const onServerTiming = vi.fn(() => {
			throw new Error('boom');
		});
		fetchMock.mockResolvedValueOnce(
			createMockResponse({ values: [1] }, { headers: { 'Server-Timing': 'solve;dur=9' } })
		);

		await expect(fetchCompute('grasshopper', {}, { ...config, onServerTiming })).resolves.toEqual({
			values: [1]
		});
		expect(onServerTiming).toHaveBeenCalled();
	});
});
