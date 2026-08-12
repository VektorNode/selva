/**
 * Logging facility for the visualization package. Deliberately local rather than imported from
 * `@selvajs/compute` (logging isn't a compute concern). Mirrors compute's logger shape so a host
 * wanting one sink for both can call `setLogger(computeLogger.getLogger())`.
 */

import { VisualizationError, ErrorCodes } from './errors.js';

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

// Defaults to no-op: a library that writes to the console uninvited is a nuisance in a host with
// its own logging. Opt in with setLogger or enableDebugLogging.
let internalLogger: Logger = new NoOpLogger();

// Call per-use rather than caching — the sink is settable at any time.
export function getLogger(): Logger {
	return internalLogger;
}

// Validates logger shape up front: failing here beats a confusing "getLogger().debug is not a
// function" at some later, unrelated call site.
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
