/**
 * Visualization utilities for rhino-compute-core
 *
 * Provides Three.js integration and web display mesh parsing.
 *
 * @module visualization
 */

// ============================================================================
// THREE.JS VISUALIZATION
// ============================================================================

export { initThree, updateScene, Materials } from './threejs';

// ============================================================================
// WEB DISPLAY PARSING
// ============================================================================

// High-level API
export { getThreeMeshesFromComputeResponse, SCALE_FACTORS } from './webdisplay';

// Low-level APIs for advanced use cases
export { parseMeshBatch, parseMeshBatchObject } from './webdisplay/batch-parser';
export { decompressMeshData, decompressBatchedMeshData } from './webdisplay/mesh-compression';

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
	ControlsConfig,
	EventConfig
} from './types';

export type {
	MeshBatchParsingOptions,
	MeshExtractionOptions,
	SerializableMaterial,
	MeshMetadata,
	MaterialGroup,
	MeshBatch,
	DecompressedMeshData
} from './webdisplay/types';
