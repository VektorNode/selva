import { ComputeError, ErrorCodes } from '../errors';

export interface Logger {
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
}

const silent: Logger = {
	debug() {},
	info() {},
	warn() {},
	error() {}
};

let internalLogger: Logger = silent;

export function getLogger(): Logger {
	return internalLogger;
}

/**
 * Route the package's logs to `logger`; `null` silences them (the default).
 *
 * @throws {ComputeError} `INVALID_CONFIG` if the logger lacks one of the four methods, rather
 *   than a "debug is not a function" later at an unrelated call site.
 *
 * @example
 * ```typescript
 * import { setLogger } from '@selvajs/compute/core';
 *
 * setLogger(console);
 * setLogger({
 *   debug: (msg, ...args) => myLogger.debug(msg, ...args),
 *   info: (msg, ...args) => myLogger.info(msg, ...args),
 *   warn: (msg, ...args) => myLogger.warn(msg, ...args),
 *   error: (msg, ...args) => myLogger.error(msg, ...args)
 * });
 * setLogger(null);
 * ```
 */
export function setLogger(logger: Logger | Console | null): void {
	if (logger === null) {
		internalLogger = silent;
		return;
	}

	const missing = (['debug', 'info', 'warn', 'error'] as const).filter(
		(method) => typeof (logger as unknown as Record<string, unknown>)[method] !== 'function'
	);
	if (missing.length > 0) {
		throw new ComputeError(
			`Logger is missing required method(s): ${missing.join(', ')}. A logger must implement debug, info, warn and error.`,
			ErrorCodes.INVALID_CONFIG,
			{ context: { missingMethods: missing } }
		);
	}

	internalLogger = logger as Logger;
}

/** Shorthand for `setLogger(console)`. */
export function enableDebugLogging(): void {
	setLogger(console);
}
