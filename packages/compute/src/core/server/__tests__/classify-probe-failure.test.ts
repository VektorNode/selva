import { describe, it, expect } from 'vitest';

import { classifyProbeFailure } from '../classify-probe-failure';

describe('classifyProbeFailure', () => {
	it('returns null for an online probe', () => {
		expect(classifyProbeFailure({ online: true, status: 200 })).toBeNull();
	});

	describe('HTTP responses', () => {
		it('treats 401/403 as a non-retryable auth failure', () => {
			for (const status of [401, 403]) {
				const result = classifyProbeFailure({ online: false, status });
				expect(result?.verdict).toBe('unauthorized');
				expect(result?.retryable).toBe(false);
				expect(result?.summary).toContain('API key');
			}
		});

		it('treats 5xx as retryable — a proxy in front of a starting child', () => {
			const result = classifyProbeFailure({ online: false, status: 503 });
			expect(result?.verdict).toBe('http_error');
			expect(result?.retryable).toBe(true);
		});

		it('treats a non-auth 4xx as non-retryable', () => {
			const result = classifyProbeFailure({ online: false, status: 404 });
			expect(result?.verdict).toBe('http_error');
			expect(result?.retryable).toBe(false);
		});

		it('prefers the status over the error when both are present', () => {
			const result = classifyProbeFailure({
				online: false,
				status: 401,
				error: 'Error: ECONNREFUSED'
			});
			expect(result?.verdict).toBe('unauthorized');
		});
	});

	describe('connection errors', () => {
		it('classifies refused connections as non-retryable', () => {
			// Node, undici-wrapped, and browser spellings of the same failure.
			const spellings = [
				'Error: connect ECONNREFUSED 127.0.0.1:6500',
				'TypeError: fetch failed: ERR_CONNECTION_REFUSED',
				'connection refused'
			];
			for (const error of spellings) {
				const result = classifyProbeFailure({ online: false, error });
				expect(result?.verdict).toBe('refused');
				expect(result?.retryable).toBe(false);
			}
		});

		it('classifies DNS failures as retryable — EAI_AGAIN is a resolver timeout', () => {
			for (const error of ['Error: getaddrinfo ENOTFOUND compute.example', 'EAI_AGAIN']) {
				const result = classifyProbeFailure({ online: false, error });
				expect(result?.verdict).toBe('dns');
				expect(result?.retryable).toBe(true);
			}
		});

		it('classifies timeouts and unreachable hosts as retryable', () => {
			const spellings = [
				'TimeoutError: The operation was aborted due to timeout',
				'Error: connect ETIMEDOUT 10.0.0.5:6500',
				'Error: connect EHOSTUNREACH',
				'AbortError: This operation was aborted'
			];
			for (const error of spellings) {
				const result = classifyProbeFailure({ online: false, error });
				expect(result?.verdict).toBe('timeout');
				expect(result?.retryable).toBe(true);
			}
		});

		it('defaults an unrecognized failure to retryable', () => {
			const result = classifyProbeFailure({ online: false, error: 'something odd happened' });
			expect(result?.verdict).toBe('unknown');
			expect(result?.retryable).toBe(true);
			expect(result?.summary).toContain('something odd happened');
		});

		it('handles a failure with no detail at all', () => {
			const result = classifyProbeFailure({ online: false });
			expect(result?.verdict).toBe('unknown');
			expect(result?.retryable).toBe(true);
		});
	});
});
