import * as THREE from 'three';

import { applyOffset, computeCombinedBoundingBox } from '../threejs';

import { parseMeshBatch } from './batch-parser';

import type { DataItem, GrasshopperComputeResponse } from '@/features/grasshopper/types';

// Constants
const SCALE_FACTORS: Record<string, number> = {
  Millimeters: 1 / 1000,
  Centimeters: 1 / 100,
  Meters: 1,
  Inches: 1 / 39.37,
  Feet: 1 / 3.28084,
};

/**
 * The component type string used to identify display meshes from Grasshopper WebDisplay.
 */
const DISPLAY_COMPONENT_TYPE = 'Display';

/**
 * Parses batched mesh data from the new optimized format.
 * This format uses material deduplication and batched compression for better performance.
 *
 * @param batchJson - JSON string containing batched mesh data
 * @param debug - If true, logs processing time to the console
 * @param options - Parsing options
 * @returns Array of THREE.Mesh objects
 */
export function getThreeMeshesFromBatch(
  batchJson: string,
  debug = false,
  options?: {
    /** Merge meshes with same material into single geometry (better for many small meshes) */
    mergeByMaterial?: boolean;
    /** Apply scaling based on unit type */
    allowScaling?: boolean;
    /** Apply auto-positioning to ground plane */
    allowAutoPosition?: boolean;
  }
): THREE.Mesh[] {
  const startTime = performance.now();
  const { mergeByMaterial = true, allowScaling = true, allowAutoPosition = true } = options ?? {};

  try {
    // Parse the batch (scaling is handled separately if needed)
    const meshes = parseMeshBatch(batchJson, {
      mergeByMaterial,
      applyTransforms: true, // Always apply coordinate transform
    });

    // Apply scaling if needed (uniform scale on all meshes)
    if (allowScaling) {
      // Note: We'd need unit info passed separately, or embed it in the batch
      // For now, assume scaling is handled in Grasshopper or passed separately
    }

    // Apply ground offset if needed
    if (allowAutoPosition) {
      applyGroundOffset(meshes);
    }

    return meshes;
  } catch (error) {
    console.error('Error parsing batched mesh data:', error);
    handleError(error, []);
    throw error;
  } finally {
    if (debug) {
      logProcessingTime(startTime);
    }
  }
}

/**
 * Extracts and processes display meshes from a ComputePointerResponse using the Grasshopper WebDisplay component.
 *
 * This function is an alternative to the standard "context bake" output of Hops/Grasshopper.
 * It is specifically designed to work with the WebDisplay component from the Compuceraptor Grasshopper plugin,
 * enabling performant mesh visualization in Three.js applications.
 *
 * Rhino Compute must be modified as already implemented in https://github.com/TheVessen/compute.rhino3d".
 *
 * THREE.Mesh instances using processBranch, and combines all meshes. It then computes a vertical offset
 * from the combined bounding box so the collection sits on the Z=0 plane.
 *
 * @param data - The ComputePointerResponse containing Grasshopper output trees.
 * @param debug - If true, logs processing time to the console.
 * @returns Array of THREE.Mesh objects (may be empty).
 * @throws Rethrows unexpected errors after attempting to dispose any created meshes.
 *
 * @remarks
 * - Only works with the WebDisplay component of GHHeadless.
 * - Requires changes to Rhino.Compute (see the fork above).
 * - Provides a performant way to display mesh data in Three.js.
 */
export function getThreeMeshesFromComputeResponse(
  data: GrasshopperComputeResponse,
  debug = false,
  options?: {
    allowScaling?: boolean;
    allowAutoPosition?: boolean;
  }
): THREE.Mesh[] {
  const startTime = performance.now();
  const meshes: THREE.Mesh[] = [];

  // Provide default values for options
  const { allowScaling = true, allowAutoPosition = true } = options ?? {};

  try {
    const scaleFactor = allowScaling ? getScaleFactor(data.modelunits) : 1;
    extractMeshesFromData(data, meshes, scaleFactor);
    if (allowAutoPosition) {
      applyGroundOffset(meshes);
    }

    return meshes;
  } catch (error) {
    handleError(error, meshes);
    throw error;
  } finally {
    if (debug) {
      logProcessingTime(startTime);
    }
  }
}

/**
 * Gets the scale factor for the given unit type.
 */
function getScaleFactor(modelUnits: string): number {
  return SCALE_FACTORS[modelUnits] ?? 1;
}

/**
 * Extracts meshes from compute response data.
 */
function extractMeshesFromData(
  data: GrasshopperComputeResponse,
  meshes: THREE.Mesh[],
  scaleFactor: number
): void {
  for (const value of data.values) {
    const innerTree = value.InnerTree as { [key: string]: DataItem[] };

    for (const path in innerTree) {
      const branch = innerTree[path];
      if (!branch) continue;

      processDataBranch(branch, meshes, scaleFactor);
    }
  }
}

/**
 * Processes a single data branch to extract MeshBatch display meshes.
 */
function processDataBranch(branch: DataItem[], meshes: THREE.Mesh[], scaleFactor: number): void {
  for (const item of branch) {
    if (item.type.includes(DISPLAY_COMPONENT_TYPE)) {
      // Parse MeshBatch format
      const batchMeshes = parseMeshBatch(item.data, {
        mergeByMaterial: true,
        applyTransforms: true,
      });

      // Apply scaling if needed
      if (scaleFactor !== 1) {
        for (const mesh of batchMeshes) {
          mesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
        }
      }

      meshes.push(...batchMeshes);
    }
  }
}

/**
 * Applies vertical offset to position meshes on the Z=0 plane.
 */
function applyGroundOffset(meshes: THREE.Mesh[]): void {
  if (meshes.length === 0) return;

  const combinedBoundingBox = computeCombinedBoundingBox(meshes);
  const offsetY = combinedBoundingBox.min.y;
  applyOffset(meshes, offsetY);
}

/**
 * Handles errors by disposing created meshes and logging.
 */
function handleError(error: unknown, meshes: THREE.Mesh[]): void {
  console.error('An unexpected error occurred:', error);
  disposeMeshes(meshes);
}

/**
 * Disposes of all meshes and their associated resources.
 */
function disposeMeshes(meshes: THREE.Mesh[]): void {
  for (const mesh of meshes) {
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  }
}

/**
 * Logs the processing time for mesh extraction.
 */
function logProcessingTime(startTime: number): void {
  const elapsed = performance.now() - startTime;
  console.info('Time to process meshes:', `${elapsed.toFixed(2)}ms`);
}
