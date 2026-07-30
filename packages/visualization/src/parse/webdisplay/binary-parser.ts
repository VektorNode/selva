import { VisualizationError, ErrorCodes } from '../../shared/index.js';

import {
	BINARY_MESH_MAGIC,
	BINARY_MESH_VERSION,
	FLAG_DELTA_ENCODED,
	FLAG_FLOAT32,
	FLAG_HAS_UVS,
	FLAG_HAS_VERTEX_COLORS,
	FLAG_UINT16_INDICES,
	GEOMETRY_HEADER_BYTES,
	HEADER_PREAMBLE_BYTES,
	HOST_IS_LITTLE_ENDIAN,
	MIN_SUPPORTED_VERSION
} from './binary/header.js';
import {
	decodeDeltaIndices16,
	decodeDeltaIndices32,
	decodeDeltaVertices,
	decodeUtf8,
	fail,
	maybeDecompress,
	readFloat32Vertices,
	readInt16Vertices,
	readUint16Array,
	readUint32Array,
	toUint8Array,
	validateIndicesInRange
} from './binary/geometry.js';
import { parseColorChunk, parseUvChunk } from './binary/textures.js';

import type { BinaryMeshMetadata, ParsedBinaryMeshBatch } from './binary/header.js';

// The wire-format constants and parsed-payload types are the module's public vocabulary; re-exported
// so consumers keep importing them from `binary-parser` rather than reaching into `binary/`.
export {
	BINARY_MESH_MAGIC,
	COMPRESSED_MESH_MAGIC,
	BINARY_MESH_VERSION,
	MIN_SUPPORTED_VERSION,
	FLAG_FLOAT32,
	FLAG_UINT16_INDICES,
	FLAG_DELTA_ENCODED,
	FLAG_HAS_UVS,
	FLAG_HAS_VERTEX_COLORS,
	UV_FORMAT_UINT16,
	UV_FORMAT_FLOAT32
} from './binary/header.js';
export type { BinaryMeshMetadata, ParsedBinaryMeshBatch } from './binary/header.js';

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
 *   base64-encoded string (JSON-envelope transport).
 * @throws {VisualizationError} On invalid magic, unknown version, or truncated input.
 */
export function parseBinaryMeshBatch(
	input: ArrayBuffer | Uint8Array | string
): ParsedBinaryMeshBatch {
	const raw = parseBinaryMeshBatchRaw(input);

	let vertices: Int16Array | Float32Array;
	if (raw.isFloat32) {
		vertices = raw.vertexData as Float32Array;
	} else if (raw.deltaEncoded) {
		vertices = decodeDeltaVertices(raw.vertexData as Uint16Array);
	} else {
		vertices = raw.vertexData as Int16Array;
	}

	let indices = raw.indexData;
	if (raw.deltaEncoded) {
		indices =
			indices instanceof Uint16Array
				? decodeDeltaIndices16(indices)
				: decodeDeltaIndices32(indices);
	}
	validateIndicesInRange(indices, raw.vertexCount);

	return {
		metadata: raw.metadata,
		flags: raw.flags,
		vertices,
		indices,
		origin: raw.origin,
		scale: raw.scale,
		uvs: raw.uvs,
		colors: raw.colors
	};
}

/**
 * Raw wire-value view of a blob: geometry arrays are exactly as stored — zigzag-mapped deltas when
 * the blob carries the delta filter — while metadata, UVs, and colors are fully decoded (they're
 * small). For consumers that hand the heavy decoding to a worker (`mesh-assembly.ts`); everyone
 * else wants {@link parseBinaryMeshBatch}, which returns reconstructed absolute values.
 */
export interface RawBinaryMeshBatch {
	metadata: BinaryMeshMetadata;
	flags: number;
	/** Wire vertex components: zigzag deltas (Uint16) when `deltaEncoded` and not float32. */
	vertexData: Uint16Array | Int16Array | Float32Array;
	/** Wire indices: zigzag deltas when `deltaEncoded`. NOT validated against vertexCount. */
	indexData: Uint16Array | Uint32Array;
	isFloat32: boolean;
	deltaEncoded: boolean;
	vertexCount: number;
	origin: [number, number, number];
	scale: [number, number, number];
	uvs: Float32Array | null;
	colors: Uint8Array | null;
}

/** See {@link RawBinaryMeshBatch}. Same validation/throw behavior as the decoding parser. */
export function parseBinaryMeshBatchRaw(
	input: ArrayBuffer | Uint8Array | string
): RawBinaryMeshBatch {
	if (!HOST_IS_LITTLE_ENDIAN) {
		throw new VisualizationError(
			'SLVA parsing requires a little-endian host: the zero-copy geometry readers view the wire bytes in host byte order.',
			ErrorCodes.ENVIRONMENT_ERROR
		);
	}

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
	let vertexData: Uint16Array | Int16Array | Float32Array;
	if (useFloat32) {
		vertexData = readFloat32Vertices(bytes.buffer, absoluteOffset, componentCount);
	} else if (deltaEncoded) {
		// Left as raw zigzag deltas — parseBinaryMeshBatch (or the assembly worker) prefix-sums them.
		vertexData = readUint16Array(bytes.buffer, absoluteOffset, componentCount);
	} else {
		vertexData = readInt16Vertices(bytes.buffer, absoluteOffset, componentCount);
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

	const indexData = useUint16Indices
		? readUint16Array(bytes.buffer, bytes.byteOffset + offset, indexCount)
		: readUint32Array(bytes.buffer, bytes.byteOffset + offset, indexCount);
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
		vertexData,
		indexData,
		isFloat32: useFloat32,
		deltaEncoded,
		vertexCount,
		origin: [originX, originY, originZ],
		scale: [scaleX, scaleY, scaleZ],
		uvs,
		colors
	};
}
