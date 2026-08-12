/**
 * `render/` — the CAD viewer toolkit. See README for the layer map and the render↔parse seam.
 *
 * `initThree` owns the toolkit; factories aren't exported on purpose — reach live instances through
 * the viewer (`viewer.grid`, `viewer.measureTool`, …), configured via {@link ThreeInitializerOptions}.
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
export type { LabelLayer, LabelHandle } from './label-layer.js';

// ============================================================================
// Host apps — pointer tools and scene ownership
// ============================================================================

export { pointerToNdc } from './tool-registry.js';
export type { PointerTool, ToolRegistry, ToolRegistration } from './tool-registry.js';

// Picking primitives, so a host tool's grab band matches the built-in ones.
export { pickThreshold, snapToVertex } from './measure.js';

export {
	SOURCE_COMPUTE,
	SOURCE_USER,
	appSource,
	appIdFromSource,
	isHostOwned,
	isOwnedBy
} from './scene-ownership.js';

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

export { VisualizationError, ErrorCodes } from '../shared/index.js';
export type { ErrorCode } from '../shared/index.js';

export { getLogger, setLogger, enableDebugLogging } from '../shared/index.js';
export type { Logger } from '../shared/index.js';

export { LOOKS, LOOK_PRESETS, DEFAULT_LOOK, materialAppearanceForLook } from '../shared/index.js';
export type { Look, LookPreset, MaterialAppearanceOptions } from '../shared/index.js';
