import { describe, expect, it, vi } from 'vitest';
import { SentryErrorReporter, type SentryLike } from '../SentryErrorReporter.js';
import { scrubBreadcrumb, scrubEvent } from '../scrub.js';

const sentryNode = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/node', () => sentryNode);

function capturing() {
	const calls: Parameters<SentryLike['captureException']>[] = [];
	const sentry: SentryLike = { captureException: (...args) => calls.push(args) };
	return { calls, reporter: SentryErrorReporter.fromClient(sentry) };
}

describe('SentryErrorReporter', () => {
	it('groups a report by its kind and carries its level', () => {
		const { calls, reporter } = capturing();
		const err = new Error('Compute refused the API key');

		reporter.capture(err, { kind: 'compute-auth', level: 'warning', orgId: 'o1', userId: 'u1' });

		expect(calls).toEqual([
			[
				err,
				{
					tags: { orgId: 'o1', kind: 'compute-auth' },
					user: { id: 'u1' },
					level: 'warning',
					fingerprint: ['{{ default }}', 'compute-auth']
				}
			]
		]);
	});

	it('never throws when the SDK does', () => {
		const reporter = SentryErrorReporter.fromClient({
			captureException: () => {
				throw new Error('sdk down');
			}
		});
		const quiet = console.error;
		console.error = () => {};
		try {
			expect(() => reporter.capture(new Error('x'))).not.toThrow();
		} finally {
			console.error = quiet;
		}
	});
});

describe('SentryErrorReporter.create', () => {
	it('initializes the SDK with every scrubbing hook', async () => {
		const reporter = await SentryErrorReporter.create({
			dsn: 'https://key@sentry.example/1',
			tracesSampleRate: '0.25'
		});

		expect(reporter).not.toBeNull();
		expect(sentryNode.init).toHaveBeenCalledOnce();
		expect(sentryNode.init.mock.calls[0][0]).toMatchObject({
			dsn: 'https://key@sentry.example/1',
			tracesSampleRate: 0.25,
			// Streamed spans skip beforeSendTransaction.
			traceLifecycle: 'static',
			beforeSend: scrubEvent,
			beforeSendTransaction: scrubEvent,
			beforeBreadcrumb: scrubBreadcrumb
		});
	});
});
