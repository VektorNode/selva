/**
 * `render/` — the CAD viewer toolkit: a configured THREE scene plus the overlays that make it read
 * as CAD (edges, grid, nav gizmo, labels, measurement, AO). See README for the full layer map.
 *
 * Depends downward on `shared/` only; never imports `parse/` (see README's render↔parse seam).
 *
 * `initThree` owns the toolkit and hands the live instances back on {@link ThreeViewer}; the
 * individual factories aren't exported on purpose — reach them through the viewer instance
 * (`viewer.grid`, `viewer.measureTool`, …), configured via {@link ThreeInitializerOptions}.
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

// Re-exported from `shared/` so consumers of this entrypoint don't also need to import it directly.
export { VisualizationError, ErrorCodes } from '../shared/index.js';
export type { ErrorCode } from '../shared/index.js';

export { getLogger, setLogger, enableDebugLogging } from '../shared/index.js';
export type { Logger } from '../shared/index.js';

// Look vocabulary lives in `shared/` (shared with `parse/`) but is re-exported here so a
// render-only consumer (e.g. a style picker) doesn't need the parse layer.
export { LOOKS, LOOK_PRESETS, DEFAULT_LOOK, materialAppearanceForLook } from '../shared/index.js';
export type { Look, LookPreset, MaterialAppearanceOptions } from '../shared/index.js';
