import { describe, expect, it, vi } from 'vitest';
import { ApiError, ApiErrorCode } from '../errors.js';
import { runHandler } from '../respond.js';
import type { ApiRequest } from '../types.js';

const REQ = {
	request: new Request('http://localhost/x'),
	log: { error: vi.fn() },
	deps: { apiRateLimiter: null }
} as unknown as ApiRequest;

const busy = () =>
	new ApiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, 'Busy.', undefined, { retryAfter: '7' });

describe('runHandler and Retry-After', () => {
	it("sends a thrown error's retryAfter as the header", async () => {
		const res = await runHandler(
			async () => {
				throw busy();
			},
			REQ,
			{ fallback: 'Failed.' }
		);

		expect(res.status).toBe(503);
		expect(res.headers.get('Retry-After')).toBe('7');
		expect(res.headers.get('content-type')).toContain('application/json');
	});

	it('does the same for an error `mapError` produced', async () => {
		const res = await runHandler(
			async () => {
				throw new Error('host error');
			},
			REQ,
			{ fallback: 'Failed.', mapError: busy }
		);

		expect(res.headers.get('Retry-After')).toBe('7');
	});

	it('sends no header for an error without one', async () => {
		const res = await runHandler(
			async () => {
				throw new ApiError(404, ApiErrorCode.NOT_FOUND, 'Gone.');
			},
			REQ,
			{ fallback: 'Failed.' }
		);

		expect(res.headers.has('Retry-After')).toBe(false);
	});
});
