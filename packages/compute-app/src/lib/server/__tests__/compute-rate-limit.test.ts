import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	checkComputeRateLimit,
	__resetComputeRateLimitForTests,
	__computeRateLimitConfigForTests as cfg
} from '../computeRateLimit.server.js';

describe('checkComputeRateLimit', () => {
	beforeEach(() => {
		__resetComputeRateLimitForTests();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('allows up to MAX_PER_WINDOW requests in the window', () => {
		for (let i = 0; i < cfg.MAX_PER_WINDOW; i++) {
			const result = checkComputeRateLimit('user:alice');
			expect(result.allowed).toBe(true);
		}
	});

	it('rejects the (MAX+1)th request with retryAfter set', () => {
		for (let i = 0; i < cfg.MAX_PER_WINDOW; i++) {
			checkComputeRateLimit('user:alice');
		}
		const result = checkComputeRateLimit('user:alice');
		expect(result.allowed).toBe(false);
		expect(result.retryAfter).toBeGreaterThan(0);
		expect(result.retryAfter).toBeLessThanOrEqual(cfg.WINDOW_MS / 1000);
	});

	it('isolates buckets per key', () => {
		// Alice exhausts her bucket; Bob is unaffected.
		for (let i = 0; i < cfg.MAX_PER_WINDOW; i++) {
			checkComputeRateLimit('user:alice');
		}
		expect(checkComputeRateLimit('user:alice').allowed).toBe(false);
		expect(checkComputeRateLimit('user:bob').allowed).toBe(true);
	});

	it("share-link buckets don't collide with user buckets sharing an id", () => {
		// `share:abc` and `user:abc` are distinct keys even with the same suffix.
		const id = '00000000-0000-0000-0000-000000000001';
		for (let i = 0; i < cfg.MAX_PER_WINDOW; i++) {
			checkComputeRateLimit(`share:${id}`);
		}
		expect(checkComputeRateLimit(`share:${id}`).allowed).toBe(false);
		expect(checkComputeRateLimit(`user:${id}`).allowed).toBe(true);
	});

	it('rolls over when the window expires', () => {
		for (let i = 0; i < cfg.MAX_PER_WINDOW; i++) {
			checkComputeRateLimit('user:alice');
		}
		expect(checkComputeRateLimit('user:alice').allowed).toBe(false);

		vi.advanceTimersByTime(cfg.WINDOW_MS + 1);

		// New window — full quota restored.
		expect(checkComputeRateLimit('user:alice').allowed).toBe(true);
	});

	it('does not pre-increment a fresh bucket past the cap', () => {
		// Regression guard: an off-by-one in the "no entry yet" branch could
		// initialize at count=1 but treat the FIRST call as already capped.
		const first = checkComputeRateLimit('user:fresh');
		expect(first.allowed).toBe(true);
	});
});
