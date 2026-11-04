import type { ErrorContext, IErrorReporter } from '@selvajs/platform';
import { sampleRate, scrubBreadcrumb, scrubEvent } from './scrub.js';

/**
 * `IErrorReporter` backed by Sentry. `@sentry/node` is an OPTIONAL peer dependency: a
 * deployment without a DSN never loads it, so the surface below is narrowed to the calls used
 * here and the import stays dynamic — a static one would make the package mandatory.
 *
 * A host that already runs a Sentry SDK (a framework one that also traces requests) hands it
 * to `fromClient` instead, so Sentry is initialized once.
 */
export interface SentryLike {
	captureException(
		error: unknown,
		context?: {
			tags?: Record<string, string>;
			user?: { id?: string };
			level?: 'fatal' | 'error' | 'warning';
			fingerprint?: string[];
		}
	): unknown;
}

interface SentryNodeLike extends SentryLike {
	init(options: {
		dsn: string;
		environment?: string;
		release?: string;
		tracesSampleRate: number;
		beforeSend: typeof scrubEvent;
		beforeSendTransaction: typeof scrubEvent;
		beforeBreadcrumb: typeof scrubBreadcrumb;
	}): void;
}

export class SentryErrorReporter implements IErrorReporter {
	private constructor(private readonly sentry: SentryLike) {}

	/** A reporter over an SDK the host initialized itself; it should pass `scrub.ts`'s hooks. */
	static fromClient(sentry: SentryLike): SentryErrorReporter {
		return new SentryErrorReporter(sentry);
	}

	/**
	 * Initialize `@sentry/node` with the scrubbing hooks and return a reporter, or `null` when
	 * it won't load. Never throws — a broken error-tracker must not take down boot.
	 */
	static async create(opts: {
		dsn: string;
		environment?: string;
		release?: string;
		/** `SENTRY_TRACES_SAMPLE_RATE` as read from env; unset is 0, error tracking only. */
		tracesSampleRate?: string | number;
	}): Promise<SentryErrorReporter | null> {
		try {
			// `@vite-ignore` stops the bundler resolving an absent package at build
			// time. `@ts-ignore` rather than `@ts-expect-error` because the module
			// is a real dep in some installs and missing in others, so we can't
			// assert the error is always there for `expect-error` to consume.
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore -- optional dependency, may be absent at type-check time
			const sentry = (await import(/* @vite-ignore */ '@sentry/node')) as unknown as SentryNodeLike;
			sentry.init({
				dsn: opts.dsn,
				environment: opts.environment,
				release: opts.release,
				tracesSampleRate:
					typeof opts.tracesSampleRate === 'number'
						? sampleRate(String(opts.tracesSampleRate))
						: sampleRate(opts.tracesSampleRate),
				beforeSend: scrubEvent,
				beforeSendTransaction: scrubEvent,
				beforeBreadcrumb: scrubBreadcrumb
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
			if (context?.kind) tags.kind = context.kind;
			this.sentry.captureException(error, {
				tags,
				user: context?.userId ? { id: context.userId } : undefined,
				...(context?.level && { level: context.level }),
				// One issue per fault kind, split as Sentry would split it by stack.
				...(context?.kind && { fingerprint: ['{{ default }}', context.kind] })
			});
		} catch (err) {
			// Best-effort, and this sits on the error path — letting a second
			// failure escape would mask the first.
			console.error('[ErrorReporter] Failed to capture error:', err);
		}
	}
}
