/**
 * Per-key fixed-window rate limiter for the compute-solve endpoint. Solves are
 * the one expensive endpoint in a Selva-engine app — without a cap a single user
 * or share-link consumer burns compute budget far faster than any other surface
 * allows.
 *
 * Design:
 *  - Process-local `Map`. Multi-instance deployments see N× the per-key rate —
 *    acceptable as a first line. State lives behind this factory so a shared-store
 *    implementation can slot in later without touching call sites.
 *  - Bounded. Nothing revisits a bucket that is never checked again, so an
 *    unswept `Map` grows with every distinct key ever seen — every user, share
 *    link and login IP, forever. Two mechanisms keep it bounded, both driven by
 *    `check`/`peek` rather than a timer: a timer would keep the event loop alive
 *    and give this module a lifecycle its callers don't have.
 *      1. Amortized sweep — every `sweepIntervalMs` (default: one window), drop
 *         expired buckets. `check` already treats them as absent, so dropping
 *         them changes no verdict.
 *      2. Hard cap — if live buckets alone exceed `maxKeys`, evict those closest
 *         to resetting; they have the least budget left to protect. Eviction
 *         forgives a key's counter, so `maxKeys` is sized to be unreachable in
 *         normal operation and only bites under a key-space attack.
 *  - Fixed window rather than sliding — simpler, no per-request bookkeeping. The
 *    burst-at-window-edges behaviour is fine here: share-link `maxSolves` and
 *    per-user auth already prevent unbounded abuse, and this flattens spikes.
 *  - Keyed by caller — the app passes `user:{userId}` for authenticated solves
 *    and `share:{linkId}` for share-token solves, so anonymous consumers of one
 *    link don't share a bucket with the link's owner.
 *
 * Window and cap are injected from `ComputeLimits`; this module reads no env.
 *
 * Not compute-only despite the name: `peek` + `clear` also serve failure-counting
 * flows — login limiting keys by IP, records only failures via `check`, and
 * forgives on success via `clear`.
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
	/**
	 * Max retained buckets; defaults to {@link DEFAULT_MAX_KEYS}. Evicting forgives
	 * that key's counter, so this is a memory backstop against a distinct-key
	 * flood, not a tuning knob — size it well above the plausible number of
	 * concurrently-active keys.
	 */
	maxKeys?: number;
	/**
	 * How often (ms) to sweep expired buckets. Defaults to `windowMs` — every
	 * bucket swept is already past its reset, so sweeping more often buys nothing.
	 * `0` disables the sweep, leaving only the `maxKeys` cap (test seam).
	 */
	sweepIntervalMs?: number;
}

/** Default {@link ComputeRateLimiterConfig.maxKeys}. */
export const DEFAULT_MAX_KEYS = 100_000;

export interface ComputeRateLimiter {
	/** Check and record one request against `key`, incrementing the counter on allow. */
	check(key: string): RateLimitResult;
	/**
	 * Check WITHOUT recording — for flows that count only selected outcomes. Login
	 * limiting gates the attempt with `peek`, records failures with `check`, and
	 * calls `clear` on success.
	 */
	peek(key: string): RateLimitResult;
	/** Drop `key`'s bucket — a successful login forgives prior failures. */
	clear(key: string): void;
	/**
	 * Requests recorded against `key` this window; `0` when the bucket is absent or
	 * expired. Which key a caller charges is a security property — an anonymous
	 * share solve must not spend the link owner's budget — and an allow/deny
	 * verdict alone can't express it.
	 */
	count(key: string): number;
	/** Test seam — wipes in-memory state. Production code never calls this. */
	reset(): void;
	/** Retained bucket count, including any not yet swept. Tests/observability. */
	size(): number;
	/** The resolved config, exposed for time-based test assertions. */
	readonly config: Readonly<ComputeRateLimiterConfig>;
}

interface BucketEntry {
	count: number;
	resetAt: number;
}

/** Each limiter owns its own bucket `Map`, so distinct key-spaces don't collide. */
export function createComputeRateLimiter(config: ComputeRateLimiterConfig): ComputeRateLimiter {
	const { windowMs, maxPerWindow } = config;
	const maxKeys = Math.max(1, Math.floor(config.maxKeys ?? DEFAULT_MAX_KEYS));
	const sweepIntervalMs = Math.max(0, Math.floor(config.sweepIntervalMs ?? windowMs));
	const resolvedConfig: Readonly<ComputeRateLimiterConfig> = Object.freeze({
		...config,
		maxKeys,
		sweepIntervalMs
	});
	const buckets = new Map<string, BucketEntry>();
	let nextSweepAt = Number.POSITIVE_INFINITY;

	/**
	 * Drop dead buckets, then enforce the hard cap. Runs at most once per
	 * `sweepIntervalMs` — except when the cap is already breached, which must be
	 * enforced on the spot regardless of the sweep clock.
	 *
	 * `headroom` is how many buckets the caller is about to insert. The cap is
	 * enforced against the post-insert size, so `maxKeys` is a true ceiling rather
	 * than one the very next write steps over.
	 */
	function maybeSweep(now: number, headroom = 0): void {
		const budget = Math.max(0, maxKeys - headroom);
		const dueForSweep = sweepIntervalMs > 0 && now >= nextSweepAt;
		if (!dueForSweep && buckets.size <= budget) return;

		for (const [key, entry] of buckets) {
			if (now > entry.resetAt) buckets.delete(key);
		}
		if (sweepIntervalMs > 0) nextSweepAt = now + sweepIntervalMs;

		// Still over cap with nothing but live buckets: evict those nearest their
		// reset first — they have the least remaining budget to protect.
		if (buckets.size > budget) {
			const byResetAsc = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
			for (let i = 0; i < byResetAsc.length - budget; i++) buckets.delete(byResetAsc[i][0]);
		}
	}

	return {
		config: resolvedConfig,
		check(key: string): RateLimitResult {
			const now = Date.now();
			// Reserve room for the bucket this call may insert.
			maybeSweep(now, buckets.has(key) ? 0 : 1);
			const entry = buckets.get(key);

			if (!entry || now > entry.resetAt) {
				buckets.set(key, { count: 1, resetAt: now + windowMs });
				if (sweepIntervalMs > 0 && nextSweepAt === Number.POSITIVE_INFINITY) {
					nextSweepAt = now + sweepIntervalMs;
				}
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
			maybeSweep(now);
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
		count(key: string): number {
			const entry = buckets.get(key);
			// An expired bucket is semantically absent — `check` would overwrite it
			// rather than resume its count, so report it the same way.
			if (!entry || Date.now() > entry.resetAt) return 0;
			return entry.count;
		},
		reset(): void {
			buckets.clear();
			nextSweepAt = Number.POSITIVE_INFINITY;
		},
		size(): number {
			return buckets.size;
		}
	};
}
