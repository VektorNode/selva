/**
 * What an error tracker may receive: identifiers, never payloads. Applied to Sentry-shaped
 * events (`beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb`) without importing Sentry,
 * so a host wires them into whichever SDK it runs, server or browser.
 *
 * No cookie, auth header, API key, request body or query string leaves: a query carries share
 * tokens and search text, a body definitions and inputs. A user is its id. Console breadcrumbs
 * stay local, since they can quote any of the above.
 */

/** The parts of a Sentry event these read. Structural, so any SDK version's events fit. */
export interface ScrubbableEvent {
	request?: {
		url?: string;
		cookies?: unknown;
		data?: unknown;
		query_string?: unknown;
		headers?: Record<string, string>;
	};
	user?: { id?: string | number } & Record<string, unknown>;
	breadcrumbs?: ScrubbableBreadcrumb[];
	transaction?: string;
	spans?: { description?: string; data?: Record<string, unknown> }[];
}

export interface ScrubbableBreadcrumb {
	category?: string;
	data?: Record<string, unknown>;
}

// Headers that say what the request was, never who sent it.
const KEPT_HEADERS = new Set(['accept', 'content-type', 'content-length', 'user-agent']);
const URL_KEYS = ['url', 'to', 'from', 'http.url', 'server.address.full'];

/** `https://h/p?q=1#f` → `https://h/p`; a relative path likewise. Anything else as it was. */
export function withoutQuery(url: string): string {
	const cut = url.search(/[?#]/);
	return cut === -1 ? url : url.slice(0, cut);
}

function scrubData(data: Record<string, unknown> | undefined): void {
	if (!data) return;
	for (const key of URL_KEYS) {
		const value = data[key];
		if (typeof value === 'string') data[key] = withoutQuery(value);
	}
	delete data['http.query'];
	delete data['http.fragment'];
}

export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(crumb: B): B | null {
	if (crumb.category === 'console') return null;
	scrubData(crumb.data);
	return crumb;
}

/** For `beforeSend` and `beforeSendTransaction` alike. Mutates and returns `event`. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
	const request = event.request;
	if (request) {
		delete request.cookies;
		delete request.data;
		delete request.query_string;
		if (request.url) request.url = withoutQuery(request.url);
		if (request.headers) {
			request.headers = Object.fromEntries(
				Object.entries(request.headers).filter(([k]) => KEPT_HEADERS.has(k.toLowerCase()))
			);
		}
	}
	if (event.user) event.user = event.user.id === undefined ? {} : { id: event.user.id };
	if (event.breadcrumbs) {
		event.breadcrumbs = event.breadcrumbs.flatMap((b) => scrubBreadcrumb(b) ?? []);
	}
	for (const span of event.spans ?? []) {
		if (span.description) span.description = withoutQuery(span.description);
		scrubData(span.data);
	}
	if (event.transaction) event.transaction = withoutQuery(event.transaction);
	return event;
}

/** A sample-rate env value → 0–1; unset or unreadable is 0, out of range clamped. */
export function sampleRate(raw: string | undefined): number {
	const rate = Number(raw);
	return raw !== undefined && Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0;
}
