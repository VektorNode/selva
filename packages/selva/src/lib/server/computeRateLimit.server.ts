/**
 * App-side binding for the compute-solve rate limiter. The limiter itself
 * (fixed-window, per-key, process-local) lives in `@selvajs/server`
 * (`createComputeRateLimiter`); this module owns the single app-wide instance,
 * wired with the window + cap from `computeLimits.ts` (which read the env).
 *
 * Keyed by caller — `user:{userId}` for authenticated solves, `share:{linkId}`
 * for share-token solves so anonymous consumers of one link don't share a
 * bucket with the link's owner.
 */

import { createComputeRateLimiter, type RateLimitResult } from '@selvajs/server/compute';
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from './computeLimits';

const limiter = createComputeRateLimiter({
	windowMs: RATE_LIMIT_WINDOW_MS,
	maxPerWindow: RATE_LIMIT_MAX_REQUESTS
});

/**
 * Check + record one request against `key`. Returns
 * `{ allowed: false, retryAfter }` once the bucket is full.
 */
export function checkComputeRateLimit(key: string): RateLimitResult {
	return limiter.check(key);
}

/**
 * Requests charged to `key` this window. Lets a test assert *which* bucket a
 * request consumed — the route's choice of `share:{linkId}` vs `user:{userId}`
 * is a security property, and an allow/deny verdict alone can't express it.
 */
export function computeRateLimitCount(key: string): number {
	return limiter.count(key);
}

/**
 * Test seam — drop all buckets. The limiter is module-global and the app's
 * tests share one process, so a test that fills a bucket would otherwise leak
 * that state into every test after it. Production code never calls this.
 */
export function resetComputeRateLimit(): void {
	limiter.reset();
}

export type { RateLimitResult };
