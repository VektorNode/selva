/**
 * In-process single-flight — dogpile protection for every solve.
 *
 * Always on, not gated behind a result cache being configured: the dogpile is worst
 * when nothing else is caching, since N concurrent identical solves each pay a full
 * Rhino round trip (the scheduler doesn't coalesce in-flight requests itself, and
 * Rhino's `cachesolve` still costs a round trip per repeat). An earlier version
 * gated this on cache config and so disabled it in exactly the deployments most
 * exposed to a cold-key stampede — hot public definition plus a deploy.
 *
 * Per app instance, above `ISolveResultCache`. No cross-instance lease (Redis
 * `SET NX`) yet.
 *
 * The shared promise resolves to one value for every waiter, so `work` must return
 * something safe to share by reference — the solve pipeline's envelope qualifies
 * because the app serializes it per response.
 */

export interface SolveCacheSingleFlight {
	/**
	 * Coalesces concurrent calls under the same key: the first caller runs `work`,
	 * later callers for that key await the same promise, and the key frees as soon
	 * as it settles.
	 *
	 * `onWaiterJoined` fires only on the owner's call, only while `work` is still
	 * running, each time another caller joins. Ownership changes what the owner's
	 * abort signal should mean: a solo run can cancel on its own client's
	 * disconnect, but a shared run can't without 499-ing every waiter.
	 */
	run<T>(key: string, work: () => Promise<T>, onWaiterJoined?: () => void): Promise<T>;
	inFlight(): number;
}

export interface SolveCacheSingleFlightOptions {
	onJoin?: (key: string) => void;
}

export function createSolveCacheSingleFlight(
	options: SolveCacheSingleFlightOptions = {}
): SolveCacheSingleFlight {
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

			// Wrapping in an async IIFE means a synchronous throw in `work` still
			// rejects `p` instead of escaping `run` directly.
			const flight: Flight = { notifyOwner: onWaiterJoined, promise: undefined! };
			const p = (async () => work())().finally(() => {
				// Clear it here so a join after `work` settles can't fire it late.
				flight.notifyOwner = undefined;
				// Guard against deleting a key a later caller has already re-taken.
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
