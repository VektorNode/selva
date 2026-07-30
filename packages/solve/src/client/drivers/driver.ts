// The transport seam of a Solve Session. A driver knows how to start and cancel a solve
// and reports whether one is in flight; it never returns outputs. Results come back
// asynchronously through the session's `report()`, which is what lets push transports
// (a WebSocket streaming mesh frames on its own schedule) satisfy the same interface as
// a request/response HTTP call without contortion.

import type { SolveResult } from '../../shared/solve-fn.js';

/**
 * The transport behind a Solve Session. Knows how to start and cancel a solve and
 * reports its in-flight state. It does NOT return outputs — those come back via the
 * session's report() so push transports (WebSocket) fit without contortion.
 */
export interface SolveDriver {
	solve(values: Record<string, unknown>): void;
	cancel(): void;
	readonly isSolving: boolean;
	/**
	 * Drops any cached solve results the driver holds. Optional — only drivers with a
	 * client-side memo (the request/response driver) implement it. Called on rebuild so a
	 * definition swap can't serve a stale result from a prior definition's input space.
	 */
	clearCache?(): void;
}

/**
 * The slice of a SolveSession a driver feeds completed/failed solves back into.
 *
 * `TMesh` defaults to `unknown` because nothing in this package inspects meshes; a host that
 * knows its concrete mesh type (a three.js viewer) narrows it at its own seam.
 */
export interface SolveReporter<TMesh = unknown> {
	report(result: SolveResult<TMesh>): void;
	reportError(message: string): void;
}
