/**
 * Idempotency store for the solve endpoint: a repeat of the same request within
 * the TTL replays the first response instead of re-solving.
 *
 * **This absorbs client retries; it is not a result cache.** The TTL is short
 * and the store is process-local, so a retry that lands on another instance
 * (or after the TTL) re-solves. That is acceptable — a duplicate solve costs
 * compute, not correctness. What it must never do is return one caller's result
 * to another, hence the caller identity in the key.
 *
 * Concurrency matters more than the hit rate. A client that retries on timeout
 * usually retries *while the first solve is still running*, so the store holds a
 * **promise**, reserved before the work starts: the second request awaits the
 * first rather than starting a second solve. A reservation that rejects is
 * dropped, so a failed solve is retryable rather than a cached error.
 *
 * Bounded the same way as the rate limiter: amortized sweep plus a hard cap, both
 * driven by `run` rather than a timer — a timer would keep the event loop alive
 * and give this module a lifecycle its callers don't have.
 */

export interface IdempotencyStoreConfig {
	/** How long a completed response stays replayable, in ms. */
	ttlMs: number;
	/**
	 * Max retained entries. Once live entries exceed this, the ones nearest
	 * expiry are evicted. Evicting only costs a re-solve on a retry, so size this
	 * above the plausible number of in-flight + recent keys.
	 */
	maxKeys?: number;
	/**
	 * How often (ms) to sweep expired entries, amortized onto `run`. Defaults to
	 * `ttlMs`. `0` disables the sweep, leaving only the cap (test seam).
	 */
	sweepIntervalMs?: number;
}

/** Default {@link IdempotencyStoreConfig.maxKeys}. */
export const DEFAULT_IDEMPOTENCY_MAX_KEYS = 10_000;

export interface IdempotencyOutcome<T> {
	value: T;
	/** True when this call awaited an existing entry rather than running `fn`. */
	replayed: boolean;
}

export interface IdempotencyStore<T> {
	/**
	 * Run `fn` under `key`, or join/replay the entry already stored there.
	 *
	 * The entry is reserved before `fn` starts, so a concurrent retry awaits the
	 * first run instead of starting its own. A rejection drops the reservation.
	 */
	run(key: string, fn: () => Promise<T>): Promise<IdempotencyOutcome<T>>;
	/** Test seam — wipes in-memory state. Production code never calls this. */
	reset(): void;
	/** Retained entry count, including any not yet swept. For tests/observability. */
	size(): number;
	readonly config: Readonly<IdempotencyStoreConfig>;
}

interface Entry<T> {
	promise: Promise<T>;
	/**
	 * Set when the promise settles. While in flight the entry is un-expirable —
	 * a long solve must not have its reservation swept out from under the
	 * retries that are already awaiting it.
	 */
	expiresAt: number | null;
}

/**
 * Build a process-local idempotency store. `T` is whatever the caller replays;
 * the solve route stores a serialized response snapshot rather than a `Response`,
 * because a `Response` body can only be read once.
 */
export function createIdempotencyStore<T>(config: IdempotencyStoreConfig): IdempotencyStore<T> {
	const ttlMs = Math.max(0, Math.floor(config.ttlMs));
	const maxKeys = Math.max(1, Math.floor(config.maxKeys ?? DEFAULT_IDEMPOTENCY_MAX_KEYS));
	const sweepIntervalMs = Math.max(0, Math.floor(config.sweepIntervalMs ?? ttlMs));
	const resolvedConfig: Readonly<IdempotencyStoreConfig> = Object.freeze({
		...config,
		ttlMs,
		maxKeys,
		sweepIntervalMs
	});

	const entries = new Map<string, Entry<T>>();
	let nextSweepAt = Number.POSITIVE_INFINITY;

	function maybeSweep(now: number, headroom = 0): void {
		const budget = Math.max(0, maxKeys - headroom);
		const dueForSweep = sweepIntervalMs > 0 && now >= nextSweepAt;
		if (!dueForSweep && entries.size <= budget) return;

		for (const [key, entry] of entries) {
			if (entry.expiresAt !== null && now > entry.expiresAt) entries.delete(key);
		}
		if (sweepIntervalMs > 0) nextSweepAt = now + sweepIntervalMs;

		if (entries.size > budget) {
			// In-flight entries sort last: evicting one would orphan the retries
			// awaiting it, so they are given up only when nothing else is left.
			const byExpiryAsc = [...entries.entries()].sort(
				(a, b) => (a[1].expiresAt ?? Infinity) - (b[1].expiresAt ?? Infinity)
			);
			for (let i = 0; i < byExpiryAsc.length - budget; i++) entries.delete(byExpiryAsc[i][0]);
		}
	}

	return {
		config: resolvedConfig,
		async run(key: string, fn: () => Promise<T>): Promise<IdempotencyOutcome<T>> {
			const now = Date.now();
			const existing = entries.get(key);
			if (existing && (existing.expiresAt === null || now <= existing.expiresAt)) {
				return { value: await existing.promise, replayed: true };
			}

			maybeSweep(now, entries.has(key) ? 0 : 1);

			const promise = fn();
			const entry: Entry<T> = { promise, expiresAt: null };
			entries.set(key, entry);
			if (sweepIntervalMs > 0 && nextSweepAt === Number.POSITIVE_INFINITY) {
				nextSweepAt = now + sweepIntervalMs;
			}

			try {
				const value = await promise;
				entry.expiresAt = Date.now() + ttlMs;
				return { value, replayed: false };
			} catch (err) {
				// A failed solve is retryable — drop the reservation rather than
				// replaying the error to every retry for the whole TTL. Only drop our
				// own entry: a later `run` may already have replaced it.
				if (entries.get(key) === entry) entries.delete(key);
				throw err;
			}
		},
		reset(): void {
			entries.clear();
			nextSweepAt = Number.POSITIVE_INFINITY;
		},
		size(): number {
			return entries.size;
		}
	};
}
