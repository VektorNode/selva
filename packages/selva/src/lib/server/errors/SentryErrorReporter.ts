import type { ErrorContext, IErrorReporter } from '@selvajs/platform';

/**
 * `IErrorReporter` backed by Sentry (`@sentry/node`). Constructed only when
 * `SENTRY_DSN` is set — see `createErrorReporter`. Self-hosters who don't
 * configure a DSN never load `@sentry/node`, so it stays an OPTIONAL
 * dependency: the base install ships without it and the no-op path needs no
 * package at all.
 *
 * `@sentry/node` is imported dynamically and its surface is narrowed to the
 * two calls we use — a hard static import would make the package mandatory.
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
	 * Initialize Sentry and return a reporter, or `null` if `@sentry/node` is
	 * not installed (optional dependency absent). Never throws — a broken
	 * error-tracker must not take down boot.
	 */
	static async create(opts: {
		dsn: string;
		environment?: string;
		release?: string;
	}): Promise<SentryErrorReporter | null> {
		try {
			// Dynamic so the package stays optional. `@vite-ignore` keeps the
			// bundler from trying to resolve it at build time when it's absent.
			const sentry = (await import(/* @vite-ignore */ '@sentry/node')) as unknown as SentryLike;
			sentry.init({
				dsn: opts.dsn,
				environment: opts.environment,
				release: opts.release,
				// Error tracking only — no performance tracing by default. Flip
				// this up later if you want transactions/spans.
				tracesSampleRate: 0
			});
			return new SentryErrorReporter(sentry);
		} catch (err) {
			console.error(
				'[ErrorReporter] SENTRY_DSN is set but @sentry/node could not be loaded. ' +
					'Install it (`pnpm add @sentry/node`) or unset SENTRY_DSN. Falling back to no-op.',
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
			// Reporting is best-effort and sits on the error path — a second
			// failure here would mask the first. Swallow after logging.
			console.error('[ErrorReporter] Failed to capture error:', err);
		}
	}
}
