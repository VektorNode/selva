// The request/response Solve Driver: the HTTP-shaped transport (Rhino.Compute via a
// SolveFn), wrapped in the single-in-flight throttle and fronted by the client-side
// result memo. The WebSocket driver lives in plugin-ui — transport-specific, but it
// satisfies the same SolveDriver interface.

import { createComputeThrottle } from '../compute-throttle.js';
import { createSolveMemo } from '../solve-memo.js';
import type { SolveFn } from '../solve-fn.js';
import type { SolveDriver, SolveReporter } from './driver.js';

/**
 * Request/response Solve Driver: wraps createComputeThrottle around a SolveFn and feeds
 * the resolved result back through the reporter. One solve in flight at a time; the
 * latest triggered values win. Used by ComputeApp (Rhino.Compute over HTTP).
 *
 * Because the session and driver reference each other, the host passes the reporter
 * lazily (`() => session`) so it can construct the session with the driver in hand.
 *
 * `onChange` fires on every `isSolving` transition — a reactive host wires it to the
 * same republish callback it gives the session, since `session.isSolving` just forwards
 * to the driver and would otherwise never notify.
 */
export function createRequestResponseDriver(
	onSolve: SolveFn,
	getReporter: () => SolveReporter,
	options: { timeout?: number; onChange?: () => void } = {}
): SolveDriver {
	// M2: a small LRU memoizing completed solves by their input values. A slider dragged
	// back to a value already solved this session reports instantly without a network
	// round-trip. The check lives inside the throttled computeFn so the throttle's
	// latest-wins ordering still holds — a hit only serves after the throttle picks these
	// values as the ones to run.
	const memo = createSolveMemo();

	const throttle = createComputeThrottle<Record<string, unknown>>(async (values, signal) => {
		const cached = memo.get(values);
		if (cached !== undefined) {
			if (signal.aborted) return;
			getReporter().report(cached);
			return;
		}
		try {
			const result = await onSolve(values, signal);
			if (signal.aborted) {
				// Discarded on purpose (superseded/cancelled) — never memoized or reported.
				console.debug('[Compute/session] solve completed after abort — result discarded');
				return;
			}
			memo.set(values, result);
			getReporter().report(result);
		} catch (err) {
			if (signal.aborted) {
				console.debug('[Compute/session] solve aborted (superseded, cancelled, or timed out)');
				return;
			}
			// reportError only sets session state; without this line a transport failure
			// leaves no console trace at all.
			console.warn('[Compute/session] solve failed:', err);
			getReporter().reportError(err instanceof Error ? err.message : String(err));
		}
	}, options);

	return {
		solve(values) {
			throttle.trigger(values);
		},
		cancel() {
			throttle.cancel();
		},
		get isSolving() {
			return throttle.isComputing;
		},
		clearCache() {
			memo.clear();
		}
	};
}
