/**
 * `parse/`: backend payload → THREE meshes + metadata. Depends only on `shared/`; never imports
 * from `render/` or `scene/`.
 *
 * The SLVA binary wire format (magics, version gates, flag bits, `parseBinaryMeshBatch`) is an
 * implementation detail of `parseMeshBatch*` and stays unexported so it can change without a major bump.
 */

// ============================================================================
// MESH OWNERSHIP
// ============================================================================

export { meshPolicy } from './mesh-policy.js';

// ============================================================================
// WEB DISPLAY PARSING
// ============================================================================

export {
	getThreeObjectsFromComputeResponse,
	SCALE_FACTORS
} from './webdisplay/webdisplay-parser.js';

export { parseMeshBatchObject, parseMeshBatchBlob } from './webdisplay/batch-parser.js';

// apply-texture.ts self-subscribes via shared's observeMaxAnisotropy: render/ never imports this layer.
export { setTextureAnisotropy } from './webdisplay/apply-texture.js';

export type {
	MeshBatchParsingOptions,
	MeshExtractionOptions,
	SerializableMaterial,
	MeshMetadata,
	MaterialGroup,
	DisplayBatch
} from './webdisplay/types.js';

// ============================================================================
// DISPLAY ITEMS (curves, points)
// ============================================================================

export { parseDisplayItems } from './display-items/display-items-parser.js';

export type {
	DisplayItem,
	DisplayCurve,
	DisplayPoint,
	DisplayItemBase,
	DisplayIdentity,
	DisplayPosition
} from './display-items/types.js';
