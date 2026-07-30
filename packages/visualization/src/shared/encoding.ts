/**
 * Base64 decoding for binary mesh payloads.
 *
 * Copied from `@selvajs/compute`'s `core/utils/encoding.ts` (`decodeBase64ToBinary`) rather than
 * imported: it was the last non-trivial reason this package depended on the Rhino.Compute client,
 * and ~20 stable lines are cheaper than that dependency. The two copies are expected to stay
 * identical; the subtleties (forgiving-base64 normalization, the Node pool-slab copy) are the
 * reason this is a copy and not a rewrite.
 *
 * @module shared/encoding
 */

import { VisualizationError, ErrorCodes } from './errors.js';

function getNodeBuffer(): typeof Buffer | undefined {
	const buf = (globalThis as { Buffer?: typeof Buffer }).Buffer;
	return typeof buf === 'function' ? buf : undefined;
}

/**
 * Decodes a base64 string to binary data.
 *
 * Normalizes and validates input per WHATWG forgiving-base64 so both runtimes fail consistently.
 *
 * @throws {VisualizationError} `ENCODING_ERROR` if invalid, or `INVALID_STATE` if no decoder is
 *   available in this environment.
 */
export function decodeBase64ToBinary(base64File: string): Uint8Array {
	// Forgiving-base64 normalization: strip ASCII whitespace (wrapped /
	// pretty-printed payloads), then drop trailing padding only where the spec
	// allows it (total length a multiple of 4).
	let data = base64File.replace(/[\t\n\f\r ]/g, '');
	if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
	if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) {
		throw new VisualizationError('Invalid base64 input.', ErrorCodes.ENCODING_ERROR, {
			context: { inputLength: base64File.length }
		});
	}

	// Prefer Buffer in Node — it's faster and avoids the latin-1 string detour
	// that atob + charCodeAt requires.
	const Buffer = getNodeBuffer();
	if (Buffer) {
		// Copy the bytes out of the Buffer: small Buffer.from results are views
		// over Node's shared 8 KiB pool slab, so returning a view would retain
		// the whole slab and expose unrelated pooled bytes to any consumer that
		// touches `.buffer` (re-wrapping, structuredClone, postMessage transfer).
		// `new Uint8Array(typedArray)` copies into a fresh, exactly-sized buffer.
		return new Uint8Array(Buffer.from(data, 'base64'));
	}
	if (typeof globalThis.atob === 'function') {
		const binary = globalThis.atob(data);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i) & 0xff;
		}
		return bytes;
	}

	throw new VisualizationError(
		'Base64 decoding not supported in this environment.',
		ErrorCodes.INVALID_STATE,
		{ context: { environmentInfo: 'atob or Buffer not available' } }
	);
}
