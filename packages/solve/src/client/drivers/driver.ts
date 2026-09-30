import type { SolveEvent } from '@selvajs/schemas';
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
	/**
	 * Live events from the running solve, when the transport carries them (a WebSocket frame
	 * locally, an SSE stream in cloud mode). Returns the unsubscribe. A driver without a live
	 * channel leaves this undefined and the session simply never sees events.
	 */
	onEvent?(listener: (event: SolveEvent) => void): () => void;
}

/**
 * Where a request/response driver gets its live events from. The stream is owned by the host
 * (it outlives individual solves), so the driver only subscribes and forwards.
 */
export interface SolveEventSource {
	subscribe(listener: (event: SolveEvent) => void): () => void;
	/** Asks the server to abort the solve currently in flight, if the source knows which one that is. */
	cancelCurrent?(): void;
}

/** `TMesh` defaults to `unknown`: nothing here inspects meshes. A host with a concrete
 * mesh type (e.g. a three.js viewer) narrows it at its own seam. */
export interface SolveReporter<TMesh = unknown> {
	report(result: SolveResult<TMesh>): void;
	reportError(message: string): void;
}
