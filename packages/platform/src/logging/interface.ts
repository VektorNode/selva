/**
 * Structured logging seam: the interface + a safe default live here, the real
 * backend (pino) ships from `@selvajs/server` so `@selvajs/platform` never
 * gains a logging dependency and browser-side consumers never pull a Node
 * logger into a bundle. A hard pino import would also impose a transport
 * config on every embedder, including ones that already own a logging stack.
 * Call sites describe WHAT happened and hand over fields; formatting,
 * redaction and routing are the backend's business.
 */

/**
 * Fields attached to one log record. Values are `unknown`, not `string`, so a
 * field survives as typed JSON (numbers stay numbers, queryable by range)
 * instead of being flattened into a message string.
 *
 * Never put secrets here — session tokens, API keys, refresh tokens, raw share
 * tokens. Log records leave the box (stdout to collector to third-party index)
 * and outlive the credential.
 */
export type LogFields = Record<string, unknown>;

/**
 * Severity levels, ordered to match pino's set so the backend is a thin
 * pass-through and operators get the level names they expect.
 *
 *  - `debug` — detail only useful when actively diagnosing; off in production.
 *  - `info`  — a thing happened that an operator would want in the record
 *              (boot, config resolved, request completed).
 *  - `warn`  — degraded or suspicious, but handled; the system continues.
 *  - `error` — an operation failed. Pair with `IErrorReporter` when it's
 *              genuinely unexpected: logs are for the operator reading stdout,
 *              the reporter is for off-box triage.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * A structured logger.
 *
 * MUST NOT throw — logging sits on every path including the error path, where a
 * failing logger would mask the original fault. Implementations swallow their
 * own failures.
 */
export interface ILogger {
	debug(message: string, fields?: LogFields): void;
	info(message: string, fields?: LogFields): void;
	warn(message: string, fields?: LogFields): void;
	error(message: string, fields?: LogFields): void;
	/**
	 * Derive a logger that stamps `fields` onto every record it writes. The
	 * request hook binds `requestId` (plus method/route) once via `child`, so
	 * every downstream call site logs without knowing a request id exists.
	 *
	 * Children compose; a child of a child carries both parents' fields. A
	 * child's field overwrites a parent's on key collision.
	 */
	child(fields: LogFields): ILogger;
}

/**
 * Default `ILogger` — discards everything. Lets library code log
 * unconditionally without a configured backend, and keeps test output clean.
 * The app wires a real logger at its composition root; a consumer that wires
 * nothing gets silence rather than unsolicited stdout writes.
 */
export class NoopLogger implements ILogger {
	debug(_message: string, _fields?: LogFields): void {}
	info(_message: string, _fields?: LogFields): void {}
	warn(_message: string, _fields?: LogFields): void {}
	error(_message: string, _fields?: LogFields): void {}
	child(_fields: LogFields): ILogger {
		return this;
	}
}
