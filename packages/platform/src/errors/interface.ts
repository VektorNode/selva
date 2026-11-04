/**
 * Structured context attached to a reported error. All fields optional — a
 * report can fire before any request context is built (e.g. an
 * `unhandledRejection` with no active request). Deliberately NOT a
 * `RequestContext`: reporters must never receive the opaque `adapterContext`, so
 * only non-sensitive routing/identity fields are surfaced here.
 */
export interface ErrorContext {
	method?: string;
	/** Never the query string — it can carry share tokens. */
	route?: string;
	userId?: string;
	orgId?: string;
	tags?: Record<string, string>;
	/** How urgent the report is. Default `error`; `warning` for a handled fault worth watching. */
	level?: 'fatal' | 'error' | 'warning';
	/**
	 * Groups reports of one fault across messages (`compute-auth`, `compute-unreachable`), so
	 * a fault whose message varies still reads as one issue.
	 */
	kind?: string;
}

/**
 * Sink for unexpected server errors. Called from `handleError` and the
 * process-level `unhandledRejection`/`uncaughtException` hooks.
 *
 * MUST NOT throw — reporting is best-effort and sits on the error path, where a
 * second failure would mask the first. Implementations catch and log their own
 * failures. MAY be fire-and-forget.
 */
export interface IErrorReporter {
	/**
	 * `error` is whatever was thrown/rejected — often an `Error`, but adapters
	 * occasionally reject with a plain object, so implementations must render
	 * defensively.
	 */
	capture(error: unknown, context?: ErrorContext): void;
}

/**
 * Default `IErrorReporter` — discards every report. Used when no error-tracking
 * backend is configured (e.g. `SENTRY_DSN` unset), so call sites can report
 * unconditionally. Swap in a real reporter to ship errors off-box.
 */
export class NoopErrorReporter implements IErrorReporter {
	capture(_error: unknown, _context?: ErrorContext): void {}
}
