import { RhinoComputeError, ErrorCodes } from '../errors';

/** Node's `Buffer` when present (faster path), else `undefined` in browsers/workers. */
function getNodeBuffer(): typeof Buffer | undefined {
	const buf = (globalThis as { Buffer?: typeof Buffer }).Buffer;
	return typeof buf === 'function' ? buf : undefined;
}

/**
 * Encodes a string to base64 (Node 20+ safe)
 *
 * @internal Internal encoding helper — kept internal to `@selvajs/compute`.
 *
 * @param str - String to encode
 * @returns Base64 encoded string
 */
export function encodeStringToBase64(str: string): string {
	const Buffer = getNodeBuffer();
	if (Buffer) {
		return Buffer.from(str, 'utf-8').toString('base64');
	}
	// Browser/worker fallback: UTF-8 encode, then reuse the byte-array encoder.
	return base64ByteArray(new TextEncoder().encode(str));
}

/**
 * Checks if a string is SYNTACTICALLY valid base64 (strict form: length a
 * multiple of 4, alphabet chars, at most 2 trailing `=`).
 *
 * @internal Internal encoding helper — kept internal to `@selvajs/compute`.
 *
 * This is a validity check, NOT a detection heuristic — short human strings
 * like `"test"` are syntactically valid base64 and return `true` here. To
 * decide whether an untyped string SHOULD be treated as base64 content (vs. a
 * plain string that needs encoding), use {@link detectBase64Payload}.
 *
 * @param str - String to check
 * @returns True if the string is valid base64
 */
export function isBase64(str: string): boolean {
	if (!str || str.length < 2) return false;
	// Length must be a multiple of 4, only alphabet chars + at most 2 trailing '='
	if (str.length % 4 !== 0) return false;
	return /^[A-Za-z0-9+/]+={0,2}$/.test(str);
}

/**
 * Minimum length (in base64 data characters, padding excluded) for
 * {@link detectBase64Payload} to treat a bare string as base64 content.
 * 64 chars ≈ 48 decoded bytes — far below any real Grasshopper definition
 * (smallest .gh files are hundreds of bytes), but above virtually every
 * human-authored plain string that happens to use only base64 alphabet
 * characters (`"test"`, `"Data2024"`, identifiers, hashes-as-words, …).
 *
 * @internal
 */
export const BASE64_DETECT_MIN_LENGTH = 64;

/** Lookup for a base64 character's 6-bit value; -1 when not in the alphabet. */
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Detection heuristic: is this untyped string base64-encoded CONTENT (as
 * opposed to a plain string that still needs encoding)?
 *
 * @internal Internal encoding helper — kept internal to `@selvajs/compute`.
 *
 * Perfect detection is impossible — `"test"` is valid base64 — so this errs
 * toward encoding. A string is accepted as base64 only when, after
 * forgiving-base64 whitespace/padding normalization, ALL of the following hold:
 *
 * 1. It contains only base64 alphabet characters with a legal length
 *    (`len % 4 !== 1`); newline-wrapped and unpadded inputs are accepted, so
 *    valid-but-non-strict base64 no longer gets double-encoded.
 * 2. It is at least {@link BASE64_DETECT_MIN_LENGTH} data characters long —
 *    real definitions are KB–MB, short human strings are not.
 * 3. It is canonical: re-encoding the decoded bytes reproduces it exactly
 *    (checked cheaply — the unused trailing bits of the final character must
 *    be zero — no O(n) decode needed).
 *
 * Residual ambiguity: a ≥64-char plain string composed exclusively of base64
 * alphabet characters (no spaces or punctuation) with a canonical length/tail
 * is still detected as base64. Callers that must be exact should pass a
 * `Uint8Array` (or a URL) instead of a bare string — bytes are never sniffed.
 *
 * @param str - String to inspect
 * @returns The canonical (whitespace-stripped, padded) base64 form when the
 *   string is confidently base64 content, else `null` (treat as plain text).
 */
export function detectBase64Payload(str: string): string | null {
	if (!str) return null;
	// Forgiving-base64 normalization, mirroring decodeBase64ToBinary: strip
	// ASCII whitespace, then drop legal trailing padding.
	let data = str.replace(/[\t\n\f\r ]/g, '');
	if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');

	const rem = data.length % 4;
	if (rem === 1) return null; // no base64 encoding produces this length
	if (data.length < BASE64_DETECT_MIN_LENGTH) return null;
	if (!/^[A-Za-z0-9+/]*$/.test(data)) return null;

	// Canonical round-trip check without decoding: the final character's
	// unused low bits must be zero, otherwise re-encoding the decoded bytes
	// would not reproduce the input (i.e. it wasn't produced by an encoder).
	const lastValue = B64_ALPHABET.indexOf(data.charAt(data.length - 1));
	if (rem === 2 && (lastValue & 0x0f) !== 0) return null;
	if (rem === 3 && (lastValue & 0x03) !== 0) return null;

	return rem === 0 ? data : data + '=='.slice(0, 4 - rem);
}

/**
 * Decodes a base64 string to binary data (Uint8Array)
 *
 * @internal Internal encoding helper — kept internal to `@selvajs/compute`.
 *
 * Input is normalized and validated per WHATWG forgiving-base64 (whitespace
 * stripped, padding checked) BEFORE decoding, so both runtimes fail the same
 * way: without this, Node's `Buffer.from(x, 'base64')` silently decodes
 * malformed input into garbage while browser `atob` throws a bare
 * `InvalidCharacterError` DOMException.
 *
 * @param base64File - Base64 encoded string
 * @returns Decoded binary data as Uint8Array
 * @throws {RhinoComputeError} `ENCODING_ERROR` if the input is not valid
 *   base64, or `INVALID_STATE` if no decoder exists in this environment.
 */
export function decodeBase64ToBinary(base64File: string): Uint8Array {
	// Forgiving-base64 normalization: strip ASCII whitespace (wrapped /
	// pretty-printed payloads), then drop trailing padding only where the spec
	// allows it (total length a multiple of 4).
	let data = base64File.replace(/[\t\n\f\r ]/g, '');
	if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
	if (data.length % 4 === 1 || !/^[A-Za-z0-9+/]*$/.test(data)) {
		throw new RhinoComputeError('Invalid base64 input.', ErrorCodes.ENCODING_ERROR, {
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

	throw new RhinoComputeError(
		'Base64 decoding not supported in this environment.',
		ErrorCodes.INVALID_STATE,
		{ context: { environmentInfo: 'atob or Buffer not available' } }
	);
}

/**
 * UTF-8 byte length of a string (what actually goes over the wire), without
 * allocating an encoded copy — `TextEncoder.encode` on a multi-MB request body
 * would double its memory just to measure it.
 *
 * @internal Internal encoding helper — kept internal to `@selvajs/compute`.
 */
export function utf8ByteLength(str: string): number {
	const Buffer = getNodeBuffer();
	if (Buffer) {
		return Buffer.byteLength(str, 'utf-8');
	}
	let bytes = 0;
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (
			code >= 0xd800 &&
			code <= 0xdbff &&
			i + 1 < str.length &&
			(str.charCodeAt(i + 1) & 0xfc00) === 0xdc00
		) {
			// Surrogate pair → one 4-byte code point; lone surrogates fall through
			// to 3 bytes (the replacement-character encoding TextEncoder emits).
			bytes += 4;
			i++;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

/**
 * Encodes binary data (Uint8Array) to base64 string.
 *
 * @internal Internal encoding helper — kept internal to `@selvajs/compute`.
 *
 * Uses Node's `Buffer` when available (faster, single allocation) and falls
 * back to `btoa` over a latin-1 string in browsers/workers.
 */
export function base64ByteArray(bytes: Uint8Array): string {
	const Buffer = getNodeBuffer();
	if (Buffer) {
		return Buffer.from(bytes).toString('base64');
	}
	if (typeof globalThis.btoa === 'function') {
		// Encode chunk-by-chunk and join the base64 pieces, instead of building
		// one full-input latin-1 string and btoa-ing it (which peaked at ~3×
		// input memory). The chunk size MUST be a multiple of 3 bytes so every
		// non-final chunk encodes to whole base64 quanta with no padding —
		// concatenating the pieces is then byte-for-byte identical to encoding
		// the whole input at once. 32766 = 3 × 10922, and stays well under the
		// fromCharCode.apply argument-count limit.
		const CHUNK = 32766;
		const parts: string[] = [];
		for (let i = 0; i < bytes.length; i += CHUNK) {
			// A Uint8Array subarray is array-like, so pass it straight to
			// fromCharCode.apply — no need to copy it into a plain Array first.
			parts.push(
				globalThis.btoa(
					String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
				)
			);
		}
		return parts.join('');
	}
	throw new RhinoComputeError(
		'Base64 encoding not supported in this environment.',
		ErrorCodes.INVALID_STATE,
		{ context: { environmentInfo: 'btoa or Buffer not available' } }
	);
}
