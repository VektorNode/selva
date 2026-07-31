/**
 * Logging facility for the visualization package. Deliberately local rather than imported from
 * `@selvajs/compute` (logging isn't a compute concern). Mirrors compute's logger shape so a host
 * wanting one sink for both can call `setLogger(computeLogger.getLogger())`.
 */

import { VisualizationError, ErrorCodes } from './errors.js';

/** Implement to route the package's structured log output. */
export interface Logger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
}

class NoOpLogger implements Logger {
	debug(): void {}
	info(): void {}
	warn(): void {}
	error(): void {}
}

class ConsoleLogger implements Logger {
	debug(message: string, ...args: unknown[]): void {
		// eslint-disable-next-line no-console -- this class exists to be the console sink
		console.debug(message, ...args);
	}

	info(message: string, ...args: unknown[]): void {
		console.info(message, ...args);
	}

	warn(message: string, ...args: unknown[]): void {
		console.warn(message, ...args);
	}

	error(message: string, ...args: unknown[]): void {
		console.error(message, ...args);
	}
}

/**
 * Defaults to no-op, matching `@selvajs/compute`'s default. A library that writes to the console
 * uninvited is a nuisance in a host that has its own logging; opt in with {@link setLogger} or
 * {@link enableDebugLogging}.
 */
let internalLogger: Logger = new NoOpLogger();

/** The active sink. Call per-use rather than caching — the sink is settable at any time. */
export function getLogger(): Logger {
	return internalLogger;
}

/**
 * Routes this package's logging to `logger`, or silences it with `null`.
 *
 * @throws {VisualizationError} `INVALID_CONFIG` if the logger is missing any of the four required
 *   methods — failing here beats a confusing "getLogger().debug is not a function" at some later,
 *   unrelated call site.
 */
export function setLogger(logger: Logger | Console | null): void {
	if (logger === null) {
		internalLogger = new NoOpLogger();
		return;
	}

	const missing = (['debug', 'info', 'warn', 'error'] as const).filter(
		(method) => typeof (logger as unknown as Record<string, unknown>)[method] !== 'function'
	);
	if (missing.length > 0) {
		throw new VisualizationError(
			`Logger is missing required method(s): ${missing.join(', ')}. A logger must implement debug, info, warn and error.`,
			ErrorCodes.INVALID_CONFIG,
			{ context: { missingMethods: missing } }
		);
	}

	internalLogger = logger as Logger;
}

export function enableDebugLogging(): void {
	setLogger(new ConsoleLogger());
}
