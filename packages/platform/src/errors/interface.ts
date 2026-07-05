/**
 * Structured context attached to a reported error. All fields optional — a
 * report can fire before any request context is built (e.g. an
 * `unhandledRejection` with no active request). Deliberately NOT a
 * `RequestContext`: reporters must never receive the opaque `authToken`, so
 * only non-sensitive routing/identity fields are surfaced here.
 */
export interface ErrorContext {
	/** HTTP method, when the error happened inside a request. */
	method?: string;
	/** Route pathname (never the query string — it can carry share tokens). */
	route?: string;
	/** Acting user id, when known. */
	userId?: string;
	/** Org the user was acting as, when known. */
	orgId?: string;
	/** Non-sensitive tags for grouping/search in the backend. */
	tags?: Record<string, string>;
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
	 * Report an unexpected error. `error` is whatever was thrown/rejected —
	 * often an `Error`, but adapters occasionally reject with a plain object,
	 * so implementations must render defensively.
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
