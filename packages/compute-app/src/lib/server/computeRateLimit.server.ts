/**
 * Per-key fixed-window rate limit for `/api/compute`. Compute solves are the
 * one expensive endpoint in the app — without a cap a single authenticated
 * user (or share-link consumer) can burn through compute budget far faster
 * than any other surface allows.
 *
 * Design:
 *  - Process-local Map. Multi-instance deployments will see N× the per-key
 *    rate — acceptable as a first line; a proper distributed limiter is a
 *    follow-up tracked alongside the H12 cross-instance cache work.
 *  - Fixed window (vs sliding) — simpler, no per-request bookkeeping, and
 *    the "burst at window edges" failure mode is fine for this surface
 *    (the share-link `maxSolves` cap and per-user authentication already
 *    prevent unbounded abuse — this exists to flatten short spikes).
 *  - Keyed by caller — `user:{userId}` for authenticated solves,
 *    `share:{linkId}` for share-token solves so anonymous consumers of one
 *    link don't share a bucket with the link's owner.
 *
 * Defaults are conservative; the audit recommended "even crude" as a
 * starting point. Tune via env later if real traffic warrants it.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

interface BucketEntry {
	count: number;
	resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

export interface RateLimitResult {
	allowed: boolean;
	/** Seconds until the bucket resets, when not allowed. */
	retryAfter?: number;
}

/**
 * Check + record one request against `key`. Increments the counter on
 * allow. Returns `{ allowed: false, retryAfter }` once the bucket is full.
 */
export function checkComputeRateLimit(key: string): RateLimitResult {
	const now = Date.now();
	const entry = buckets.get(key);

	if (!entry || now > entry.resetAt) {
		buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return { allowed: true };
	}

	if (entry.count >= MAX_PER_WINDOW) {
		return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
	}

	entry.count += 1;
	return { allowed: true };
}

/** Test seam — wipes the in-memory state. Production code never calls this. */
export function __resetComputeRateLimitForTests(): void {
	buckets.clear();
}

/** Test seam — overrides for time-based assertions. */
export const __computeRateLimitConfigForTests = {
	WINDOW_MS,
	MAX_PER_WINDOW
};
