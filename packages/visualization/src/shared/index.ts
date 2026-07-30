/**
 * `shared/` — the bottom layer. Errors, logging, base64 decoding, coordinate frame, look presets,
 * and the object/color utilities the layers above have in common. Depends on nothing else in this
 * package, and on nothing outside it but `three`.
 *
 * @module shared
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

export {
	parseColor,
	applyOffset,
	computeCombinedBoundingBox,
	CACHED_GEOMETRY_USERDATA_FLAG
} from './geometry.js';
