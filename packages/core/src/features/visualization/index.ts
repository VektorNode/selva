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

export { getThreeMeshesFromComputeResponse } from './webdisplay';
export { decompressMeshData } from './webdisplay/mesh-compression';

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
  EventConfig,
} from './types';
