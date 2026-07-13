/**
 * In-process single-flight (R4) — dogpile protection above the L2 cache.
 *
 * N identical live solves arriving while the first is still running would each
 * enqueue and each hit Rhino (the scheduler has no in-flight coalescing, and
 * Rhino's `cachesolve` still costs a round trip per repeat). The classic cold-key
 * stampede: a hot public definition + a deploy = a thundering herd onto compute.
 *
 * This coalesces them: the first caller for a key runs the work; concurrent
 * callers for the SAME key await the same promise and share its result. Once the
 * work settles (resolve OR reject), the key is released so the next request runs
 * fresh — the map never retains a settled entry, so it can't serve a stale
 * result or leak memory.
 *
 * It sits ABOVE the `ISolveResultCache` interface (in-process, per app instance).
 * A cross-instance lease (Redis `SET NX`) is a later backend capability; this is
 * the free first slice that covers the common same-instance burst.
 *
 * Correctness note: the shared promise resolves to ONE value for all waiters, so
 * the wrapped work must return an immutable / independently-serializable result
 * (the solve pipeline returns a fresh envelope object — safe to share by
 * reference here because the app serializes it per response).
 */

export interface SolveCacheSingleFlight {
	/**
	 * Run `work` under `key`, coalescing concurrent identical calls. The first
	 * caller executes; overlapping callers for the same key await the same promise.
	 * The key is freed as soon as the promise settles (success or failure).
	 */
	run<T>(key: string, work: () => Promise<T>): Promise<T>;
	/** Number of keys currently in flight (observability / tests). */
	inFlight(): number;
}

export interface SolveCacheSingleFlightOptions {
	/**
	 * Fired when a caller joins an already-in-flight key instead of running its
	 * own work — the coalescing win this module exists for, otherwise invisible.
	 */
	onJoin?: (key: string) => void;
}

export function createSolveCacheSingleFlight(
	options: SolveCacheSingleFlightOptions = {}
): SolveCacheSingleFlight {
	const inflight = new Map<string, Promise<unknown>>();

	return {
		run<T>(key: string, work: () => Promise<T>): Promise<T> {
			const existing = inflight.get(key);
			if (existing) {
				options.onJoin?.(key);
				return existing as Promise<T>;
			}

			// `.finally` releases the key on both settle paths. Start the work inside
			// the promise chain so a synchronous throw in `work` still rejects the
			// shared promise (and still frees the key) rather than escaping.
			const p = (async () => work())().finally(() => {
				// Only delete if it's still OUR promise — a key freed and re-taken by a
				// later caller must not be clobbered.
				if (inflight.get(key) === p) inflight.delete(key);
			});
			inflight.set(key, p);
			return p;
		},
		inFlight(): number {
			return inflight.size;
		}
	};
}
