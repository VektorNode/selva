/**
 * `tool/`: draws and edits curves and points in a `@selvajs/visualization` viewer. Needs `three`.
 *
 * `createSketchTool` is the whole tool. `createCurveLayer` (what is shown) and
 * `createPointPicker` (where a click lands) are the two halves it is built from, for a host that
 * writes its own.
 *
 * @module tool
 */

export { createSketchTool, DRAW_MODES } from './sketch-tool.js';
export type {
	DrawMode,
	DrawModeSpec,
	SketchSettings,
	SketchState,
	SketchTool,
	SketchToolOptions
} from './sketch-tool.js';

export { createCurveLayer } from './curve-layer.js';
export type { CurveLayer, CurveLayerOptions, LayerLabel } from './curve-layer.js';

export { createPointPicker } from './point-picker.js';
export type { PickOptions, PickedPoint, PointPicker, PointPickerOptions } from './point-picker.js';

export { constrainPoint, formatLength, parseTypedInput } from './constraints.js';
export type { ConstrainOptions, TypedInput } from './constraints.js';
