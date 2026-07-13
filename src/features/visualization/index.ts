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
export { addEdges, removeEdges, isEdgeOverlay, EDGE_USERDATA_KIND } from './threejs/edges.js';
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

// ============================================================================
// WEB DISPLAY PARSING
// ============================================================================

export {
	getThreeMeshesFromComputeResponse,
	SCALE_FACTORS
} from './webdisplay/webdisplay-parser.js';
export {
	parseMeshBatch,
	parseMeshBatchObject,
	parseMeshBatchBlob
} from './webdisplay/batch-parser.js';
export {
	parseBinaryMeshBatch,
	BINARY_MESH_MAGIC,
	COMPRESSED_MESH_MAGIC,
	BINARY_MESH_VERSION,
	MIN_SUPPORTED_VERSION,
	FLAG_FLOAT32,
	FLAG_UINT16_INDICES,
	FLAG_DELTA_ENCODED,
	FLAG_HAS_UVS,
	FLAG_HAS_VERTEX_COLORS,
	UV_FORMAT_UINT16,
	UV_FORMAT_FLOAT32
} from './webdisplay/binary-parser.js';
export type { BinaryMeshMetadata, ParsedBinaryMeshBatch } from './webdisplay/binary-parser.js';
export {
	clearTextureCache,
	setTextureAnisotropy,
	TEXTURE_CACHE_MAX_ENTRIES
} from './webdisplay/texture-cache.js';

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
	EventConfig
} from './types.js';

export type {
	MeshBatchParsingOptions,
	MaterialAppearanceOptions,
	MeshExtractionOptions,
	SerializableMaterial,
	MeshMetadata,
	MaterialGroup,
	DisplayBatch,
	/** @deprecated Use {@link DisplayBatch}. */
	MeshBatch
} from './webdisplay/types.js';

export type {
	DisplayItem,
	DisplayCurve,
	DisplayPoint,
	DisplayItemBase,
	DisplayIdentity,
	DisplayPosition
} from './display-items/types.js';

export { parseDisplayItems } from './display-items/display-items-parser.js';
export type { DisplayItemParseOptions } from './display-items/display-items-parser.js';
