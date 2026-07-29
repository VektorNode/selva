import type { MaterialGroup, SerializableMaterial } from '../types.js';

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

export const HEADER_PREAMBLE_BYTES = 4 /* magic */ + 4 /* version */ + 4; /* metadataLen */
export const GEOMETRY_HEADER_BYTES =
	4 /* flags */ + 24 /* origin (3 x f64) */ + 24 /* scale (3 x f64) */ + 4; /* vertexCount */

/**
 * The SLVA wire format is little-endian. Header fields use explicit-LE `DataView` reads, but the
 * zero-copy geometry readers below construct typed-array views in *host* byte order — a deliberate
 * trade: rewriting the hot geometry paths onto per-element DataView reads would cost far more than
 * it buys, since every mainstream JS target (x86, ARM, WASM) is little-endian. This one-time check
 * makes the assumption explicit: on a big-endian host the parser refuses to decode rather than
 * silently returning byte-swapped garbage.
 */
export const HOST_IS_LITTLE_ENDIAN = new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

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
