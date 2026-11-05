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

export { LOOKS } from './types.js';
export type {
	BloomOptions,
	Look,
	LookMaterialOverride,
	LookPreset,
	MaterialAppearanceOptions
} from './types.js';

export {
	LOOK_PRESETS,
	DEFAULT_LOOK,
	EMISSIVE_LIGHT,
	OWN_EMISSIVE,
	OWN_ENV_MAP_INTENSITY,
	lookEnvMapIntensity,
	lookPreset,
	materialAppearanceForLook
} from './looks.js';

export { parseColor, applyOffset, computeCombinedBoundingBox } from './geometry.js';

export {
	cachedSourceOf,
	canDisposeMaterial,
	protectMaterials,
	shareGeometry,
	unshareGeometry
} from './gpu-ownership.js';

export { publishMaxAnisotropy, observeMaxAnisotropy } from './gpu-capabilities.js';

export { GLASS, isGlass, hideGlass } from './glass.js';

export { disposeMaterial, disposeObjectTree } from './gpu-dispose.js';
export type { DisposeOptions } from './gpu-dispose.js';

export {
	getHiddenMembers,
	setHiddenMembers,
	getBaseMaterial,
	cloneForTint,
	setMemberHighlight,
	clearMemberHighlight,
	type HighlightKind,
	onMemberDrawChange
} from './merged-draw.js';
