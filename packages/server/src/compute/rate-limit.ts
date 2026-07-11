/**
 * Per-key fixed-window rate limiter for the compute-solve endpoint. Compute
 * solves are the one expensive endpoint in a Selva-engine app — without a cap a
 * single authenticated user (or share-link consumer) can burn through compute
 * budget far faster than any other surface allows.
 *
 * Design:
 *  - Process-local `Map`. Multi-instance deployments see N× the per-key rate —
 *    acceptable as a first line; a distributed limiter is a follow-up. The state
 *    lives behind this factory so a shared-store implementation can slot in
 *    later without changing the call sites.
 *  - Fixed window (vs sliding) — simpler, no per-request bookkeeping; the
 *    "burst at window edges" mode is fine here (share-link `maxSolves` and
 *    per-user auth already prevent unbounded abuse — this flattens short spikes).
 *  - Keyed by caller — the app passes `user:{userId}` for authenticated solves,
 *    `share:{linkId}` for share-token solves, so anonymous consumers of one link
 *    don't share a bucket with the link's owner.
 *
 * The window + cap are injected (they live in `ComputeLimits`), so this module
 * reads no env of its own.
 *
 * Not compute-only despite the name: `peek` + `clear` make it usable for
 * failure-counting flows too (login limiting keys by IP, records only failed
 * attempts via `check`, and forgives on success via `clear`).
 */

export interface RateLimitResult {
	allowed: boolean;
	/** Seconds until the bucket resets, when not allowed. */
	retryAfter?: number;
}

export interface ComputeRateLimiterConfig {
	/** Fixed-window length in ms. */
	windowMs: number;
	/** Max requests admitted per key per window. */
	maxPerWindow: number;
}

export interface ComputeRateLimiter {
	/**
	 * Check + record one request against `key`. Increments the counter on allow.
	 * Returns `{ allowed: false, retryAfter }` once the bucket is full.
	 */
	check(key: string): RateLimitResult;
	/**
	 * Check WITHOUT recording. For flows that only count selected outcomes —
	 * e.g. login limiting, where `peek` gates the attempt and `check` records
	 * only failures (a success calls `clear` instead).
	 */
	peek(key: string): RateLimitResult;
	/** Drop `key`'s bucket — e.g. a successful login forgives prior failures. */
	clear(key: string): void;
	/** Test seam — wipes in-memory state. Production code never calls this. */
	reset(): void;
	/** The resolved config, exposed for time-based test assertions. */
	readonly config: Readonly<ComputeRateLimiterConfig>;
}

interface BucketEntry {
	count: number;
	resetAt: number;
}

/**
 * Build a process-local fixed-window rate limiter. Each limiter owns its own
 * bucket `Map`, so distinct endpoints/keys-spaces don't collide.
 */
export function createComputeRateLimiter(config: ComputeRateLimiterConfig): ComputeRateLimiter {
	const { windowMs, maxPerWindow } = config;
	const buckets = new Map<string, BucketEntry>();

	return {
		config,
		check(key: string): RateLimitResult {
			const now = Date.now();
			const entry = buckets.get(key);

			if (!entry || now > entry.resetAt) {
				buckets.set(key, { count: 1, resetAt: now + windowMs });
				return { allowed: true };
			}

			if (entry.count >= maxPerWindow) {
				return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
			}

			entry.count += 1;
			return { allowed: true };
		},
		peek(key: string): RateLimitResult {
			const now = Date.now();
			const entry = buckets.get(key);

			if (!entry || now > entry.resetAt) {
				return { allowed: true };
			}
			if (entry.count >= maxPerWindow) {
				return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
			}
			return { allowed: true };
		},
		clear(key: string): void {
			buckets.delete(key);
		},
		reset(): void {
			buckets.clear();
		}
	};
}
