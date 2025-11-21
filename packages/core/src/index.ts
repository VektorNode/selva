/**
 * Main entry point for rhino-compute-core
 * @module rhino-compute-core
 */

// ============================================================================
// PRIMARY EXPORTS (Recommended way to use the library)
// ============================================================================

/**
 * Client for interacting with Rhino Compute and Grasshopper Compute.
 * Provides methods to evaluate Grasshopper definitions and manage sessions.
 */
export { ComputeServerStats } from './core';
export { GrasshopperResponseProcessor, GrasshopperClient } from './grasshopper';

// ============================================================================
// FEATURE EXPORTS (Direct access to specific functionality)
// ============================================================================

// Re-export all features for convenience
export * from './grasshopper';
export * from './features/visualization/threejs';
export * from './features/visualization/webdisplay';
export * from './features/file-handling';
export * from './core';
