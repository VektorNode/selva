import type { MaterialGroup, SerializableMaterial } from '../types.js';

// ============================================================================
// WIRE FORMAT CONSTANTS
// ============================================================================

/** "SLVA" little-endian — an uncompressed mesh blob. */
export const BINARY_MESH_MAGIC = 0x41564c53;
/**
 * "SLVZ" little-endian — an optional raw-DEFLATE container around a SLVA blob (applied by the
 * plugin when it shrinks the payload). Layout: `[4] magic=SLVZ | [4] uncompressedLen(u32) |
 * [N] raw-deflate stream of the SLVA blob`.
 */
export const COMPRESSED_MESH_MAGIC = 0x5a564c53;
/**
 * Current writer version. v2 added FLAG_UINT16_INDICES; v3 added FLAG_DELTA_ENCODED.
 */
export const BINARY_MESH_VERSION = 3;
/**
 * Oldest wire version this parser still decodes. Each version only added a flag bit, so the
 * flag-driven read path handles every older blob unchanged — needed since persisted/cached blobs
 * (saved `.gh` files, DMF files, cached compute results) must stay decodable after upgrade.
 */
export const MIN_SUPPORTED_VERSION = 1;
/** Bit 0 of the geometry flags word: 0 = int16 quantized, 1 = float32 raw. */
export const FLAG_FLOAT32 = 0x1;
/** Bit 1 of the geometry flags word: 0 = uint32 indices, 1 = uint16 indices. */
export const FLAG_UINT16_INDICES = 0x2;
/**
 * Bit 2 of the geometry flags word: int16 vertex components and indices are stored as wrapped
 * per-component deltas from their predecessor, zigzag-mapped to unsigned (float32 vertices are
 * never filtered). Deltas of welded meshes concentrate near zero, so the SLVZ DEFLATE pass
 * compresses far better. Decoding reverses the filter with a running prefix sum.
 */
export const FLAG_DELTA_ENCODED = 0x4;
/**
 * Bit 3: a UV chunk trails the index block. Layout: `uvFormat(u32: 0=uint16 quantized, 1=float32)
 * | uvOrigin(2×f64) | uvScale(2×f64) | data`, element count implied by vertexCount. Quantized UVs
 * reconstruct as `uv = origin + q * scale` (q unsigned in [0, 65535]), delta+zigzag filtered per
 * component (independent u/v predictors) iff FLAG_DELTA_ENCODED; float32 UVs are never filtered.
 * Absent flag = absent chunk, so untextured blobs are byte-identical to pre-chunk writers.
 */
export const FLAG_HAS_UVS = 0x8;
/**
 * Bit 4: a vertex-color chunk trails the index block (after the UV chunk when both present).
 * Layout: `uint8 rgb[vertexCount*3]`, delta+zigzag filtered per channel (wrapped 8-bit, independent
 * r/g/b predictors) iff FLAG_DELTA_ENCODED.
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
 * Header fields use explicit-LE `DataView` reads, but the zero-copy geometry readers build
 * typed-array views in *host* byte order (every mainstream JS target is little-endian, and
 * per-element DataView reads would be far costlier on the hot geometry paths). This check makes
 * the assumption explicit: on a big-endian host the parser refuses to decode rather than return
 * byte-swapped garbage.
 */
export const HOST_IS_LITTLE_ENDIAN = new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

// ============================================================================
// PARSED TYPES
// ============================================================================

/** Mesh-blob subset of `DisplayBatch` minus `compressedData` (circular — the blob can't embed itself). */
export interface BinaryMeshMetadata {
	materials: SerializableMaterial[];
	groups: MaterialGroup[];
	sourceComponentId?: string;
}

/**
 * Result of parsing a binary mesh blob.
 *
 * `vertices`/`indices` hold absolute (unfiltered) values. For pre-v3 blobs they're zero-copy
 * typed-array views over the original `ArrayBuffer` — don't mutate the buffer, or call `.slice()`
 * to detach. Delta-encoded blobs (FLAG_DELTA_ENCODED) decode into freshly allocated arrays instead.
 *
 * `uvs`/`colors` are the optional trailing chunks (FLAG_HAS_UVS / FLAG_HAS_VERTEX_COLORS), null
 * when absent. UVs are dequantized to absolute Float32 (u,v per vertex) — ready for
 * `BufferAttribute(uvs, 2)`. Colors are raw r,g,b bytes per vertex, for a normalized
 * `BufferAttribute(colors, 3, true)`.
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
