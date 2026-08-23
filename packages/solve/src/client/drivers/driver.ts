import type { SolveResult } from '../../shared/solve-fn.js';

/**
 * Transport behind a solve session. `solve()` never returns outputs directly — results
 * go through the session's `report()` instead, so a push transport (e.g. a WebSocket
 * streaming mesh frames on its own schedule) can satisfy the same interface as
 * request/response HTTP.
 *
 * **Stamping `SolveResult.values` is the driver's job, and only some drivers can do it.** A
 * driver that owns a request/response pair must stamp the input set it solved onto the
 * result it reports — the session retains that pair, and a consumer committing what is on
 * screen relies on it being atomic. A push driver that cannot attribute an incoming frame to
 * a request it made must leave `values` absent rather than attach the last set it sent:
 * frames that arrive unsolicited (a replay on connect, a recompute triggered outside the web
 * UI) would otherwise be stamped with an unrelated input set, which is precisely the stale
 * pairing the field exists to prevent.
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
