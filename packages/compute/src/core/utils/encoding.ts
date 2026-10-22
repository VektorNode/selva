import { ComputeError, ErrorCodes } from '../errors';

function getNodeBuffer(): typeof Buffer | undefined {
	const buf = (globalThis as { Buffer?: typeof Buffer }).Buffer;
	return typeof buf === 'function' ? buf : undefined;
}

export function encodeStringToBase64(str: string): string {
	const Buffer = getNodeBuffer();
	if (Buffer) {
		return Buffer.from(str, 'utf-8').toString('base64');
	}
	return base64ByteArray(new TextEncoder().encode(str));
}

/**
 * WHATWG forgiving-base64 normalization: strip ASCII whitespace, then drop trailing padding where
 * the spec allows it (total length a multiple of 4). `null` when the result can't be base64.
 */
function normalizeBase64(str: string): string | null {
	const data = stripBase64(str);
	return data === null || /[^A-Za-z0-9+/]/.test(data) ? null : data;
}

/** {@link normalizeBase64} without the alphabet check, which the decoders make faster on their own. */
function stripBase64(str: string): string | null {
	let data = str.replace(/[\t\n\f\r ]/g, '');
	if (data.length % 4 === 0) data = data.replace(/={1,2}$/, '');
	return data.length % 4 === 1 ? null : data;
}

/** Shortest string treated as base64 (≈ 48 bytes): human-written strings rarely reach it. */
export const BASE64_DETECT_MIN_LENGTH = 64;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Whether an untyped string is base64 content: the canonical padded form when confident, else
 * `null` (treat it as plain text). A heuristic; pass a `Uint8Array` when it must be exact.
 */
export function detectBase64Payload(str: string): string | null {
	const data = normalizeBase64(str);
	if (data === null || data.length < BASE64_DETECT_MIN_LENGTH) return null;

	// An encoder leaves the final character's unused low bits zero; otherwise re-encoding the
	// decoded bytes wouldn't reproduce the input.
	const rem = data.length % 4;
	const lastValue = B64_ALPHABET.indexOf(data.charAt(data.length - 1));
	if (rem === 2 && (lastValue & 0x0f) !== 0) return null;
	if (rem === 3 && (lastValue & 0x03) !== 0) return null;

	return rem === 0 ? data : data + '=='.slice(0, 4 - rem);
}

/**
 * Decode base64 to bytes, normalizing and validating the same way in Node and browsers.
 * `packages/visualization/src/shared/encoding.ts` keeps a copy that throws its own error class;
 * change both together.
 *
 * @throws {ComputeError} `ENCODING_ERROR` if invalid, or `ENVIRONMENT_ERROR` if the runtime has no decoder
 */
export function decodeBase64ToBinary(base64File: string): Uint8Array {
	const data = stripBase64(base64File);
	const bytes = data === null ? null : decodeStripped(data);
	if (bytes === null) {
		throw new ComputeError('Invalid base64 input.', ErrorCodes.ENCODING_ERROR, {
			context: { inputLength: base64File.length }
		});
	}
	return bytes;
}

/** Decode {@link stripBase64} output; `null` when a character is outside the alphabet. */
function decodeStripped(data: string): Uint8Array | null {
	// Buffer over atob in Node: faster, and skips the latin-1 string detour.
	const Buffer = getNodeBuffer();
	if (Buffer) {
		// Buffer decodes leniently: `-` and `_` as base64url, a non-ASCII char as its low byte, and
		// any other stray char is skipped. Rule out the first two; a skip leaves the result short.
		// Several times faster than an alphabet regex over a multi-MB payload.
		if (Buffer.byteLength(data, 'utf8') !== data.length) return null;
		if (data.includes('-') || data.includes('_')) return null;
		const decoded = Buffer.from(data, 'base64');
		if (decoded.length !== Math.floor((data.length * 3) / 4)) return null;
		// A small result is a view over Node's shared 8 KiB pool slab: copy it out, or anyone
		// touching `.buffer` sees unrelated pooled bytes. A large one owns its memory outright.
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

	throw new ComputeError(
		'Base64 decoding not supported in this environment.',
		ErrorCodes.ENVIRONMENT_ERROR,
		{ context: { environmentInfo: 'atob or Buffer not available' } }
	);
}

/** UTF-8 byte length without allocating the encoded copy `TextEncoder.encode` would. */
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

export function base64ByteArray(bytes: Uint8Array): string {
	const Buffer = getNodeBuffer();
	if (Buffer) {
		return Buffer.from(bytes).toString('base64');
	}
	if (typeof globalThis.btoa === 'function') {
		// Chunked so memory doesn't peak at ~3× the input. CHUNK must be a multiple of 3: every
		// non-final chunk then encodes without padding, and the joined pieces equal a one-shot
		// encode. 32766 = 3 × 10922, well under fromCharCode.apply's argument limit.
		const CHUNK = 32766;
		const parts: string[] = [];
		for (let i = 0; i < bytes.length; i += CHUNK) {
			parts.push(
				globalThis.btoa(
					String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
				)
			);
		}
		return parts.join('');
	}
	throw new ComputeError(
		'Base64 encoding not supported in this environment.',
		ErrorCodes.ENVIRONMENT_ERROR,
		{ context: { environmentInfo: 'btoa or Buffer not available' } }
	);
}
