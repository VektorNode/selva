/**
 * A response's JSON text length, so byte-budgeted caches never re-serialize a huge tree. A WeakMap
 * rather than a field keeps `JSON.stringify(response)` clean; it is keyed by identity, so a derived
 * copy must re-register. `.length` stands in for UTF-8 bytes: the JSON is near-pure ASCII.
 */

const wireSizes = new WeakMap<object, number>();

/** Record `response`'s wire size. No-op for non-object/null values. */
export function setResponseWireSize(response: unknown, size: number): void {
	if (typeof response !== 'object' || response === null) return;
	wireSizes.set(response, size);
}

/** The wire size recorded for `response`, or undefined when never registered. */
export function getResponseWireSize(response: unknown): number | undefined {
	if (typeof response !== 'object' || response === null) return undefined;
	return wireSizes.get(response);
}
