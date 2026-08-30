import { VisualizationError, ErrorCodes } from '../../shared/index.js';

import {
	BINARY_MESH_MAGIC,
	BINARY_MESH_VERSION,
	FLAG_DELTA_ENCODED,
	FLAG_FLOAT32,
	FLAG_HAS_UVS,
	FLAG_HAS_VERTEX_COLORS,
	FLAG_PLANAR_BYTESPLIT,
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
	decodePlanarIndices16,
	decodePlanarIndices32,
	decodePlanarVertices,
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
import { isSlvmContainer, parseSlvmContainer } from './binary/slvm.js';

import type { BinaryMeshMetadata, ParsedBinaryMeshBatch } from './binary/header.js';

// Re-exported so consumers keep importing from `binary-parser` rather than reaching into `binary/`.
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
	FLAG_PLANAR_BYTESPLIT,
	UV_FORMAT_UINT16,
	UV_FORMAT_FLOAT32
} from './binary/header.js';
export type { BinaryMeshMetadata, ParsedBinaryMeshBatch } from './binary/header.js';

// ============================================================================
// PARSER
// ============================================================================

/**
 * Parses a binary mesh batch blob in the SLVA wire format. The field layout and every flag bit are
 * specified in `binary/header.ts`, next to the constants this reads.
 *
 * Returns absolute values: quantized vertices stay int16 (dequantize with `origin + (q + 32767) *
 * scale`, which is what Three.js `BufferAttribute(arr, 3, true)` expects when the per-mesh
 * transform encodes origin and scale), but the delta filter and planar byte-split are both undone
 * here — consumers never see either.
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
	} else if (raw.planarByteSplit) {
		vertices = decodePlanarVertices(raw.vertexData as Uint8Array, raw.vertexCount);
	} else if (raw.deltaEncoded) {
		vertices = decodeDeltaVertices(raw.vertexData as Uint16Array);
	} else {
		vertices = raw.vertexData as Int16Array;
	}

	let indices: Uint16Array | Uint32Array;
	if (raw.planarByteSplit) {
		const planes = raw.indexData as Uint8Array;
		indices = raw.uint16Indices
			? decodePlanarIndices16(planes, planes.length / 2)
			: decodePlanarIndices32(planes, planes.length / 4);
	} else if (raw.deltaEncoded) {
		indices =
			raw.indexData instanceof Uint16Array
				? decodeDeltaIndices16(raw.indexData)
				: decodeDeltaIndices32(raw.indexData as Uint32Array);
	} else {
		indices = raw.indexData as Uint16Array | Uint32Array;
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
 * small). For consumers handing the heavy decoding to a worker (`mesh-assembly.ts`); everyone else
 * wants {@link parseBinaryMeshBatch}, which returns reconstructed absolute values.
 */
export interface RawBinaryMeshBatch {
	metadata: BinaryMeshMetadata;
	flags: number;
	/**
	 * Wire vertex components: byte planes (Uint8) when `planarByteSplit`, zigzag deltas (Uint16)
	 * when `deltaEncoded` and not float32.
	 */
	vertexData: Uint8Array | Uint16Array | Int16Array | Float32Array;
	/**
	 * Wire indices: byte planes (Uint8) when `planarByteSplit`, else zigzag deltas when
	 * `deltaEncoded`. NOT validated against vertexCount.
	 */
	indexData: Uint8Array | Uint16Array | Uint32Array;
	isFloat32: boolean;
	deltaEncoded: boolean;
	/** v4 byte-plane layout on the delta-filtered streams — see FLAG_PLANAR_BYTESPLIT. */
	planarByteSplit: boolean;
	/** Width of the wire indices (needed since planar `indexData` is a bare byte stream). */
	uint16Indices: boolean;
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

	const rawInput = toUint8Array(input);

	// An SLVM v3 container nests a bare SLVA/SLVZ blob as its GEOM chunk and carries the object
	// table/materials as binary chunks — unwrap, decode the inner blob through the path below,
	// and overlay the container's metadata (the inner blob's own metadata is empty).
	if (isSlvmContainer(rawInput)) {
		const container = parseSlvmContainer(rawInput);
		const raw = parseBinaryMeshBatchRaw(container.geometryBlob);
		raw.metadata = container.metadata;
		return raw;
	}

	const bytes = maybeDecompress(rawInput);
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
		// A blob nested inside an SLVM container carries no metadata of its own (metadataLen = 0);
		// the container's TABL/MATL/EXTN chunks supply it after this parse returns.
		metadata =
			metadataLen === 0
				? ({} as BinaryMeshMetadata)
				: (JSON.parse(decodeUtf8(metadataBytes)) as BinaryMeshMetadata);
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
	const planarByteSplit = (flags & FLAG_PLANAR_BYTESPLIT) !== 0;
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

	// Typed-array views need alignment to the element size. The header lays out the geometry block
	// so the vertex byte offset is always 4-aligned (preamble 12 + metadataLen + 4 + 48 + 4) —
	// satisfies both float32 (4-byte) and int16 (2-byte). A zero-copy view is only valid if
	// `bytes.byteOffset + offset` respects that alignment in the underlying buffer, which a wrapper
	// Uint8Array could violate; the readers fall back to a copy when it does.
	const absoluteOffset = bytes.byteOffset + offset;
	let vertexData: Uint8Array | Uint16Array | Int16Array | Float32Array;
	if (useFloat32) {
		vertexData = readFloat32Vertices(bytes.buffer, absoluteOffset, componentCount);
	} else if (planarByteSplit) {
		// v4 byte planes — no alignment requirement, view the bytes directly.
		vertexData = bytes.subarray(offset, offset + verticesByteLength);
	} else if (deltaEncoded) {
		// Raw zigzag deltas — parseBinaryMeshBatch (or the assembly worker) prefix-sums them later.
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

	const indexData = planarByteSplit
		? bytes.subarray(offset, offset + indicesByteLength)
		: useUint16Indices
			? readUint16Array(bytes.buffer, bytes.byteOffset + offset, indexCount)
			: readUint32Array(bytes.buffer, bytes.byteOffset + offset, indexCount);
	offset += indicesByteLength;

	// Optional trailing chunks: UV first, then colors. Pre-chunk-writer blobs simply end here —
	// each read is gated by its flag, so nothing is consumed when a chunk is absent.
	let uvs: Float32Array | null = null;
	if ((flags & FLAG_HAS_UVS) !== 0) {
		const parsed = parseUvChunk(bytes, view, offset, vertexCount, deltaEncoded, planarByteSplit);
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
		planarByteSplit,
		uint16Indices: useUint16Indices,
		vertexCount,
		origin: [originX, originY, originZ],
		scale: [scaleX, scaleY, scaleZ],
		uvs,
		colors
	};
}
