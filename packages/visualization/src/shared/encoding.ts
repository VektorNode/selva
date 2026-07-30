/**
 * Base64 decoding for binary mesh payloads. Copied (not imported) from `@selvajs/compute`'s
 * `decodeBase64ToBinary` to avoid depending on the Rhino.Compute client for ~20 stable lines; keep
 * the two in sync by hand.
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
	// Forgiving-base64: strip whitespace, then drop trailing padding only where length % 4 allows it.
	let data = base64File.replace(/[\t\n\f\r ]/g, '');
	if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
	if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) {
		throw new VisualizationError('Invalid base64 input.', ErrorCodes.ENCODING_ERROR, {
			context: { inputLength: base64File.length }
		});
	}

	// Prefer Buffer in Node: faster, and avoids the atob + charCodeAt latin-1 detour.
	const Buffer = getNodeBuffer();
	if (Buffer) {
		// Copy out of the Buffer — small Buffer.from results are views over Node's shared 8 KiB pool
		// slab, so returning one would retain the whole slab and leak unrelated pooled bytes to any
		// consumer touching `.buffer` (structuredClone, postMessage transfer, etc).
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
