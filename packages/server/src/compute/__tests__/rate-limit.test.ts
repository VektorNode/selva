import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	createComputeRateLimiter,
	DEFAULT_MAX_KEYS,
	type ComputeRateLimiter
} from '../rate-limit.js';

const WINDOW_MS = 100_000;
const MAX_PER_WINDOW = 120;

describe('createComputeRateLimiter', () => {
	let limiter: ComputeRateLimiter;

	beforeEach(() => {
		limiter = createComputeRateLimiter({ windowMs: WINDOW_MS, maxPerWindow: MAX_PER_WINDOW });
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('allows up to maxPerWindow requests in the window', () => {
		for (let i = 0; i < MAX_PER_WINDOW; i++) {
			expect(limiter.check('user:alice').allowed).toBe(true);
		}
	});

	it('rejects the (MAX+1)th request with retryAfter set', () => {
		for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check('user:alice');
		const result = limiter.check('user:alice');
		expect(result.allowed).toBe(false);
		expect(result.retryAfter).toBeGreaterThan(0);
		expect(result.retryAfter).toBeLessThanOrEqual(WINDOW_MS / 1000);
	});

	it('isolates buckets per key', () => {
		for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check('user:alice');
		expect(limiter.check('user:alice').allowed).toBe(false);
		expect(limiter.check('user:bob').allowed).toBe(true);
	});

	it("share-link buckets don't collide with user buckets sharing an id", () => {
		const id = '00000000-0000-0000-0000-000000000001';
		for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check(`share:${id}`);
		expect(limiter.check(`share:${id}`).allowed).toBe(false);
		expect(limiter.check(`user:${id}`).allowed).toBe(true);
	});

	it('rolls over when the window expires', () => {
		for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check('user:alice');
		expect(limiter.check('user:alice').allowed).toBe(false);

		vi.advanceTimersByTime(WINDOW_MS + 1);

		expect(limiter.check('user:alice').allowed).toBe(true);
	});

	it('does not pre-increment a fresh bucket past the cap', () => {
		// Regression guard: an off-by-one in the "no entry yet" branch could
		// initialize at count=1 but treat the FIRST call as already capped.
		expect(limiter.check('user:fresh').allowed).toBe(true);
	});

	it('separate limiters own separate bucket state', () => {
		const other = createComputeRateLimiter({ windowMs: WINDOW_MS, maxPerWindow: MAX_PER_WINDOW });
		for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check('user:alice');
		expect(limiter.check('user:alice').allowed).toBe(false);
		// A different limiter instance is unaffected.
		expect(other.check('user:alice').allowed).toBe(true);
	});

	// The bucket Map is process-local and long-lived: without these it grows with
	// every distinct key ever seen (each user, share link, login IP — forever).
	describe('bucket eviction', () => {
		it('sweeps expired buckets once a sweep interval has passed', () => {
			for (let i = 0; i < 50; i++) limiter.check(`user:${i}`);
			expect(limiter.size()).toBe(50);

			// Buckets are now expired, but nothing revisits them on their own.
			vi.advanceTimersByTime(WINDOW_MS + 1);
			expect(limiter.size()).toBe(50);

			// Any call past the sweep interval collects the dead ones.
			limiter.check('user:latecomer');
			expect(limiter.size()).toBe(1);
		});

		it('sweeping never resurrects budget for a still-live bucket', () => {
			for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check('user:alice');
			expect(limiter.check('user:alice').allowed).toBe(false);

			// Advance far enough to trigger a sweep, but not past alice's reset.
			vi.advanceTimersByTime(WINDOW_MS - 1);
			for (let i = 0; i < 20; i++) limiter.check(`user:filler${i}`);

			expect(limiter.check('user:alice').allowed).toBe(false);
		});

		it('caps retained buckets when every bucket is still live', () => {
			const capped = createComputeRateLimiter({
				windowMs: WINDOW_MS,
				maxPerWindow: MAX_PER_WINDOW,
				maxKeys: 10
			});
			// No bucket has expired, so the sweep frees nothing — the cap must.
			for (let i = 0; i < 200; i++) capped.check(`user:${i}`);
			expect(capped.size()).toBeLessThanOrEqual(10);
		});

		it('evicts the buckets nearest their reset first', () => {
			const capped = createComputeRateLimiter({
				windowMs: WINDOW_MS,
				maxPerWindow: MAX_PER_WINDOW,
				maxKeys: 2
			});
			capped.check('user:oldest');
			vi.advanceTimersByTime(1);
			capped.check('user:middle');
			vi.advanceTimersByTime(1);
			// Spend newest's budget so a surviving bucket is observable via peek.
			for (let i = 0; i < MAX_PER_WINDOW; i++) capped.check('user:newest');

			expect(capped.size()).toBeLessThanOrEqual(2);
			// The freshest bucket keeps its state; the oldest was forgiven.
			expect(capped.peek('user:newest').allowed).toBe(false);
		});

		it('peek drives the sweep too, without recording anything', () => {
			for (let i = 0; i < 50; i++) limiter.check(`ip:${i}`);
			vi.advanceTimersByTime(WINDOW_MS + 1);

			limiter.peek('ip:observer');

			// The 50 dead buckets are gone, and peek added none of its own.
			expect(limiter.size()).toBe(0);
		});

		it('exposes the resolved defaults on config', () => {
			expect(limiter.config.maxKeys).toBe(DEFAULT_MAX_KEYS);
			expect(limiter.config.sweepIntervalMs).toBe(WINDOW_MS);
		});
	});

	// peek + clear support failure-counting flows (login limiting): peek gates
	// the attempt without spending budget, check records a failure, clear
	// forgives on success.
	describe('peek / clear', () => {
		it('peek never increments the counter', () => {
			for (let i = 0; i < 1000; i++) expect(limiter.peek('ip:1.2.3.4').allowed).toBe(true);
			// Full budget still available after all those peeks.
			for (let i = 0; i < MAX_PER_WINDOW; i++) {
				expect(limiter.check('ip:1.2.3.4').allowed).toBe(true);
			}
		});

		it('peek reports a full bucket with retryAfter, still without mutating it', () => {
			for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check('ip:1.2.3.4');
			const result = limiter.peek('ip:1.2.3.4');
			expect(result.allowed).toBe(false);
			expect(result.retryAfter).toBeGreaterThan(0);
		});

		it('peek allows again once the window expires', () => {
			for (let i = 0; i < MAX_PER_WINDOW; i++) limiter.check('ip:1.2.3.4');
			expect(limiter.peek('ip:1.2.3.4').allowed).toBe(false);
			vi.advanceTimersByTime(WINDOW_MS + 1);
			expect(limiter.peek('ip:1.2.3.4').allowed).toBe(true);
		});

		it('clear drops only the given key', () => {
			for (let i = 0; i < MAX_PER_WINDOW; i++) {
				limiter.check('ip:1.2.3.4');
				limiter.check('ip:5.6.7.8');
			}
			limiter.clear('ip:1.2.3.4');
			expect(limiter.peek('ip:1.2.3.4').allowed).toBe(true);
			expect(limiter.peek('ip:5.6.7.8').allowed).toBe(false);
		});
	});
});
