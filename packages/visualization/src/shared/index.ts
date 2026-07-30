/**
 * `shared/` — the bottom layer. Depends on nothing else in this package, and on nothing outside it
 * but `three`.
 *
 * **Internal.** This barrel is the cross-layer import surface for `parse/`, `render/` and `scene/`;
 * it is not a published entrypoint. Parts consumers need are re-exported from `render/`.
 */

export { VisualizationError, ErrorCodes } from './errors.js';
export type { ErrorCode } from './errors.js';

export { getLogger, setLogger, enableDebugLogging } from './logger.js';
export type { Logger } from './logger.js';

export { decodeBase64ToBinary } from './encoding.js';

export { rhinoToThree } from './coordinate-frame.js';
export type { Vec3 } from './coordinate-frame.js';

export { LOOKS } from './types.js';
export type { Look, LookPreset, MaterialAppearanceOptions } from './types.js';

export { LOOK_PRESETS, DEFAULT_LOOK, materialAppearanceForLook } from './looks.js';

export { parseColor, applyOffset, computeCombinedBoundingBox } from './geometry.js';

export {
	CACHED_GEOMETRY_USERDATA_FLAG,
	CACHED_TEXTURE_USERDATA_FLAG,
	canDisposeGeometry,
	canDisposeMaterial,
	canDisposeTexture,
	isProtectedMaterial,
	protectMaterials,
	registerCacheRelease,
	releaseAllCaches,
	retainCaches
} from './gpu-ownership.js';

export { publishMaxAnisotropy, observeMaxAnisotropy } from './gpu-capabilities.js';

export { disposeMaterial, disposeObjectTree } from './gpu-dispose.js';
export type { DisposeOptions } from './gpu-dispose.js';
