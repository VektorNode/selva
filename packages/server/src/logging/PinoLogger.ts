import type { ILogger, LogFields, LogLevel } from '@selvajs/platform';

/**
 * `ILogger` backed by pino, with a console-backed fallback.
 *
 * pino is an OPTIONAL peer dependency, imported dynamically so the base install
 * ships without it. Unlike `@sentry/node` next door, absence must NOT degrade to
 * silence — an operator who never configured a logging backend still needs
 * warnings and errors on stdout, so {@link createLogger} falls back to
 * {@link ConsoleLogger} rather than returning `null`.
 *
 * pino earns its place by writing newline-delimited JSON with a stable schema:
 * what every log collector expects, and what console template literals can't
 * produce.
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
 * Field paths scrubbed before a record is written. A backstop for accidents,
 * NOT a licence to log objects: call sites are required not to log secrets in
 * the first place (see `LogFields`). This catches the case where a whole object
 * is spread into fields and happens to carry a credential.
 *
 * It matches by FIELD NAME, and only at the top level or one level deep (the
 * `*.` entries). It will not catch personal data — an email nested in a payload
 * sails straight through, and a log line reaches a collector that erasure can
 * never reach. Note the nested `*.` set covers only five of the eight names.
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
 * Minimal `ILogger` over `console.*`, used when pino isn't installed. Renders
 * as `LEVEL message {fields}` — greppable, and honest about not being
 * machine-parseable. `child` fields merge eagerly so correlation still works.
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
		// Split stderr/stdout the way an operator expects. `info` carries debug
		// too — both land on stdout, and the line already spells out its level.
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

	// pino takes (fields, message); ILogger takes (message, fields). The flip is
	// deliberate — the message is what a human scans for first.
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
	/** Minimum level written; records below it are dropped. Defaults to `info`. */
	level?: LogLevel;
	/**
	 * Pretty-print via `pino-pretty` instead of JSON — for local development;
	 * production wants JSON for the collector. Asking for this without
	 * `pino-pretty` installed drops the whole logger to {@link ConsoleLogger}.
	 */
	pretty?: boolean;
	/** Fields stamped on every record (e.g. service name, release). */
	base?: LogFields;
}

/** Build the app's root logger. Never throws, never returns `null`. */
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
		// pino resolved but wouldn't construct — a real misconfiguration (e.g.
		// `pretty: true` with pino-pretty absent). Worth complaining about, unlike
		// a merely absent package: the operator asked for something they didn't get.
		console.warn(
			`[Logger] pino was found but could not be initialized; falling back to console logging. ${String(err)}`
		);
		return new ConsoleLogger(opts.base ?? {}, level);
	}
}

/**
 * Load pino's factory, or `null` when it isn't installed.
 *
 * Don't inline the specifier. A literal `import('pino')` is statically
 * analyzable, so Vite applied browser-field mapping to this server build and
 * resolved it to pino's `server_false` browser shim — a stub whose factory
 * throws, turning "use pino" into a silent fall back to the console. Computing
 * the specifier defeats that and leaves the import to Node at runtime.
 * `@vite-ignore` alone was NOT enough: it silenced the warning and the rewrite
 * still happened.
 */
async function loadPinoFactory(): Promise<PinoFactory | null> {
	const specifier = 'pino';
	try {
		const mod = await import(/* @vite-ignore */ specifier);
		const factory = ((mod as { default?: unknown }).default ?? mod) as PinoFactory;
		return typeof factory === 'function' ? factory : null;
	} catch {
		// Not installed — the expected path on a base install, where the console
		// fallback is intended. Quiet on purpose: complaining at boot about an
		// optional package nobody asked for is noise.
		return null;
	}
}
