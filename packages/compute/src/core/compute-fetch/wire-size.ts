/**
 * Side-channel carrying a response's wire size (its JSON text length) alongside
 * the parsed object, so downstream caches can budget by bytes without
 * re-serializing. The response tree can be hundreds of MB, and every extra
 * `JSON.stringify` pass over it is a real cost.
 *
 * A `WeakMap` rather than a property on the response: the response type is the
 * server's schema, and an extra enumerable field would leak into every
 * `JSON.stringify(response)` on the way back out to clients. Derived copies
 * (e.g. the `algo`-stripped shallow copy in `runSolve`) must re-register: the
 * hint follows object identity, not content.
 *
 * The size is `text.length` (UTF-16 code units), not strict UTF-8 bytes:
 * compute responses are ASCII-dominated JSON (base64 + numerals), so the two
 * are interchangeable for budgeting purposes and `.length` is free.
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
