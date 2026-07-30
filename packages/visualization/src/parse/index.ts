/**
 * `parse/` — backend payload → THREE meshes + metadata.
 *
 * Turns a Rhino.Compute / WebSocket response into renderable Three.js objects: mesh batches
 * (binary SLVA wire format, textures, materials) and display items (curves, points).
 *
 * Depends only on `shared/`. Never imports from `render/` or `scene/`.
 *
 * @module parse
 */

// ============================================================================
// MESH OWNERSHIP
// ============================================================================

// The clone/release rules `@selvajs/solve`'s result memo needs but deliberately doesn't know.
export { meshPolicy, cloneSceneObjects, releaseSceneObjects } from './mesh-policy.js';

// ============================================================================
// WEB DISPLAY PARSING
// ============================================================================

export {
	getThreeMeshesFromComputeResponse,
	SCALE_FACTORS
} from './webdisplay/webdisplay-parser.js';

export type {
	DisplayComputeResponse,
	DisplayResponseValue,
	DisplayDataItem
} from './webdisplay/response-envelope.js';

export {
	parseMeshBatch,
	parseMeshBatchObject,
	parseMeshBatchBlob
} from './webdisplay/batch-parser.js';

export {
	parseBinaryMeshBatch,
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
} from './webdisplay/binary-parser.js';
export type { BinaryMeshMetadata, ParsedBinaryMeshBatch } from './webdisplay/binary-parser.js';

export {
	clearTextureCache,
	setTextureAnisotropy,
	TEXTURE_CACHE_MAX_ENTRIES
} from './webdisplay/texture-cache.js';

export type {
	MeshBatchParsingOptions,
	MeshExtractionOptions,
	SerializableMaterial,
	MeshMetadata,
	MaterialGroup,
	DisplayBatch,
	/** @deprecated Use {@link DisplayBatch}. */
	MeshBatch
} from './webdisplay/types.js';

// ============================================================================
// DISPLAY ITEMS (curves, points)
// ============================================================================

export { parseDisplayItems } from './display-items/display-items-parser.js';
export type { DisplayItemParseOptions } from './display-items/display-items-parser.js';

export type {
	DisplayItem,
	DisplayCurve,
	DisplayPoint,
	DisplayItemBase,
	DisplayIdentity,
	DisplayPosition
} from './display-items/types.js';
