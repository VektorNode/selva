// ============================================================================
// Binary solve response: wire format
// ============================================================================
//
// A display batch's mesh is an already-deflated SLVA blob. In the JSON response it travels as
// base64 inside a JSON string inside the values JSON: a third bigger, escaped twice, then gzipped
// for almost nothing, and the browser must hold the whole body as text to read it. A client that
// sends `Accept: application/vnd.selva.solve+binary` gets the same response with each blob split
// out as raw bytes. Any other client gets the JSON it always got.
//
// All integers little-endian. Each section starts on an 8-byte boundary, so a typed-array view
// over a blob never needs a copy to align.
//
//   offset  size        field
//   0       4           magic, ASCII "SLVR"
//   4       2           format version, 1
//   6       2           flags: bit 0 = the JSON section is gzip
//   8       4           JSON section byte length, as sent
//   12      4           blob count N
//   16      4 * N       byte length of each blob
//   ...     0-7         zero padding to the next multiple of 8
//           (JSON len)  the response JSON, UTF-8, gzipped when flag bit 0 is set
//           0-7         zero padding
//           per blob: its bytes, then zero padding to the next multiple of 8
//
// In the JSON section, every display item's `data` is still a JSON string of the batch, but its
// `compressedData` is `{ "$blob": i }`: blob i, in the order above.

export const BINARY_SOLVE_MEDIA_TYPE = 'application/vnd.selva.solve+binary';

/** ASCII "SLVR", read as a little-endian u32. */
export const BINARY_SOLVE_MAGIC = 0x52564c53;
export const BINARY_SOLVE_VERSION = 1;
export const BINARY_SOLVE_FLAG_GZIP_JSON = 0x1;

const FIXED_HEADER_BYTES = 16;

export interface BlobRef {
	$blob: number;
}

export function isBlobRef(value: unknown): value is BlobRef {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { $blob?: unknown }).$blob === 'number'
	);
}

/**
 * True when a wire `type` names a Display payload: one dot-separated token is exactly `Display` or
 * `DisplayBatch`. Must match `isDisplayItemType` in `@selvajs/visualization`'s webdisplay parser,
 * which can't share this one: visualization takes no dependency on this package.
 */
export function isDisplayItemType(type: string): boolean {
	const tokens = type.split('.');
	return tokens.includes('Display') || tokens.includes('DisplayBatch');
}

export const align8 = (n: number): number => (n + 7) & ~7;

export function headerBytes(blobCount: number): number {
	return align8(FIXED_HEADER_BYTES + 4 * blobCount);
}

export function writeHeader(
	target: Uint8Array,
	flags: number,
	jsonBytes: number,
	blobLengths: readonly number[]
): void {
	const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
	view.setUint32(0, BINARY_SOLVE_MAGIC, true);
	view.setUint16(4, BINARY_SOLVE_VERSION, true);
	view.setUint16(6, flags, true);
	view.setUint32(8, jsonBytes, true);
	view.setUint32(12, blobLengths.length, true);
	blobLengths.forEach((length, i) => view.setUint32(FIXED_HEADER_BYTES + 4 * i, length, true));
}

export interface FrameLayout {
	flags: number;
	json: Uint8Array;
	blobs: Uint8Array[];
}

/** Splits a frame into views over `bytes`; nothing is copied. Throws on a malformed frame. */
export function readFrame(bytes: Uint8Array): FrameLayout {
	const fail = (why: string): never => {
		throw new Error(`Malformed binary solve response: ${why}`);
	};
	if (bytes.byteLength < FIXED_HEADER_BYTES) fail('shorter than its header');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== BINARY_SOLVE_MAGIC) fail('bad magic');
	const version = view.getUint16(4, true);
	if (version !== BINARY_SOLVE_VERSION) fail(`unsupported version ${version}`);
	const flags = view.getUint16(6, true);
	const jsonBytes = view.getUint32(8, true);
	const blobCount = view.getUint32(12, true);
	if (FIXED_HEADER_BYTES + 4 * blobCount > bytes.byteLength) fail('blob table runs past the end');

	let offset = headerBytes(blobCount);
	const take = (length: number): Uint8Array => {
		if (offset + length > bytes.byteLength) fail('truncated');
		const section = bytes.subarray(offset, offset + length);
		offset = align8(offset + length);
		return section;
	};
	const json = take(jsonBytes);
	const blobs: Uint8Array[] = [];
	for (let i = 0; i < blobCount; i++) {
		blobs.push(take(view.getUint32(FIXED_HEADER_BYTES + 4 * i, true)));
	}
	return { flags, json, blobs };
}
