/**
 * `render/` — the CAD viewer toolkit: a configured THREE scene plus the overlays that make it read
 * as CAD (edges, grid, nav gizmo, labels, measurement, AO).
 *
 * Depends downward on `shared/` only; never imports `parse/` (hosts wire the two together via
 * `ThreeInitializerOptions.onMaxAnisotropy`).
 *
 * `initThree` owns the toolkit — camera controller, grid, gizmo, measure tool, render pipeline,
 * near-plane fitter — and hands the live instances back on {@link ThreeViewer}. Their factories
 * aren't exported; reach them through the viewer (`viewer.grid`, `viewer.measureTool`, …) and
 * configure via {@link ThreeInitializerOptions}. Handle types are exported so hosts can annotate.
 *
 * @module render
 */

// ============================================================================
// Scene setup
// ============================================================================

export { initThree } from './scene-setup/init-three.js';
export type { ThreeViewer } from './scene-setup/viewer.js';

// ============================================================================
// Viewer toolkit — handle types (instances come from `initThree`)
// ============================================================================

export type { CameraController, CameraProjection, ViewPreset } from './camera-controller.js';
export type { Grid } from './grid.js';
export type { ViewGizmo } from './view-gizmo.js';
export type { MeasureTool } from './measure.js';

// ============================================================================
// Scene helpers
// ============================================================================

export { updateScene } from './three-helpers.js';

// ============================================================================
// Types
// ============================================================================

export type {
	ThreeInitializerOptions,
	CameraConfig,
	ControlsConfig,
	EnvironmentConfig,
	LightingConfig,
	RenderConfig,
	FloorConfig,
	GridConfig,
	GizmoConfig,
	EdgesConfig,
	MeasureConfig,
	EventConfig
} from './types.js';

// ============================================================================
// Errors & logging
// ============================================================================

// Defined in `shared/` but surfaced here so consumers of this entrypoint can catch failures and
// route logs without also importing `shared/` directly.
export { VisualizationError, ErrorCodes } from '../shared/index.js';
export type { ErrorCode } from '../shared/index.js';

export { getLogger, setLogger, enableDebugLogging } from '../shared/index.js';
export type { Logger } from '../shared/index.js';

// Look vocabulary, defined in `shared/` (shared with `parse/`) but re-exported here so a
// render-only consumer (e.g. a style picker) doesn't need to import the parse layer.
export { LOOKS, LOOK_PRESETS, DEFAULT_LOOK, materialAppearanceForLook } from '../shared/index.js';
export type { Look, LookPreset, MaterialAppearanceOptions } from '../shared/index.js';
