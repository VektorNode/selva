import { inflateSync } from 'fflate';

import { decodeBase64ToBinary } from '@/core/utils/encoding';
import { RhinoComputeError, ErrorCodes } from '@/core/errors';

import type { MaterialGroup, SerializableMaterial } from './types';

// ============================================================================
// WIRE FORMAT CONSTANTS
// ============================================================================

/** "SLVA" little-endian — an uncompressed mesh blob. */
export const BINARY_MESH_MAGIC = 0x41564c53;
/**
 * "SLVZ" little-endian — a gzip (raw DEFLATE) container around a SLVA blob. The plugin applies this
 * optionally when it shrinks the payload (the wire is otherwise uncompressed). Layout:
 *   [4] magic = SLVZ, [4] uncompressedLen (uint32), [N] raw-deflate stream of the SLVA blob.
 */
export const COMPRESSED_MESH_MAGIC = 0x5a564c53;
/**
 * Current writer version. v2 added the uint16-index flag (FLAG_UINT16_INDICES); v3 added the
 * delta+zigzag filter flag (FLAG_DELTA_ENCODED).
 */
export const BINARY_MESH_VERSION = 3;
/**
 * Oldest wire version this parser still decodes. Each version only added a flag bit — v1 always
 * used uint32 indices, v2 introduced uint16 indices, v3 the delta filter — so the flag-driven read
 * path handles every older blob unchanged. Accepting them keeps persisted/cached blobs (saved `.gh`
 * files, DMF files, cached compute results) decodable after upgrade.
 */
export const MIN_SUPPORTED_VERSION = 1;
/** Bit 0 of the geometry flags word: 0 = int16 quantized, 1 = float32 raw. */
export const FLAG_FLOAT32 = 0x1;
/** Bit 1 of the geometry flags word: 0 = uint32 indices, 1 = uint16 indices. */
export const FLAG_UINT16_INDICES = 0x2;
/**
 * Bit 2 of the geometry flags word: int16 vertex components and the index stream are stored as
 * wrapped per-component deltas from their predecessor, zigzag-mapped to unsigned (float32 vertices
 * are never filtered). Deltas of welded meshes concentrate near zero, which makes the SLVZ DEFLATE
 * pass compress far better. Decoding reverses the filter with a running prefix sum.
 */
export const FLAG_DELTA_ENCODED = 0x4;
/**
 * Bit 3 of the geometry flags word: a UV chunk trails the index block. Layout:
 * `uvFormat(u32: 0 = uint16 quantized, 1 = float32) | uvOrigin(2×f64) | uvScale(2×f64) | data`,
 * with the element count implied by vertexCount. Quantized UVs reconstruct as
 * `uv = origin + q * scale` (q unsigned in [0, 65535]) and are delta+zigzag filtered per component
 * (independent u/v predictors) iff FLAG_DELTA_ENCODED; float32 UVs are never filtered. Absent flag
 * = absent chunk, so untextured blobs are byte-identical to pre-chunk writers.
 */
export const FLAG_HAS_UVS = 0x8;
/**
 * Bit 4 of the geometry flags word: a vertex-color chunk trails the index block (after the UV
 * chunk when both are present). Layout: `uint8 rgb[vertexCount*3]`, delta+zigzag filtered per
 * channel (wrapped 8-bit, independent r/g/b predictors) iff FLAG_DELTA_ENCODED.
 */
export const FLAG_HAS_VERTEX_COLORS = 0x10;

/** uvFormat value inside the UV chunk: uint16 quantized. */
export const UV_FORMAT_UINT16 = 0;
/** uvFormat value inside the UV chunk: raw float32. */
export const UV_FORMAT_FLOAT32 = 1;

const HEADER_PREAMBLE_BYTES = 4 /* magic */ + 4 /* version */ + 4; /* metadataLen */
const GEOMETRY_HEADER_BYTES =
	4 /* flags */ + 24 /* origin (3 x f64) */ + 24 /* scale (3 x f64) */ + 4; /* vertexCount */

// ============================================================================
// PARSED TYPES
// ============================================================================

/**
 * Metadata JSON embedded inside the binary blob.
 *
 * This is the mesh-blob subset of a `DisplayBatch` minus the `compressedData` field (the blob is
 * opaque to its own metadata header). Kept separate from the public `DisplayBatch` type because the
 * blob's metadata never carries `compressedData` itself — it would be circular.
 */
export interface BinaryMeshMetadata {
	materials: SerializableMaterial[];
	groups: MaterialGroup[];
	sourceComponentId?: string;
}

/**
 * Result of parsing a binary mesh blob.
 *
 * `vertices` and `indices` hold absolute (unfiltered) values. For pre-v3 blobs they are typed-array
 * views over the original `ArrayBuffer` — zero copies; the consumer is responsible for not mutating
 * the underlying buffer if it cares about safety, or for calling `.slice()` to detach. Delta-encoded
 * blobs (FLAG_DELTA_ENCODED) decode into freshly allocated arrays instead.
 *
 * `uvs` / `colors` are the optional trailing chunks (FLAG_HAS_UVS / FLAG_HAS_VERTEX_COLORS), null
 * when the blob doesn't carry them. UVs are returned dequantized to absolute Float32 values (u,v
 * per vertex), so consumers can hand them straight to a `BufferAttribute(uvs, 2)`. Colors are raw
 * r,g,b bytes per vertex for a normalized `BufferAttribute(colors, 3, true)`.
 */
export interface ParsedBinaryMeshBatch {
	metadata: BinaryMeshMetadata;
	flags: number;
	vertices: Int16Array | Float32Array;
	indices: Uint16Array | Uint32Array;
	origin: [number, number, number];
	scale: [number, number, number];
	uvs: Float32Array | null;
	colors: Uint8Array | null;
}

// ============================================================================
// PARSER
// ============================================================================

/**
 * Parses a binary mesh batch blob in the SLVA wire format.
 *
 * The blob layout is:
 * ```
 *   [4]  magic        = "SLVA" (0x53 0x4C 0x56 0x41)
 *   [4]  version      = uint32 (currently 3)
 *   [4]  metadataLen  = uint32 byte length of UTF-8 metadata JSON
 *   [N]  metadata     = UTF-8 JSON (materials, groups, sourceComponentId, ...)
 *   [4]  flags        = uint32 (bit 0: 0 = int16 quantized, 1 = float32 raw;
 *                                bit 1: 0 = uint32 indices, 1 = uint16 indices;
 *                                bit 2: 1 = delta+zigzag filtered)
 *   [24] origin       = 3 x float64
 *   [24] scale        = 3 x float64 (step per int16 unit; identity for float32)
 *   [4]  vertexCount  = uint32 number of vertices (positions = vertexCount * 3 components)
 *   [V]  vertices     = int16[vertexCount*3] OR float32[vertexCount*3]
 *   [4]  indexCount   = uint32 number of indices
 *   [I]  indices      = uint32[indexCount] OR uint16[indexCount]
 * ```
 *
 * For int16 vertices: world position = `origin + (q + 32767) * scale`. This matches Three.js
 * `BufferAttribute(arr, 3, true)` (`normalized: true`) semantics when the per-mesh transform
 * encodes `origin + scale`.
 *
 * For float32: `origin = (0, 0, 0)`, `scale = (1, 1, 1)`, vertices are raw world positions.
 *
 * With FLAG_DELTA_ENCODED (v3), the stored int16 vertex components and indices are wrapped
 * differences from their predecessor, zigzag-mapped — see the flag's doc. The parser returns the
 * reconstructed absolute values, so consumers never see the filter.
 *
 * @param input - The blob, as either an `ArrayBuffer`/`Uint8Array` (binary transport) or a
 *   base64-encoded string (today's JSON-envelope transport).
 * @returns Decoded metadata plus typed-array views into the geometry payload.
 * @throws {RhinoComputeError} On invalid magic, unknown version, or truncated input.
 */
export function parseBinaryMeshBatch(
	input: ArrayBuffer | Uint8Array | string
): ParsedBinaryMeshBatch {
	const bytes = maybeDecompress(toUint8Array(input));
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	if (bytes.byteLength < HEADER_PREAMBLE_BYTES) {
		throw fail('Blob too small to contain SLVA header.', {
			expectedBytes: HEADER_PREAMBLE_BYTES,
			availableBytes: bytes.byteLength
		});
	}

	let offset = 0;

	const magic = view.getUint32(offset, true);
	offset += 4;
	if (magic !== BINARY_MESH_MAGIC) {
		throw fail(`Invalid SLVA magic: 0x${magic.toString(16)}`, {
			expectedMagic: `0x${BINARY_MESH_MAGIC.toString(16)}`,
			actualMagic: `0x${magic.toString(16)}`
		});
	}

	const version = view.getUint32(offset, true);
	offset += 4;
	if (version < MIN_SUPPORTED_VERSION || version > BINARY_MESH_VERSION) {
		throw fail(`Unsupported SLVA version: ${version}`, {
			minSupportedVersion: MIN_SUPPORTED_VERSION,
			maxSupportedVersion: BINARY_MESH_VERSION,
			actualVersion: version
		});
	}

	const metadataLen = view.getUint32(offset, true);
	offset += 4;
	if (offset + metadataLen > bytes.byteLength) {
		throw fail('Insufficient data to read metadata JSON.', {
			expectedBytes: metadataLen,
			availableBytes: bytes.byteLength - offset,
			offset
		});
	}

	const metadataBytes = bytes.subarray(offset, offset + metadataLen);
	offset += metadataLen;

	let metadata: BinaryMeshMetadata;
	try {
		metadata = JSON.parse(decodeUtf8(metadataBytes)) as BinaryMeshMetadata;
	} catch (error) {
		throw fail(
			`Failed to parse metadata JSON: ${error instanceof Error ? error.message : String(error)}`,
			{ metadataLen }
		);
	}

	if (offset + GEOMETRY_HEADER_BYTES > bytes.byteLength) {
		throw fail('Insufficient data to read geometry header.', {
			expectedBytes: GEOMETRY_HEADER_BYTES,
			availableBytes: bytes.byteLength - offset,
			offset
		});
	}

	const flags = view.getUint32(offset, true);
	offset += 4;

	const originX = view.getFloat64(offset, true);
	offset += 8;
	const originY = view.getFloat64(offset, true);
	offset += 8;
	const originZ = view.getFloat64(offset, true);
	offset += 8;

	const scaleX = view.getFloat64(offset, true);
	offset += 8;
	const scaleY = view.getFloat64(offset, true);
	offset += 8;
	const scaleZ = view.getFloat64(offset, true);
	offset += 8;

	const vertexCount = view.getUint32(offset, true);
	offset += 4;

	const useFloat32 = (flags & FLAG_FLOAT32) !== 0;
	const deltaEncoded = (flags & FLAG_DELTA_ENCODED) !== 0;
	const componentCount = vertexCount * 3;
	const bytesPerComponent = useFloat32 ? 4 : 2;
	const verticesByteLength = componentCount * bytesPerComponent;

	if (offset + verticesByteLength > bytes.byteLength) {
		throw fail('Insufficient data to read vertices.', {
			expectedBytes: verticesByteLength,
			availableBytes: bytes.byteLength - offset,
			offset,
			useFloat32,
			vertexCount
		});
	}

	// Typed-array views require alignment to the element size. The header lays out the geometry
	// block such that the vertex byte offset is always 4-aligned (preamble 12 + metadataLen + 4 +
	// 48 + 4). float32 needs 4-byte alignment (satisfied), int16 needs 2-byte alignment
	// (satisfied). We can take a zero-copy view as long as `bytes.byteOffset + offset` agrees with
	// that alignment in the underlying buffer — a wrapper Uint8Array could violate it. Fall back
	// to a fresh copy if so.
	const absoluteOffset = bytes.byteOffset + offset;
	let verticesView: Int16Array | Float32Array;
	if (useFloat32) {
		verticesView = readFloat32Vertices(bytes.buffer, absoluteOffset, componentCount);
	} else if (deltaEncoded) {
		// The raw stream holds zigzag-mapped deltas (unsigned); prefix-sum into absolute int16.
		verticesView = decodeDeltaVertices(
			readUint16Array(bytes.buffer, absoluteOffset, componentCount)
		);
	} else {
		verticesView = readInt16Vertices(bytes.buffer, absoluteOffset, componentCount);
	}
	offset += verticesByteLength;

	if (offset + 4 > bytes.byteLength) {
		throw fail('Insufficient data to read index count.', {
			expectedBytes: 4,
			availableBytes: bytes.byteLength - offset,
			offset
		});
	}
	const indexCount = view.getUint32(offset, true);
	offset += 4;

	const useUint16Indices = (flags & FLAG_UINT16_INDICES) !== 0;
	const bytesPerIndex = useUint16Indices ? 2 : 4;
	const indicesByteLength = indexCount * bytesPerIndex;
	if (offset + indicesByteLength > bytes.byteLength) {
		throw fail('Insufficient data to read indices.', {
			expectedBytes: indicesByteLength,
			availableBytes: bytes.byteLength - offset,
			offset,
			indexCount,
			useUint16Indices
		});
	}

	let indicesView = useUint16Indices
		? readUint16Array(bytes.buffer, bytes.byteOffset + offset, indexCount)
		: readUint32Array(bytes.buffer, bytes.byteOffset + offset, indexCount);
	if (deltaEncoded) {
		indicesView =
			indicesView instanceof Uint16Array
				? decodeDeltaIndices16(indicesView)
				: decodeDeltaIndices32(indicesView);
	}
	offset += indicesByteLength;

	// Optional trailing chunks (UV first, then colors). Blobs from pre-chunk writers simply end
	// here; the flags gate every read, so nothing is consumed when the chunks are absent.
	let uvs: Float32Array | null = null;
	if ((flags & FLAG_HAS_UVS) !== 0) {
		const parsed = parseUvChunk(bytes, view, offset, vertexCount, deltaEncoded);
		uvs = parsed.uvs;
		offset = parsed.offset;
	}

	let colors: Uint8Array | null = null;
	if ((flags & FLAG_HAS_VERTEX_COLORS) !== 0) {
		colors = parseColorChunk(bytes, offset, vertexCount, deltaEncoded);
	}

	return {
		metadata,
		flags,
		vertices: verticesView,
		indices: indicesView,
		origin: [originX, originY, originZ],
		scale: [scaleX, scaleY, scaleZ],
		uvs,
		colors
	};
}

/** Byte size of the UV chunk header: uvFormat(u32) + uvOrigin(2×f64) + uvScale(2×f64). */
const UV_CHUNK_HEADER_BYTES = 4 + 16 + 16;

/**
 * Parses the trailing UV chunk into absolute Float32 u,v pairs. Quantized UVs reconstruct as
 * `origin + q * scale` with an unsigned q, undoing the per-component delta+zigzag filter when the
 * blob-wide delta flag is set; float32 UVs are copied out as-is (never filtered).
 */
function parseUvChunk(
	bytes: Uint8Array,
	view: DataView,
	offset: number,
	vertexCount: number,
	deltaEncoded: boolean
): { uvs: Float32Array; offset: number } {
	if (offset + UV_CHUNK_HEADER_BYTES > bytes.byteLength) {
		throw fail('Insufficient data to read UV chunk header.', {
			expectedBytes: UV_CHUNK_HEADER_BYTES,
			availableBytes: bytes.byteLength - offset,
			offset
		});
	}

	const uvFormat = view.getUint32(offset, true);
	offset += 4;
	const originU = view.getFloat64(offset, true);
	offset += 8;
	const originV = view.getFloat64(offset, true);
	offset += 8;
	const scaleU = view.getFloat64(offset, true);
	offset += 8;
	const scaleV = view.getFloat64(offset, true);
	offset += 8;

	const componentCount = vertexCount * 2;
	const useFloat32 = uvFormat === UV_FORMAT_FLOAT32;
	const dataByteLength = componentCount * (useFloat32 ? 4 : 2);
	if (offset + dataByteLength > bytes.byteLength) {
		throw fail('Insufficient data to read UV chunk.', {
			expectedBytes: dataByteLength,
			availableBytes: bytes.byteLength - offset,
			offset,
			uvFormat,
			vertexCount
		});
	}

	const absoluteOffset = bytes.byteOffset + offset;
	let uvs: Float32Array;
	if (useFloat32) {
		// Copy (not view) so the attribute owns its memory like the quantized path.
		uvs = readFloat32Vertices(bytes.buffer, absoluteOffset, componentCount).slice();
	} else {
		const raw = readUint16Array(bytes.buffer, absoluteOffset, componentCount);
		uvs = new Float32Array(componentCount);
		let qu = 0;
		let qv = 0;
		for (let i = 0; i < componentCount; i += 2) {
			if (deltaEncoded) {
				qu = (qu + unzigzag(raw[i]!)) & 0xffff;
				qv = (qv + unzigzag(raw[i + 1]!)) & 0xffff;
			} else {
				qu = raw[i]!;
				qv = raw[i + 1]!;
			}
			uvs[i] = originU + qu * scaleU;
			uvs[i + 1] = originV + qv * scaleV;
		}
	}

	return { uvs, offset: offset + dataByteLength };
}

/**
 * Parses the trailing vertex-color chunk into raw r,g,b bytes, undoing the per-channel wrapped
 * 8-bit delta+zigzag filter when the blob-wide delta flag is set.
 */
function parseColorChunk(
	bytes: Uint8Array,
	offset: number,
	vertexCount: number,
	deltaEncoded: boolean
): Uint8Array {
	const byteLength = vertexCount * 3;
	if (offset + byteLength > bytes.byteLength) {
		throw fail('Insufficient data to read vertex-color chunk.', {
			expectedBytes: byteLength,
			availableBytes: bytes.byteLength - offset,
			offset,
			vertexCount
		});
	}

	const raw = bytes.subarray(offset, offset + byteLength);
	if (!deltaEncoded) {
		return raw.slice();
	}

	const colors = new Uint8Array(byteLength);
	let r = 0;
	let g = 0;
	let b = 0;
	for (let i = 0; i < byteLength; i += 3) {
		r = (r + unzigzag(raw[i]!)) & 0xff;
		g = (g + unzigzag(raw[i + 1]!)) & 0xff;
		b = (b + unzigzag(raw[i + 2]!)) & 0xff;
		colors[i] = r;
		colors[i + 1] = g;
		colors[i + 2] = b;
	}
	return colors;
}

// ============================================================================
// HELPERS
// ============================================================================

function toUint8Array(input: ArrayBuffer | Uint8Array | string): Uint8Array {
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
function maybeDecompress(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength < 8) {
		return bytes;
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== COMPRESSED_MESH_MAGIC) {
		return bytes;
	}

	const uncompressedLen = view.getUint32(4, true);
	const deflated = bytes.subarray(8);

	// Bound the wire-supplied length before allocating — a corrupt header could
	// otherwise request ~4 GB. DEFLATE won't expand past ~1000×.
	const maxPlausibleLen = Math.max(deflated.byteLength * 1032 + 1024, 1 << 20);
	if (uncompressedLen > maxPlausibleLen) {
		throw fail('SLVZ header declares an implausible uncompressed length', {
			uncompressedLen,
			deflatedBytes: deflated.byteLength,
			maxPlausibleLen
		});
	}

	try {
		const out = inflateSync(deflated, { out: new Uint8Array(uncompressedLen) });
		return out;
	} catch (error) {
		throw fail(
			`Failed to inflate SLVZ blob: ${error instanceof Error ? error.message : String(error)}`,
			{ uncompressedLen, deflatedBytes: deflated.byteLength }
		);
	}
}

function decodeUtf8(bytes: Uint8Array): string {
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
	throw new RhinoComputeError(
		'No UTF-8 decoder available in this environment.',
		ErrorCodes.INVALID_STATE
	);
}

function readInt16Vertices(buffer: ArrayBufferLike, byteOffset: number, count: number): Int16Array {
	if (count === 0) return new Int16Array(0);
	if (byteOffset % 2 === 0) {
		return new Int16Array(buffer, byteOffset, count);
	}
	// Misaligned (rare — would require a wrapper Uint8Array with odd byteOffset).
	const copy = new Uint8Array(count * 2);
	copy.set(new Uint8Array(buffer, byteOffset, count * 2));
	return new Int16Array(copy.buffer);
}

function readFloat32Vertices(
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

function readUint16Array(buffer: ArrayBufferLike, byteOffset: number, count: number): Uint16Array {
	if (count === 0) return new Uint16Array(0);
	if (byteOffset % 2 === 0) {
		return new Uint16Array(buffer, byteOffset, count);
	}
	const copy = new Uint8Array(count * 2);
	copy.set(new Uint8Array(buffer, byteOffset, count * 2));
	return new Uint16Array(copy.buffer);
}

function readUint32Array(buffer: ArrayBufferLike, byteOffset: number, count: number): Uint32Array {
	if (count === 0) return new Uint32Array(0);
	if (byteOffset % 4 === 0) {
		return new Uint32Array(buffer, byteOffset, count);
	}
	const copy = new Uint8Array(count * 4);
	copy.set(new Uint8Array(buffer, byteOffset, count * 4));
	return new Uint32Array(copy.buffer);
}

/** Inverse of the writer's zigzag map: 0,1,2,3 → 0,-1,1,-2. */
function unzigzag(zz: number): number {
	return (zz >>> 1) ^ -(zz & 1);
}

/**
 * Undoes the v3 delta filter on the quantized vertex stream: each component is a zigzag-mapped,
 * wrapped 16-bit difference from the previous vertex's same component (independent x/y/z running
 * sums). `(x << 16) >> 16` reproduces the writer's int16 wrapping.
 */
function decodeDeltaVertices(zigzagged: Uint16Array): Int16Array {
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

function decodeDeltaIndices16(zigzagged: Uint16Array): Uint16Array {
	const out = new Uint16Array(zigzagged.length);
	let prev = 0;
	for (let i = 0; i < zigzagged.length; i++) {
		prev = (prev + unzigzag(zigzagged[i]!)) & 0xffff;
		out[i] = prev;
	}
	return out;
}

function decodeDeltaIndices32(zigzagged: Uint32Array): Uint32Array {
	const out = new Uint32Array(zigzagged.length);
	let prev = 0;
	for (let i = 0; i < zigzagged.length; i++) {
		prev = (prev + unzigzag(zigzagged[i]!)) >>> 0;
		out[i] = prev;
	}
	return out;
}

function fail(message: string, context: Record<string, unknown>): RhinoComputeError {
	return new RhinoComputeError(message, ErrorCodes.VALIDATION_ERROR, { context });
}
