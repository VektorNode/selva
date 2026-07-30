// The request/response Solve Driver: the HTTP-shaped transport (Rhino.Compute via a
// SolveFn), wrapped in the single-in-flight throttle and fronted by the client-side
// result memo. The WebSocket driver lives in plugin-ui — transport-specific, but it
// satisfies the same SolveDriver interface.

import { createAsyncThrottle } from '../async-throttle.js';
import { createSolveMemo, type MeshPolicy } from '../solve-memo.js';
import type { SolveFn } from '../../shared/solve-fn.js';
import type { SolveDriver, SolveReporter } from './driver.js';

export interface RequestResponseDriverOptions<TMesh> {
	timeout?: number;
	onChange?: () => void;
	/**
	 * Mesh ownership policy for the result memo. Required whenever a consumer disposes the
	 * meshes it is handed — a viewer does — or a memo hit serves an already-disposed object
	 * (audit C1). Three.js hosts pass `meshPolicy` from `@selvajs/visualization/parse`.
	 */
	meshPolicy?: MeshPolicy<TMesh>;
}

/**
 * Request/response Solve Driver: wraps the async throttle around a SolveFn and feeds the
 * resolved result back through the reporter. One solve in flight at a time; the latest
 * triggered values win. Used by ComputeApp (Rhino.Compute over HTTP).
 *
 * Because the session and driver reference each other, the host passes the reporter
 * lazily (`() => session`) so it can construct the session with the driver in hand.
 *
 * `onChange` fires on every `isSolving` transition — a reactive host wires it to the
 * same republish callback it gives the session, since `session.isSolving` just forwards
 * to the driver and would otherwise never notify.
 */
export function createRequestResponseDriver<TMesh = unknown>(
	onSolve: SolveFn<TMesh>,
	getReporter: () => SolveReporter<TMesh>,
	options: RequestResponseDriverOptions<TMesh> = {}
): SolveDriver {
	const { meshPolicy, ...throttleOptions } = options;

	// M2: a small LRU memoizing completed solves by their input values. A slider dragged
	// back to a value already solved this session reports instantly without a network
	// round-trip. The check lives inside the throttled run so the throttle's latest-wins
	// ordering still holds — a hit only serves after the throttle picks these values as the
	// ones to run.
	const memo = createSolveMemo<TMesh>({ meshPolicy });

	const throttle = createAsyncThrottle<Record<string, unknown>>(async (values, signal) => {
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
				// `debug`, not `info`: this is normal during a slider scrub, once per superseded
				// solve. See the same note in `async-throttle.ts`.
				// eslint-disable-next-line no-console -- see above
				console.debug('[Solve/driver] solve completed after abort — result discarded');
				return;
			}
			memo.set(values, result);
			getReporter().report(result);
		} catch (err) {
			if (signal.aborted) {
				// eslint-disable-next-line no-console -- normal-operation trace; see the note above
				console.debug('[Solve/driver] solve aborted (superseded, cancelled, or timed out)');
				return;
			}
			// reportError only sets session state; without this line a transport failure
			// leaves no console trace at all.
			console.warn('[Solve/driver] solve failed:', err);
			getReporter().reportError(err instanceof Error ? err.message : String(err));
		}
	}, throttleOptions);

	return {
		solve(values) {
			throttle.trigger(values);
		},
		cancel() {
			throttle.cancel();
		},
		get isSolving() {
			return throttle.isRunning;
		},
		clearCache() {
			memo.clear();
		}
	};
}
