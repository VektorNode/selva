// Error reporting: the Sentry-backed IErrorReporter (optional @sentry/node peer) and the
// scrubbing hooks any Sentry SDK takes, server or browser.

export { SentryErrorReporter, type SentryLike } from './SentryErrorReporter.js';
export {
	sampleRate,
	scrubBreadcrumb,
	scrubEvent,
	withoutQuery,
	type ScrubbableBreadcrumb,
	type ScrubbableEvent
} from './scrub.js';
