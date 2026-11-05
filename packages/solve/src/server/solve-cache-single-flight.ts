/**
 * In-process single-flight — dogpile protection for every solve.
 *
 * Always on, not gated behind a result cache being configured: the dogpile is worst
 * when nothing else is caching, since N concurrent identical solves each pay a full
 * Rhino round trip (the scheduler doesn't coalesce in-flight requests itself, and
 * Rhino's `cachesolve` still costs a round trip per repeat).
 *
 * Per app instance. No cross-instance lease (Redis `SET NX`) yet.
 *
 * The shared promise resolves to one value for every caller, so `work` must return
 * something safe to share by reference.
 */

export interface SolveCacheSingleFlight {
	/**
	 * Coalesces concurrent calls under the same key: the first caller runs `work`, later
	 * callers await the same promise, and the key frees as soon as it settles.
	 *
	 * The flight belongs to all its callers. It aborts `work`'s signal when the last one's
	 * `callerSignal` fires, and frees the key right then, so a caller arriving after that starts
	 * a fresh flight instead of joining one that is dying. A caller that leaves earlier still
	 * resolves with the flight: check its own signal before using the result.
	 */
	run<T>(
		key: string,
		work: (signal: AbortSignal) => Promise<T>,
		callerSignal: AbortSignal
	): Promise<T>;
	inFlight(): number;
}

export interface SolveCacheSingleFlightOptions {
	onJoin?: (key: string) => void;
}

interface Flight {
	promise: Promise<unknown>;
	controller: AbortController;
	callers: number;
}

export function createSolveCacheSingleFlight(
	options: SolveCacheSingleFlightOptions = {}
): SolveCacheSingleFlight {
	const inflight = new Map<string, Flight>();

	function free(key: string, flight: Flight) {
		// Guard against deleting a key a later caller has already re-taken.
		if (inflight.get(key) === flight) inflight.delete(key);
	}

	function attend<T>(key: string, flight: Flight, signal: AbortSignal): Promise<T> {
		flight.callers += 1;
		// `once: true` doesn't detach on a normal completion, and the caller's signal outlives
		// this call, so without the `finally` every solve leaks a listener onto it.
		const leave = () => {
			flight.callers -= 1;
			if (flight.callers > 0) return;
			free(key, flight);
			flight.controller.abort();
		};
		signal.addEventListener('abort', leave, { once: true });
		return (flight.promise as Promise<T>).finally(() => signal.removeEventListener('abort', leave));
	}

	return {
		run<T>(key: string, work: (signal: AbortSignal) => Promise<T>, callerSignal: AbortSignal) {
			const existing = inflight.get(key);
			if (existing) {
				try {
					options.onJoin?.(key);
				} catch (err) {
					// Telemetry must not fail a solve that is otherwise fine.
					console.error('[Solve/single-flight] onJoin threw:', err);
				}
				return attend<T>(key, existing, callerSignal);
			}

			const controller = new AbortController();
			const flight: Flight = {
				controller,
				callers: 0,
				// Wrapped so a synchronous throw in `work` still rejects instead of escaping `run`.
				promise: (async () => work(controller.signal))().finally(() => free(key, flight))
			};
			inflight.set(key, flight);
			return attend<T>(key, flight, callerSignal);
		},
		inFlight(): number {
			return inflight.size;
		}
	};
}
