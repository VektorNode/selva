import type { ErrorContext, IErrorReporter } from '@selvajs/platform';

/**
 * `IErrorReporter` backed by Sentry, constructed only when the consuming app has
 * a DSN configured. `@sentry/node` is an OPTIONAL peer dependency: a deployment
 * without a DSN never loads it, so the surface below is narrowed to the two
 * calls used here and the import stays dynamic — a static one would make the
 * package mandatory.
 */
interface SentryLike {
	init(options: {
		dsn: string;
		environment?: string;
		release?: string;
		tracesSampleRate: number;
	}): void;
	captureException(
		error: unknown,
		context?: {
			tags?: Record<string, string>;
			user?: { id?: string };
			extra?: Record<string, unknown>;
		}
	): void;
}

export class SentryErrorReporter implements IErrorReporter {
	private constructor(private readonly sentry: SentryLike) {}

	/**
	 * Initialize Sentry and return a reporter, or `null` when `@sentry/node`
	 * won't load. Never throws — a broken error-tracker must not take down boot.
	 */
	static async create(opts: {
		dsn: string;
		environment?: string;
		release?: string;
	}): Promise<SentryErrorReporter | null> {
		try {
			// `@vite-ignore` stops the bundler resolving an absent package at build
			// time. `@ts-ignore` rather than `@ts-expect-error` because the module
			// is a real dep in some installs and missing in others, so we can't
			// assert the error is always there for `expect-error` to consume.
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore -- optional dependency, may be absent at type-check time
			const sentry = (await import(/* @vite-ignore */ '@sentry/node')) as unknown as SentryLike;
			sentry.init({
				dsn: opts.dsn,
				environment: opts.environment,
				release: opts.release,
				// 0 = error tracking only, no performance tracing. Raise it to
				// sample transactions/spans.
				tracesSampleRate: 0
			});
			return new SentryErrorReporter(sentry);
		} catch (err) {
			console.error(
				'[ErrorReporter] A Sentry DSN is set but @sentry/node could not be loaded. ' +
					'Install it (`pnpm add @sentry/node`) or unset the DSN. Falling back to no-op.',
				err
			);
			return null;
		}
	}

	capture(error: unknown, context?: ErrorContext): void {
		try {
			const tags: Record<string, string> = { ...context?.tags };
			if (context?.method) tags.method = context.method;
			if (context?.route) tags.route = context.route;
			if (context?.orgId) tags.orgId = context.orgId;
			this.sentry.captureException(error, {
				tags,
				user: context?.userId ? { id: context.userId } : undefined
			});
		} catch (err) {
			// Best-effort, and this sits on the error path — letting a second
			// failure escape would mask the first.
			console.error('[ErrorReporter] Failed to capture error:', err);
		}
	}
}
