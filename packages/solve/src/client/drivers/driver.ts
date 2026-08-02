import type { SolveResult } from '../../shared/solve-fn.js';

/**
 * Transport behind a solve session. `solve()` never returns outputs directly — results
 * go through the session's `report()` instead, so a push transport (e.g. a WebSocket
 * streaming mesh frames on its own schedule) can satisfy the same interface as
 * request/response HTTP.
 */
export interface SolveDriver {
	solve(values: Record<string, unknown>): void;
	cancel(): void;
	readonly isSolving: boolean;
	/**
	 * Drops cached solve results. Optional — only the request/response driver has a
	 * client-side memo to clear. Call on rebuild: a definition swap must not serve a
	 * stale result from the prior definition's input space.
	 */
	clearCache?(): void;
}

/** `TMesh` defaults to `unknown`: nothing here inspects meshes. A host with a concrete
 * mesh type (e.g. a three.js viewer) narrows it at its own seam. */
export interface SolveReporter<TMesh = unknown> {
	report(result: SolveResult<TMesh>): void;
	reportError(message: string): void;
}
