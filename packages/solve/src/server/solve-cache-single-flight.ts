/**
 * In-process single-flight — dogpile protection for every solve.
 *
 * Deliberately NOT conditional on a result cache being configured: the dogpile is
 * worst precisely when nothing else is caching (N concurrent identical solves each
 * paying a full Rhino round trip — the scheduler has no in-flight coalescing of its
 * own, and Rhino's `cachesolve` still costs a round trip per repeat). Gating this on
 * cache configuration, as an earlier version did, turned it off in exactly the
 * deployments most exposed to a cold-key stampede (hot public definition + a deploy).
 *
 * In-process only, sitting above `ISolveResultCache` (per app instance). A
 * cross-instance lease (Redis `SET NX`) is a later backend capability.
 *
 * Correctness note: the shared promise resolves to ONE value for all waiters, so
 * the wrapped work must return an immutable / independently-serializable result
 * (the solve pipeline's envelope is safe to share by reference here because the
 * app serializes it per response).
 */

export interface SolveCacheSingleFlight {
	/**
	 * Run `work` under `key`, coalescing concurrent identical calls: the first
	 * caller executes, overlapping callers for the same key await the same promise
	 * and result, and the key is freed as soon as it settles.
	 *
	 * `onWaiterJoined` fires on the OWNER's call each time another caller joins its
	 * flight — ownership changes what the owner's abort signal means (a solo run
	 * may cancel on its own client's disconnect, a shared one may not, or it would
	 * 499 every waiter). Never fires for a joining caller, and never after `work`
	 * settles.
	 */
	run<T>(key: string, work: () => Promise<T>, onWaiterJoined?: () => void): Promise<T>;
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
	// Each entry carries the shared promise plus the owner's join callback, so a
	// joining caller can notify the owner that its flight is now shared.
	interface Flight {
		promise: Promise<unknown>;
		notifyOwner?: () => void;
	}
	const inflight = new Map<string, Flight>();

	return {
		run<T>(key: string, work: () => Promise<T>, onWaiterJoined?: () => void): Promise<T> {
			const existing = inflight.get(key);
			if (existing) {
				options.onJoin?.(key);
				existing.notifyOwner?.();
				return existing.promise as Promise<T>;
			}

			// `.finally` releases the key on both settle paths. Start the work inside
			// the promise chain so a synchronous throw in `work` still rejects the
			// shared promise (and still frees the key) rather than escaping.
			const flight: Flight = { notifyOwner: onWaiterJoined, promise: undefined! };
			const p = (async () => work())().finally(() => {
				// Drop the callback so a late join can't fire it after the owner's
				// request has already been served.
				flight.notifyOwner = undefined;
				// Only delete if it's still OUR flight — a key freed and re-taken by a
				// later caller must not be clobbered.
				if (inflight.get(key) === flight) inflight.delete(key);
			});
			flight.promise = p;
			inflight.set(key, flight);
			return p;
		},
		inFlight(): number {
			return inflight.size;
		}
	};
}
