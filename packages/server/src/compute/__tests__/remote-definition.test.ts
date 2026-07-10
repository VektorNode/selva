/**
 * Tests for `createRemoteDefinitionFetcher` — the SSRF-guarded, capped, TTL-cached
 * remote `.gh` fetch (K3).
 *
 * `safe-url` is mocked so the host check is a controllable pass/fail (its own
 * SSRF logic is covered in safe-url.test.ts), and `fetch` is stubbed per test to
 * return scripted bodies/headers. The injected `now` clock makes the TTL cache
 * deterministic without real time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock the SSRF guard ---------------------------------------------------
const assertSafe = vi.fn(async (_url: string) => {});
vi.mock('../safe-url.js', () => ({
	assertSafeRemoteDefinitionUrl: (url: string) => assertSafe(url)
}));

import { createRemoteDefinitionFetcher, readBodyWithCap } from '../index.js';

/** A Response whose body streams the given bytes in one chunk. */
function streamResponse(bytes: Uint8Array, init: { contentLength?: string | null } = {}): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		}
	});
	const headers = new Headers();
	if (init.contentLength !== null && init.contentLength !== undefined) {
		headers.set('content-length', init.contentLength);
	}
	return new Response(body, { status: 200, headers });
}

const baseConfig = () => ({
	maxBytes: 1024,
	fetchTimeoutMs: 5_000,
	cacheTtlMs: 60_000,
	now: () => 1_000
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	assertSafe.mockClear();
	assertSafe.mockResolvedValue(undefined);
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createRemoteDefinitionFetcher — happy path', () => {
	it('runs the SSRF guard and returns the fetched bytes', async () => {
		const bytes = new Uint8Array([9, 8, 7]);
		fetchMock.mockResolvedValue(streamResponse(bytes, { contentLength: '3' }));
		const fetcher = createRemoteDefinitionFetcher(baseConfig());

		const out = await fetcher.load('https://example.com/def.gh');
		expect(out).toEqual(bytes);
		expect(assertSafe).toHaveBeenCalledWith('https://example.com/def.gh');
		expect(fetchMock).toHaveBeenCalledWith(
			'https://example.com/def.gh',
			expect.objectContaining({ redirect: 'error' })
		);
	});

	it('caches within TTL (one fetch) and refetches after TTL expires', async () => {
		const bytes = new Uint8Array([1]);
		// Fresh Response per call — a stream body can only be read once.
		fetchMock.mockImplementation(async () => streamResponse(bytes, { contentLength: '1' }));
		let clock = 1_000;
		const fetcher = createRemoteDefinitionFetcher({ ...baseConfig(), now: () => clock });

		await fetcher.load('https://example.com/a.gh');
		await fetcher.load('https://example.com/a.gh'); // within TTL → cached
		expect(fetchMock).toHaveBeenCalledTimes(1);

		clock += 60_001; // past the 60s TTL
		await fetcher.load('https://example.com/a.gh');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('createRemoteDefinitionFetcher — rejections', () => {
	it('does not fetch when the SSRF guard rejects', async () => {
		assertSafe.mockRejectedValue(new Error('blocked private host'));
		const fetcher = createRemoteDefinitionFetcher(baseConfig());
		await expect(fetcher.load('http://169.254.169.254/')).rejects.toThrow('blocked private host');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('throws on a non-2xx response', async () => {
		fetchMock.mockResolvedValue(new Response('nope', { status: 404, statusText: 'Not Found' }));
		const fetcher = createRemoteDefinitionFetcher(baseConfig());
		await expect(fetcher.load('https://example.com/missing.gh')).rejects.toThrow('HTTP 404');
	});

	it('rejects early when the declared content-length exceeds the cap', async () => {
		fetchMock.mockResolvedValue(streamResponse(new Uint8Array([1, 2]), { contentLength: '99999' }));
		const fetcher = createRemoteDefinitionFetcher({ ...baseConfig(), maxBytes: 10 });
		await expect(fetcher.load('https://example.com/big.gh')).rejects.toThrow('exceeds size limit');
	});

	it('rejects when the streamed body exceeds the cap despite a missing content-length', async () => {
		// No content-length header — the streaming cap must still catch it.
		fetchMock.mockResolvedValue(streamResponse(new Uint8Array(50), { contentLength: null }));
		const fetcher = createRemoteDefinitionFetcher({ ...baseConfig(), maxBytes: 10 });
		await expect(fetcher.load('https://example.com/lying.gh')).rejects.toThrow(
			'exceeds size limit'
		);
	});
});

describe('readBodyWithCap', () => {
	it('reads a streamed body under the cap', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const out = await readBodyWithCap(streamResponse(bytes), 10, new AbortController());
		expect(out).toEqual(bytes);
	});

	it('aborts and throws once the running total crosses the cap', async () => {
		const controller = new AbortController();
		await expect(
			readBodyWithCap(streamResponse(new Uint8Array(20)), 5, controller)
		).rejects.toThrow('exceeds size limit');
		expect(controller.signal.aborted).toBe(true);
	});

	it('falls back to arrayBuffer when there is no stream body', async () => {
		// A Response built from a string still exposes a body stream in undici, so
		// construct one without a body to hit the fallback branch.
		const noBody = new Response(null, { status: 200 });
		const out = await readBodyWithCap(noBody, 10, new AbortController());
		expect(out).toEqual(new Uint8Array(0));
	});
});
