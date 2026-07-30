/**
 * `parse/` — backend payload → THREE meshes + metadata.
 *
 * Turns a Rhino.Compute / WebSocket response into renderable Three.js objects: mesh batches
 * (binary SLVA wire format, textures, materials) and display items (curves, points).
 *
 * Depends only on `shared/`. Never imports from `render/` or `scene/`.
 *
 * The SLVA binary wire format — magics, version gates, flag bits and the low-level
 * `parseBinaryMeshBatch` — is an implementation detail of `parseMeshBatch*` and is deliberately not
 * exported; it changes without a major bump.
 *
 * @module parse
 */

// ============================================================================
// MESH OWNERSHIP
// ============================================================================

// The clone/release rules `@selvajs/solve`'s result memo needs but deliberately doesn't know.
// `meshPolicy` carries both operations as `.clone` / `.release`; they are not exported separately.
export { meshPolicy } from './mesh-policy.js';

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

export { parseMeshBatchObject, parseMeshBatchBlob } from './webdisplay/batch-parser.js';

// The two halves of the render/parse seam: hosts wire these to
// `ThreeInitializerOptions.onMaxAnisotropy` / `.onReleaseCaches` so `render/` never imports this layer.
export { setTextureAnisotropy } from './webdisplay/texture-cache.js';
export { releaseParseCaches } from './release-caches.js';

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
export type { DisplayItemParseOptions } from './display-items/display-items-parser.js';

export type {
	DisplayItem,
	DisplayCurve,
	DisplayPoint,
	DisplayItemBase,
	DisplayIdentity,
	DisplayPosition
} from './display-items/types.js';
