/** Minimal read-side view of a request's headers — `Headers` satisfies it. */
export interface HeadersLike {
	get(name: string): string | null;
}

/**
 * True when the request's declared `Content-Length` exceeds `maxBytes`.
 * Check BEFORE the body is read so a malicious client can't burn memory by
 * sending a huge payload to a small-body endpoint; the route maps a `true`
 * result to its transport's 413.
 *
 * Background: a global body-size limit (e.g. adapter-node's `BODY_SIZE_LIMIT`)
 * has to be set high enough for the largest legitimate upload, which means
 * smaller JSON endpoints inherit that ceiling by default. This check is the
 * per-route lower bound.
 *
 * Caveat: requests without `Content-Length` (chunked transfer encoding) bypass
 * this check. Most browsers and HTTP clients send Content-Length on POST/PUT.
 * The global limit is the backstop for those.
 */
export function declaredBodySizeExceeds(headers: HeadersLike, maxBytes: number): boolean {
	const declared = Number(headers.get('content-length'));
	return Number.isFinite(declared) && declared > maxBytes;
}
