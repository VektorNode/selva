/** Minimal read-side view of a request's headers — `Headers` satisfies it. */
export interface HeadersLike {
	get(name: string): string | null;
}

/**
 * True when the request's declared `Content-Length` exceeds `maxBytes`. Call it
 * BEFORE reading the body, so a huge payload aimed at a small-body endpoint
 * can't burn memory; the route maps `true` to its transport's 413.
 *
 * This is the per-route lower bound. A global limit (e.g. adapter-node's
 * `BODY_SIZE_LIMIT`) has to clear the largest legitimate upload, so every small
 * JSON endpoint would otherwise inherit that ceiling.
 *
 * Requests without `Content-Length` (chunked encoding) slip past this check —
 * the global limit is the backstop there.
 */
export function declaredBodySizeExceeds(headers: HeadersLike, maxBytes: number): boolean {
	const declared = Number(headers.get('content-length'));
	return Number.isFinite(declared) && declared > maxBytes;
}
