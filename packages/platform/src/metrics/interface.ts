import type { RequestContext } from '../context.js';

/**
 * Why a solve did not produce a usable result. `ok` means the solve completed
 * (it may still carry Grasshopper runtime errors — see `errorCount`). The
 * failure kinds mirror the distinct branches the compute route already
 * distinguishes, so the recorded reason matches the HTTP status the client saw.
 */
export type SolveFailureKind =
	/** Solve completed; the response was returned to the client. */
	| 'ok'
	/** Scheduler deadline exceeded (HTTP 504). */
	| 'timeout'
	/** Client disconnected mid-solve; the request signal aborted (HTTP 499). */
	| 'client_abort'
	/** Rejected by the per-key rate limiter before solving (HTTP 429). */
	| 'rate_limited'
	/** Share-link solve cap reached before solving (HTTP 429). */
	| 'share_cap'
	/** Result exceeded the response size limit (HTTP 413). */
	| 'too_large'
	/**
	 * Shed by scheduler backpressure — the per-server queue was full, or the solve
	 * sat queued past its wait deadline, so it was rejected before executing
	 * (HTTP 503 + Retry-After). Distinct from `compute_error`: no compute ran.
	 */
	| 'shed'
	/** Compute server unreachable or the solve threw for any other reason. */
	| 'compute_error';

/**
 * One solve's timing and outcome, recorded once per solve attempt — including
 * attempts rejected before `scheduler.solve()` runs (rate limit, share cap).
 *
 * `durationMs` is wall time around the Rhino.Compute solve call only — it
 * excludes definition loading, auth, schema work, and result serialization. It
 * is 0 for attempts rejected before the solve started.
 */
export interface SolveMetric {
	/** Definition the solve ran against. `local:<guid>` or a remote URL. */
	definitionUrl: string;
	/**
	 * Local definition id (the `local:` guid), or null for remote-URL solves.
	 * Stored alongside `definitionUrl` so timings join to the definition record.
	 */
	definitionId: string | null;
	/**
	 * The exact version solved, or null for remote-URL solves (and for local
	 * attempts rejected before the version resolved). Lets you compare timings
	 * across versions of the same definition.
	 */
	versionId: string | null;
	/** Channel solved, mirroring the compute request. */
	channel: 'live' | 'draft';
	/** Org whose compute pool served the solve, or null for remote definitions. */
	orgId: string | null;
	/** Wall-clock duration of `scheduler.solve()` in milliseconds. 0 if never started. */
	durationMs: number;
	/** Whether the solve completed and returned a result. */
	ok: boolean;
	/** Why the solve did not return a result; `'ok'` when it did. */
	failureKind: SolveFailureKind;
	/**
	 * Count of Grasshopper runtime errors in the solve response. A solve can be
	 * `ok` yet still report component-level errors — this is distinct from
	 * `failureKind`. 0 when the solve never returned a response.
	 */
	errorCount: number;
	/** Count of Grasshopper runtime warnings in the solve response. */
	warningCount: number;
}

/**
 * Sink for per-solve timing telemetry. Called once per solve attempt from the
 * compute route, AFTER the solve resolves or rejects.
 *
 * MUST NOT throw — recording is best-effort and sits on the hot path of every
 * solve. Implementations catch and log their own failures; the only side
 * effect visible to the caller is a fulfilled promise. MAY be fire-and-forget.
 */
export interface ISolveMetricSink {
	record(ctx: RequestContext, metric: SolveMetric): Promise<void>;
}

/**
 * Default `ISolveMetricSink` — discards every metric. Used when
 * `SelvaConfig.solveMetrics` is omitted. Swap in a real sink to persist or
 * aggregate solve timings.
 */
export class NoopSolveMetricSink implements ISolveMetricSink {
	async record(_ctx: RequestContext, _metric: SolveMetric): Promise<void> {}
}
