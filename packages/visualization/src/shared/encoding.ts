// Copied (not imported) from `@selvajs/compute`'s `decodeBase64ToBinary`: a few stable lines don't
// justify depending on the Rhino.Compute client. Keep the two in sync by hand.

import { VisualizationError, ErrorCodes } from './errors.js';

function getNodeBuffer(): typeof Buffer | undefined {
	const buf = (globalThis as { Buffer?: typeof Buffer }).Buffer;
	return typeof buf === 'function' ? buf : undefined;
}

/**
 * WHATWG forgiving-base64 normalization without the alphabet check: strip ASCII whitespace, then
 * drop trailing padding where the spec allows it (total length a multiple of 4). `null` when the
 * length can't be base64. The decoders check the alphabet themselves, faster than a regex.
 */
function stripBase64(str: string): string | null {
	let data = str.replace(/[\t\n\f\r ]/g, '');
	if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
	return data.length % 4 === 1 ? null : data;
}

/**
 * @throws {VisualizationError} `ENCODING_ERROR` if invalid, or `INVALID_STATE` if no decoder is
 *   available in this environment.
 */
export function decodeBase64ToBinary(base64File: string): Uint8Array {
	const data = stripBase64(base64File);
	const bytes = data === null ? null : decodeStripped(data);
	if (bytes === null) {
		throw new VisualizationError('Invalid base64 input.', ErrorCodes.ENCODING_ERROR, {
			context: { inputLength: base64File.length }
		});
	}
	return bytes;
}

/** Decode {@link stripBase64} output; `null` when a character is outside the alphabet. */
function decodeStripped(data: string): Uint8Array | null {
	// Prefer Buffer in Node: faster, and avoids the atob + charCodeAt latin-1 detour.
	const Buffer = getNodeBuffer();
	if (Buffer) {
		// Buffer decodes leniently: `-` and `_` as base64url, a non-ASCII char as its low byte, and
		// any other stray char is skipped. Rule out the first two; a skip leaves the result short.
		if (Buffer.byteLength(data, 'utf8') !== data.length) return null;
		if (data.includes('-') || data.includes('_')) return null;
		const decoded = Buffer.from(data, 'base64');
		if (decoded.length !== Math.floor((data.length * 3) / 4)) return null;
		// Small Buffer.from results are views over Node's shared 8 KiB pool slab: copy one out, or
		// it retains the whole slab and leaks unrelated pooled bytes to any consumer touching
		// `.buffer` (structuredClone, postMessage transfer, etc). A large one owns its memory.
		const ownsBuffer = decoded.byteOffset === 0 && decoded.buffer.byteLength === decoded.length;
		return ownsBuffer ? new Uint8Array(decoded.buffer, 0, decoded.length) : new Uint8Array(decoded);
	}
	if (typeof globalThis.atob === 'function') {
		let binary: string;
		try {
			binary = globalThis.atob(data);
		} catch {
			return null;
		}
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
