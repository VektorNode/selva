import type { ILogger, LogFields, LogLevel } from '@selvajs/platform';

/**
 * `ILogger` backed by pino, with a console-backed fallback.
 *
 * pino is an OPTIONAL peer dependency, mirroring `@sentry/node` next door: it's
 * imported dynamically so the base install ships without it. Unlike Sentry,
 * though, absence must NOT degrade to silence — an operator who never
 * configured a logging backend still needs to see warnings and errors on
 * stdout. So `create()` falls back to {@link ConsoleLogger} rather than `null`.
 *
 * Why pino at all, given the fallback works: it writes newline-delimited JSON
 * with a stable schema, which is what every log collector expects and what the
 * old `console.log` template literals could never produce. Structured fields
 * survive as typed JSON, so `requestId` becomes a filter and `durationMs`
 * becomes a range query instead of a substring match.
 */

/** The slice of pino's surface used here — a hard import would make it mandatory. */
interface PinoLike {
	debug(obj: object, msg?: string): void;
	info(obj: object, msg?: string): void;
	warn(obj: object, msg?: string): void;
	error(obj: object, msg?: string): void;
	child(bindings: object): PinoLike;
}

type PinoFactory = (options: {
	level: string;
	base: object | undefined;
	redact?: { paths: string[]; censor: string };
	transport?: { target: string; options: object };
}) => PinoLike;

/**
 * Field paths scrubbed before a record is written. Defense-in-depth only — call
 * sites are required not to log secrets in the first place (see `LogFields`).
 * This catches the accident where a whole object is spread into fields and
 * happens to carry a token, which is exactly how credentials reach log indexes.
 */
const REDACTED_PATHS = [
	'token',
	'sessionToken',
	'refreshToken',
	'apiKey',
	'api_key',
	'password',
	'authorization',
	'cookie',
	'*.token',
	'*.sessionToken',
	'*.refreshToken',
	'*.apiKey',
	'*.password'
];

/**
 * Minimal `ILogger` over `console.*`, used when pino isn't installed.
 *
 * Renders as `LEVEL message {fields}` — readable in a terminal, greppable, and
 * honest about not being machine-parseable. `child` fields are merged eagerly
 * so correlation still works without pino.
 */
export class ConsoleLogger implements ILogger {
	constructor(
		private readonly bound: LogFields = {},
		private readonly minLevel: LogLevel = 'info'
	) {}

	private static readonly ORDER: Record<LogLevel, number> = {
		debug: 10,
		info: 20,
		warn: 30,
		error: 40
	};

	private write(level: LogLevel, message: string, fields?: LogFields): void {
		if (ConsoleLogger.ORDER[level] < ConsoleLogger.ORDER[this.minLevel]) return;
		const merged = { ...this.bound, ...fields };
		const suffix = Object.keys(merged).length > 0 ? ` ${safeStringify(merged)}` : '';
		const line = `${level.toUpperCase()} ${message}${suffix}`;
		// Route to the matching console method so stderr/stdout split as expected.
		// `info` (not `log`) carries debug too — both go to stdout, and the level
		// is already spelled out in the line's own prefix.
		if (level === 'error') console.error(line);
		else if (level === 'warn') console.warn(line);
		else console.info(line);
	}

	debug(message: string, fields?: LogFields): void {
		this.write('debug', message, fields);
	}
	info(message: string, fields?: LogFields): void {
		this.write('info', message, fields);
	}
	warn(message: string, fields?: LogFields): void {
		this.write('warn', message, fields);
	}
	error(message: string, fields?: LogFields): void {
		this.write('error', message, fields);
	}
	child(fields: LogFields): ILogger {
		return new ConsoleLogger({ ...this.bound, ...fields }, this.minLevel);
	}
}

/** Fields can hold anything, including cycles. Never let rendering throw. */
function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return '[unserializable]';
	}
}

class PinoLogger implements ILogger {
	constructor(private readonly pino: PinoLike) {}

	// pino takes (fields, message); ILogger takes (message, fields) — the flip is
	// deliberate, since the message is what a human scans for first.
	debug(message: string, fields?: LogFields): void {
		try {
			this.pino.debug(fields ?? {}, message);
		} catch {
			/* logging must never throw */
		}
	}
	info(message: string, fields?: LogFields): void {
		try {
			this.pino.info(fields ?? {}, message);
		} catch {
			/* logging must never throw */
		}
	}
	warn(message: string, fields?: LogFields): void {
		try {
			this.pino.warn(fields ?? {}, message);
		} catch {
			/* logging must never throw */
		}
	}
	error(message: string, fields?: LogFields): void {
		try {
			this.pino.error(fields ?? {}, message);
		} catch {
			/* logging must never throw */
		}
	}
	child(fields: LogFields): ILogger {
		try {
			return new PinoLogger(this.pino.child(fields));
		} catch {
			return this;
		}
	}
}

export interface CreateLoggerOptions {
	/** Minimum level written. Below this, records are dropped. */
	level?: LogLevel;
	/**
	 * Pretty-print via `pino-pretty` (human-readable, colorized) instead of JSON.
	 * For local development — production wants JSON for the collector. Silently
	 * ignored if `pino-pretty` isn't installed.
	 */
	pretty?: boolean;
	/** Fields stamped on every record (e.g. service name, release). */
	base?: LogFields;
}

/**
 * Build the app's root logger. Never throws and never returns `null`: a
 * deployment with no pino installed gets {@link ConsoleLogger}, because losing
 * warnings and errors is a worse outcome than losing JSON formatting.
 */
export async function createLogger(opts: CreateLoggerOptions = {}): Promise<ILogger> {
	const level = opts.level ?? 'info';
	try {
		const factory = await loadPinoFactory();
		if (!factory) return new ConsoleLogger(opts.base ?? {}, level);
		const pino = factory({
			level,
			base: opts.base,
			redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
			transport: opts.pretty
				? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
				: undefined
		});
		return new PinoLogger(pino);
	} catch (err) {
		// pino resolved but could not be constructed — a real misconfiguration
		// (e.g. `pretty: true` with pino-pretty absent). Unlike a plain absent
		// package, this one is worth complaining about: the operator asked for
		// something they didn't get. Fall back rather than go quiet.
		console.warn(
			`[Logger] pino was found but could not be initialized; falling back to console logging. ${String(err)}`
		);
		return new ConsoleLogger(opts.base ?? {}, level);
	}
}

/**
 * Load pino's factory, or `null` when it isn't installed.
 *
 * The indirection through a variable specifier is load-bearing, not stylistic.
 * A literal `import('pino')` is statically analyzable, so bundlers rewrite it —
 * and Vite, applying browser-field mapping to this server build, resolved it to
 * pino's `server_false` browser shim: a stub whose factory throws. That turned
 * "use pino" into a silent fall back to the console. Computing the specifier
 * defeats that resolution and leaves the import to Node at runtime, which is
 * exactly what an optional peer dependency needs.
 *
 * `@vite-ignore` alone was NOT sufficient — it suppressed the warning while the
 * rewrite happened anyway.
 */
async function loadPinoFactory(): Promise<PinoFactory | null> {
	const specifier = 'pino';
	try {
		const mod = await import(/* @vite-ignore */ specifier);
		const factory = ((mod as { default?: unknown }).default ?? mod) as PinoFactory;
		return typeof factory === 'function' ? factory : null;
	} catch {
		// Not installed — the expected path on a base install, where the console
		// fallback is the intended behavior. Staying quiet here on purpose: a
		// boot-time complaint about an optional package nobody asked for is noise.
		return null;
	}
}
