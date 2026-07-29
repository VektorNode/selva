/**
 * Visualization utilities for @selvajs/compute
 *
 * Provides Three.js integration and web display mesh parsing.
 *
 * @module visualization
 */

// ============================================================================
// THREE.JS VISUALIZATION
// ============================================================================

export { initThree, materialAppearanceForLook } from './threejs/three-initializer.js';
export { LOOKS } from './types.js';
export { createCameraController } from './threejs/camera-controller.js';
export type {
	CameraController,
	CameraProjection,
	ViewPreset
} from './threejs/camera-controller.js';
export { createGrid } from './threejs/grid.js';
export type { Grid, GridOptions } from './threejs/grid.js';
export { createViewGizmo } from './threejs/view-gizmo.js';
export type { ViewGizmo } from './threejs/view-gizmo.js';
export {
	addEdges,
	addEdgesAsync,
	removeEdges,
	isEdgeOverlay,
	EDGE_USERDATA_KIND,
	EDGES_SKIPPED_TRIANGLE_CAP
} from './threejs/edges.js';
export type { EdgeOptions } from './threejs/edges.js';
export { createRenderPipeline } from './threejs/render-pipeline.js';
export type { RenderPipeline, RenderPipelineOptions } from './threejs/render-pipeline.js';
export { createLabelLayer } from './threejs/label-layer.js';
export type { LabelLayer, LabelHandle } from './threejs/label-layer.js';
export { createMeasureTool, snapToVertex } from './threejs/measure.js';
export type { MeasureTool, MeasureOptions } from './threejs/measure.js';
export {
	updateScene,
	parseColor,
	applyOffset,
	computeCombinedBoundingBox
} from './threejs/three-helpers.js';
export * as Materials from './threejs/three-materials.js';
// The scene-up basis every orientation default derives from. Exported so hosts that configure a
// non-default `sceneUp` can resolve the matching ground axis for `applyOffset`/`groundAxis`.
export {
	buildUpBasis,
	environmentRotationFor,
	isoOffset,
	sunOffset,
	upToAxis
} from './threejs/up-axis.js';
export type { UpBasis } from './threejs/up-axis.js';

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type {
	ThreeInitializerOptions,
	CameraConfig,
	LightingConfig,
	EnvironmentConfig,
	FloorConfig,
	RenderConfig,
	Look,
	LookPreset,
	ControlsConfig,
	GridConfig,
	GizmoConfig,
	EdgesConfig,
	MeasureConfig,
	EventConfig,
	MaterialAppearanceOptions
} from './types.js';

// NOTE: payload parsing (mesh batches, display items, texture cache) moved to
// `@selvajs/visualization` — see that package's `parse/` layer.
