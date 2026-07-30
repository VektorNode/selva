/**
 * In-process single-flight (R4) — dogpile protection for every solve.
 *
 * This is deliberately NOT conditional on any result cache being configured. The
 * dogpile it prevents is worst precisely when nothing else is caching: with no
 * shared result cache, N concurrent identical solves each pay a full Rhino round
 * trip. Gating it on cache configuration (as an earlier version did) turned it off
 * in exactly the deployments that needed it most.
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
	 *
	 * `onWaiterJoined` fires on the OWNER's call — the one actually running `work` —
	 * each time another caller joins its flight. The owner needs this because
	 * ownership changes what its abort signal means: a solo run may cancel on its
	 * own client's disconnect, a shared one may not (cancelling would 499 every
	 * waiter). Never fires for a joining caller, and never after `work` settles.
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
