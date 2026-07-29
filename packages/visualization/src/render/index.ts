/**
 * `render/` — the CAD viewer toolkit: a configured THREE scene (camera, lighting, environment,
 * controls, render loop) plus the overlays that make it read as CAD (edges, grid, nav gizmo,
 * labels, measurement, AO).
 *
 * Depends downward on `shared/` only. It never imports `parse/`: hosts that both parse and render
 * wire the two together (see `ThreeInitializerOptions.onMaxAnisotropy`).
 *
 * @module render
 */

// ============================================================================
// Scene setup
// ============================================================================

export { initThree } from './scene-setup/init-three.js';
export type { ThreeViewer } from './scene-setup/viewer.js';
export { applyDefaults } from './scene-setup/defaults.js';
export type { ResolvedOptions } from './scene-setup/defaults.js';
export { disposeMaterialWithTextures } from './scene-setup/dispose.js';

// ============================================================================
// Viewer toolkit
// ============================================================================

export { createCameraController } from './camera-controller.js';
export type { CameraController, CameraProjection, ViewPreset } from './camera-controller.js';

export { createGrid } from './grid.js';
export type { Grid, GridOptions } from './grid.js';

export { createViewGizmo } from './view-gizmo.js';
export type { ViewGizmo } from './view-gizmo.js';

export {
	addEdges,
	addEdgesAsync,
	removeEdges,
	isEdgeOverlay,
	EDGE_USERDATA_KIND,
	EDGES_SKIPPED_TRIANGLE_CAP
} from './edges.js';
export type { EdgeOptions } from './edges.js';

export { createRenderPipeline } from './render-pipeline.js';
export type { RenderPipeline, RenderPipelineOptions } from './render-pipeline.js';

export { EdgeDetectionPass } from './edge-detection-pass.js';
export type { EdgeDetectionOptions } from './edge-detection-pass.js';

export { createLabelLayer } from './label-layer.js';
export type { LabelLayer, LabelHandle } from './label-layer.js';

export { createMeasureTool, snapToVertex } from './measure.js';
export type { MeasureTool, MeasureOptions } from './measure.js';

export { createNearPlaneFitter } from './near-plane.js';
export type { NearPlaneFitter } from './near-plane.js';

// ============================================================================
// Scene helpers & materials
// ============================================================================

export { updateScene, clearScene, computeContentBounds } from './three-helpers.js';
export * as Materials from './three-materials.js';

// The scene-up basis every orientation default derives from. Exported so hosts that configure a
// non-default `sceneUp` can resolve the matching ground axis for `applyOffset`/`groundAxis`.
export { buildUpBasis, environmentRotationFor, isoOffset, sunOffset, upToAxis } from './up-axis.js';
export type { UpBasis } from './up-axis.js';

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

// The look vocabulary. Defined in `shared/` (both this layer and `parse/` need it) but re-exported
// here so a render-only consumer — the viewer's style picker being the whole point — gets it from
// the same barrel as `initThree`, without also importing the parse layer.
export { LOOKS, LOOK_PRESETS, DEFAULT_LOOK, materialAppearanceForLook } from '../shared/index.js';
export type { Look, LookPreset, MaterialAppearanceOptions } from '../shared/index.js';
