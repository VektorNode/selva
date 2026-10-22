import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCompute } from '@/core/compute-fetch/compute-fetch';
import type { ComputeError } from '@/core/errors';
import { createMockResponse } from '@tests/helpers/mock-fetch';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const config = { serverUrl: 'http://localhost:6500', apiKey: 'secret' };

afterEach(() => {
	fetchMock.mockReset();
});

async function rejection(call: Promise<unknown>): Promise<ComputeError> {
	return call.then(
		() => {
			throw new Error('expected a rejection');
		},
		(error: ComputeError) => error
	);
}

/** A body that streams `chunk` until cancelled, recording the cancel. */
function endlessBody(chunk: string) {
	const bytes = new TextEncoder().encode(chunk);
	const state = { cancelled: false, pulled: 0 };
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			state.pulled++;
			controller.enqueue(bytes);
		},
		cancel() {
			state.cancelled = true;
		}
	});
	return { stream, state };
}

describe('fetchCompute — redirects', () => {
	it('asks fetch not to follow redirects', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ values: [] }));
		await fetchCompute('grasshopper', {}, config);
		expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
	});

	it('rejects a 3xx with INVALID_CONFIG naming the target, without retrying', async () => {
		fetchMock.mockResolvedValue(
			new Response(null, {
				status: 307,
				headers: { Location: 'http://elsewhere:9000/grasshopper' }
			})
		);

		const error = await rejection(
			fetchCompute('grasshopper', {}, { ...config, retry: { attempts: 3 } })
		);

		expect(error).toMatchObject({ code: 'INVALID_CONFIG', statusCode: 307 });
		expect(error.message).toContain('http://elsewhere:9000/grasshopper');
		expect(error.context?.location).toBe('http://elsewhere:9000/grasshopper');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("rejects a browser's opaque redirect the same way", async () => {
		const opaque = {
			...createMockResponse(null, { ok: false, status: 0 }),
			type: 'opaqueredirect'
		};
		fetchMock.mockResolvedValueOnce(opaque);

		await expect(fetchCompute('grasshopper', {}, config)).rejects.toMatchObject({
			code: 'INVALID_CONFIG'
		});
	});
});

describe('fetchCompute — maxResponseBytes', () => {
	it('cancels a streaming success body once it passes the limit', async () => {
		const { stream, state } = endlessBody('x'.repeat(1024));
		fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

		await expect(
			fetchCompute('grasshopper', {}, { ...config, maxResponseBytes: 10_000 })
		).rejects.toMatchObject({
			code: 'RESPONSE_TOO_LARGE',
			statusCode: 200,
			context: { maxResponseBytes: 10_000 }
		});
		expect(state.cancelled).toBe(true);
		expect(state.pulled).toBeLessThan(20);
	});

	it('refuses a declared oversize body without reading it', async () => {
		const { stream, state } = endlessBody('x');
		fetchMock.mockResolvedValueOnce(
			new Response(stream, { status: 200, headers: { 'Content-Length': '50000' } })
		);

		await expect(
			fetchCompute('grasshopper', {}, { ...config, maxResponseBytes: 10_000 })
		).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
		expect(state.cancelled).toBe(true);
	});

	it('reads a body at or under the limit', async () => {
		const body = JSON.stringify({ values: [{ ParamName: 'p', InnerTree: {} }] });
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		await expect(
			fetchCompute('grasshopper', {}, { ...config, maxResponseBytes: body.length })
		).resolves.toEqual(JSON.parse(body));
	});

	it('counts UTF-8 bytes, not characters', async () => {
		const body = JSON.stringify({ label: 'ü'.repeat(100) });
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));

		await expect(
			fetchCompute('grasshopper', {}, { ...config, maxResponseBytes: body.length + 50 })
		).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
	});

	it('applies the limit to a 500 partial success', async () => {
		const body = JSON.stringify({ values: [{ data: 'x'.repeat(5000) }], errors: ['boom'] });
		fetchMock.mockResolvedValueOnce(new Response(body, { status: 500 }));

		await expect(
			fetchCompute('grasshopper', {}, { ...config, maxResponseBytes: 1000 })
		).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', statusCode: 500 });
	});

	it('enforces the limit on a response without a body stream', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ data: 'x'.repeat(5000) }));

		await expect(
			fetchCompute('grasshopper', {}, { ...config, maxResponseBytes: 1000 })
		).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
	});
});

describe('fetchCompute — error bodies', () => {
	it('stops reading a huge error page but still maps the status', async () => {
		const { stream, state } = endlessBody('<html>' + 'x'.repeat(64 * 1024));
		fetchMock.mockResolvedValueOnce(new Response(stream, { status: 503, statusText: 'Down' }));

		const error = await rejection(fetchCompute('grasshopper', {}, config));

		expect(error).toMatchObject({ code: 'NETWORK_ERROR', statusCode: 503 });
		expect(String(error.context?.responseBody).length).toBeLessThan(5000);
		expect(state.cancelled).toBe(true);
	});
});

describe('fetchCompute — serverUrl', () => {
	it('rejects an unusable serverUrl with INVALID_CONFIG before touching the network', async () => {
		for (const serverUrl of ['', 'localhost:6500', 'http://user:pass@host', 'http://host/?x=1']) {
			await expect(fetchCompute('io', {}, { serverUrl })).rejects.toMatchObject({
				code: 'INVALID_CONFIG'
			});
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('leaves host blocking to the backend', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
		await fetchCompute('io', {}, { serverUrl: 'https://compute.rhino3d.com' });
		expect(fetchMock.mock.calls[0][0]).toBe('https://compute.rhino3d.com/io');
	});

	it('joins a serverUrl with trailing slashes cleanly', async () => {
		fetchMock.mockResolvedValueOnce(createMockResponse({ ok: true }));
		await fetchCompute('/io', {}, { serverUrl: 'http://localhost:6500///' });
		expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:6500/io');
	});
});

describe('fetchCompute — maxResponseBytes validation', () => {
	it('rejects a limit that is not a byte count before touching the network', async () => {
		for (const maxResponseBytes of [Number.NaN, -1]) {
			await expect(
				fetchCompute('grasshopper', {}, { ...config, maxResponseBytes })
			).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
