/**
 * `render/` — the CAD viewer toolkit: a configured THREE scene (camera, lighting, environment,
 * controls, render loop) plus the overlays that make it read as CAD (edges, grid, nav gizmo,
 * labels, measurement, AO).
 *
 * Depends downward on `shared/` only. It never imports `parse/`: hosts that both parse and render
 * wire the two together (see `ThreeInitializerOptions.onMaxAnisotropy`).
 *
 * `initThree` is the entrypoint and it owns the toolkit: it builds the camera controller, grid,
 * gizmo, measure tool, render pipeline and near-plane fitter, and hands them back on
 * {@link ThreeViewer}. Those factories are therefore not exported — reach the live instances
 * through the viewer (`viewer.grid`, `viewer.measureTool`, `viewer.applyEdges`, …) and configure
 * them up front through {@link ThreeInitializerOptions}. Their handle types are exported so hosts
 * can annotate what they hold.
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

// Defined in `shared/` (every layer throws/logs) but surfaced here: `render/` is the entrypoint
// consumers import, and they need these to catch failures and route this package's logs.
export { VisualizationError, ErrorCodes } from '../shared/index.js';
export type { ErrorCode } from '../shared/index.js';

export { getLogger, setLogger, enableDebugLogging } from '../shared/index.js';
export type { Logger } from '../shared/index.js';

// The look vocabulary. Defined in `shared/` (both this layer and `parse/` need it) but re-exported
// here so a render-only consumer — the viewer's style picker being the whole point — gets it from
// the same barrel as `initThree`, without also importing the parse layer.
export { LOOKS, LOOK_PRESETS, DEFAULT_LOOK, materialAppearanceForLook } from '../shared/index.js';
export type { Look, LookPreset, MaterialAppearanceOptions } from '../shared/index.js';
