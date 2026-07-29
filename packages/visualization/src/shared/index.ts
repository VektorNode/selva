/**
 * `shared/` — the bottom layer. Coordinate frame, look presets, and the object/color utilities the
 * layers above have in common. Depends on nothing else in this package.
 *
 * @module shared
 */

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
