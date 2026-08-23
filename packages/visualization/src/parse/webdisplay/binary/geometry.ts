import { inflateSync } from 'fflate';

import { decodeBase64ToBinary, VisualizationError, ErrorCodes } from '../../../shared/index.js';

import { COMPRESSED_MESH_MAGIC } from './header.js';

export function toUint8Array(input: ArrayBuffer | Uint8Array | string): Uint8Array {
	if (typeof input === 'string') {
		return decodeBase64ToBinary(input);
	}
	if (input instanceof Uint8Array) {
		return input;
	}
	return new Uint8Array(input);
}

/**
 * If the blob is a SLVZ compressed container, inflate it back to the raw SLVA bytes; otherwise
 * return the input untouched. Detection is by the leading 4-byte magic, so an uncompressed SLVA
 * blob (or any pre-v3 payload) flows through unchanged.
 */
export function maybeDecompress(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength < 8) {
		return bytes;
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== COMPRESSED_MESH_MAGIC) {
		return bytes;
	}

	const uncompressedLen = view.getUint32(4, true);
	const deflated = bytes.subarray(8);

	// Bound the wire-supplied length before allocating — a corrupt header could request ~4 GB.
	// DEFLATE won't expand past ~1000x.
	const maxPlausibleLen = Math.max(deflated.byteLength * 1032 + 1024, 1 << 20);
	if (uncompressedLen > maxPlausibleLen) {
		throw fail('SLVZ header declares an implausible uncompressed length', {
			uncompressedLen,
			deflatedBytes: deflated.byteLength,
			maxPlausibleLen
		});
	}

	let out: Uint8Array;
	try {
		// One byte of slack past the declared length: fflate trims its output to bytes actually
		// written, so a mismatched header lands off `uncompressedLen` either way — caught below
		// instead of silently decoding a zero-padded/truncated tail as geometry.
		out = inflateSync(deflated, { out: new Uint8Array(uncompressedLen + 1) });
	} catch (error) {
		throw fail(
			`Failed to inflate SLVZ blob: ${error instanceof Error ? error.message : String(error)}`,
			{ uncompressedLen, deflatedBytes: deflated.byteLength }
		);
	}

	if (out.byteLength !== uncompressedLen) {
		throw fail('SLVZ payload inflated to a different size than the header declares.', {
			declaredLen: uncompressedLen,
			actualLen: out.byteLength,
			deflatedBytes: deflated.byteLength
		});
	}

	return out;
}

export function decodeUtf8(bytes: Uint8Array): string {
	if (typeof TextDecoder !== 'undefined') {
		return new TextDecoder('utf-8').decode(bytes);
	}
	// Node fallback (Buffer is utf-8 by default).
	if (
		typeof (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } })
			.Buffer !== 'undefined'
	) {
		return (
			globalThis as { Buffer: { from(b: Uint8Array): { toString(enc: string): string } } }
		).Buffer.from(bytes).toString('utf-8');
	}
	throw new VisualizationError(
		'No UTF-8 decoder available in this environment.',
		ErrorCodes.INVALID_STATE
	);
}

export function readInt16Vertices(
	buffer: ArrayBufferLike,
	byteOffset: number,
	count: number
): Int16Array {
	if (count === 0) return new Int16Array(0);
	if (byteOffset % 2 === 0) {
		return new Int16Array(buffer, byteOffset, count);
	}
	// Misaligned (rare — would require a wrapper Uint8Array with odd byteOffset).
	const copy = new Uint8Array(count * 2);
	copy.set(new Uint8Array(buffer, byteOffset, count * 2));
	return new Int16Array(copy.buffer);
}

export function readFloat32Vertices(
	buffer: ArrayBufferLike,
	byteOffset: number,
	count: number
): Float32Array {
	if (count === 0) return new Float32Array(0);
	if (byteOffset % 4 === 0) {
		return new Float32Array(buffer, byteOffset, count);
	}
	const copy = new Uint8Array(count * 4);
	copy.set(new Uint8Array(buffer, byteOffset, count * 4));
	return new Float32Array(copy.buffer);
}

export function readUint16Array(
	buffer: ArrayBufferLike,
	byteOffset: number,
	count: number
): Uint16Array {
	if (count === 0) return new Uint16Array(0);
	if (byteOffset % 2 === 0) {
		return new Uint16Array(buffer, byteOffset, count);
	}
	const copy = new Uint8Array(count * 2);
	copy.set(new Uint8Array(buffer, byteOffset, count * 2));
	return new Uint16Array(copy.buffer);
}

export function readUint32Array(
	buffer: ArrayBufferLike,
	byteOffset: number,
	count: number
): Uint32Array {
	if (count === 0) return new Uint32Array(0);
	if (byteOffset % 4 === 0) {
		return new Uint32Array(buffer, byteOffset, count);
	}
	const copy = new Uint8Array(count * 4);
	copy.set(new Uint8Array(buffer, byteOffset, count * 4));
	return new Uint32Array(copy.buffer);
}

/**
 * Rejects blobs whose index stream references vertices past `vertexCount`. Downstream mesh
 * assembly trusts indices arithmetically (rebasing, `subarray` slicing), so an out-of-range index
 * would otherwise corrupt geometry silently instead of failing the parse. A uint16 index stream
 * can't exceed a vertex count above 65535, so that case skips the scan.
 */
export function validateIndicesInRange(
	indices: Uint16Array | Uint32Array,
	vertexCount: number
): void {
	if (indices.length === 0) return;
	if (indices instanceof Uint16Array && vertexCount > 0xffff) return;
	for (let i = 0; i < indices.length; i++) {
		if (indices[i]! >= vertexCount) {
			throw fail('Index out of range of vertexCount.', {
				indexPosition: i,
				indexValue: indices[i],
				vertexCount
			});
		}
	}
}

/** Inverse of the writer's zigzag map: 0,1,2,3 → 0,-1,1,-2. */
export function unzigzag(zz: number): number {
	return (zz >>> 1) ^ -(zz & 1);
}

/**
 * Undoes the v3 delta filter on the quantized vertex stream: each component is a zigzag-mapped,
 * wrapped 16-bit difference from the previous vertex's same component (independent x/y/z running
 * sums). `(x << 16) >> 16` reproduces the writer's int16 wrapping.
 */
export function decodeDeltaVertices(zigzagged: Uint16Array): Int16Array {
	const out = new Int16Array(zigzagged.length);
	let px = 0;
	let py = 0;
	let pz = 0;
	for (let i = 0; i < zigzagged.length; i += 3) {
		px = ((px + unzigzag(zigzagged[i]!)) << 16) >> 16;
		py = ((py + unzigzag(zigzagged[i + 1]!)) << 16) >> 16;
		pz = ((pz + unzigzag(zigzagged[i + 2]!)) << 16) >> 16;
		out[i] = px;
		out[i + 1] = py;
		out[i + 2] = pz;
	}
	return out;
}

export function decodeDeltaIndices16(zigzagged: Uint16Array): Uint16Array {
	const out = new Uint16Array(zigzagged.length);
	let prev = 0;
	for (let i = 0; i < zigzagged.length; i++) {
		prev = (prev + unzigzag(zigzagged[i]!)) & 0xffff;
		out[i] = prev;
	}
	return out;
}

export function decodeDeltaIndices32(zigzagged: Uint32Array): Uint32Array {
	const out = new Uint32Array(zigzagged.length);
	let prev = 0;
	for (let i = 0; i < zigzagged.length; i++) {
		prev = (prev + unzigzag(zigzagged[i]!)) >>> 0;
		out[i] = prev;
	}
	return out;
}

export function fail(message: string, context: Record<string, unknown>): VisualizationError {
	return new VisualizationError(message, ErrorCodes.VALIDATION_ERROR, { context });
}
