import type { MeshBatch } from '@selva/core';
import {
  parseMeshBatchObject,
  applyOffset,
  computeCombinedBoundingBox,
  SCALE_FACTORS,
} from '@selva/core';
import type { ThreeInitializerOptions } from '@selva/core/visualization';

export interface ViewerState {
  scene: any;
  camera: any;
  controls: any;
  initialized: boolean;
}

export async function ensureRhinoComputeLoaded() {
  return await import('@selva/core');
}

export async function initializeViewerScene(
  canvas: HTMLCanvasElement,
  rhinoCompute: typeof import('@selva/core')
): Promise<ViewerState> {
  const opts: ThreeInitializerOptions = {
    environment: { backgroundColor: '#E6E6E6' },
  };

  const { scene, camera, controls } = rhinoCompute.initThree(canvas, opts);

  return {
    scene,
    camera,
    controls,
    initialized: true,
  };
}

export async function updateViewerScene(
  rhinoCompute: typeof import('@selva/core'),
  state: ViewerState,
  displayMeshes: any[]
) {
  if (!state.scene || !state.camera || !state.controls || displayMeshes.length === 0) {
    return;
  }

  rhinoCompute.updateScene(
    state.scene,
    displayMeshes,
    state.camera,
    state.controls,
    state.initialized
  );
}

export async function processMeshBatches(batches: MeshBatch[], modelUnits: string): Promise<any[]> {
  const allMeshes: any[] = [];
  const scaleFactor = SCALE_FACTORS[modelUnits] ?? 1;

  console.log(`[Viewer] Using scale factor: ${scaleFactor} (units: ${modelUnits})`);

  for (const batchData of batches) {
    const meshes = await parseMeshBatchObject(batchData, {
      mergeByMaterial: true,
      applyTransforms: true,
      scaleFactor: scaleFactor,
      debug: false,
    });
    console.log(`[Viewer] Batch parsed to ${meshes.length} mesh(es)`);
    allMeshes.push(...meshes);
  }

  return allMeshes;
}

export async function applyMeshTransforms(meshes: any[]) {
  if (meshes.length === 0) return;

  try {
    const boundingBox = computeCombinedBoundingBox(meshes);
    console.log('[Viewer] Combined bounding box:', boundingBox);

    // Normalize geometry scale to prevent z-fighting with mixed scales
    normalizeGeometryScale(meshes, boundingBox as any);

    const offsetY = boundingBox.min.y;
    if (offsetY !== 0) {
      console.log(`[Viewer] Applying ground offset: ${offsetY}`);
      applyOffset(meshes, offsetY);
    }
  } catch (err) {
    console.warn('[Viewer] Could not apply ground offset:', err);
  }
}

/**
 * Detects and normalizes geometry scales to prevent z-fighting.
 *
 * When meshes have vastly different sizes (e.g., 1 unit vs 10,000 units),
 * the GPU depth buffer loses precision. This function detects the scale range
 * and applies a uniform scale to normalize everything into a reasonable range.
 */
function normalizeGeometryScale(meshes: any[], boundingBox: any): void {
  const size = boundingBox.getSize({ x: 0, y: 0, z: 0 });
  const maxDimension = Math.max(size.x, size.y, size.z);
  const minDimension = Math.min(size.x, size.y, size.z);

  const scaleRatio = maxDimension / minDimension;
  const TARGET_RANGE = 100;

  if (scaleRatio > 100 || maxDimension > 10000) {
    const normalizationScale = TARGET_RANGE / maxDimension;
    console.log(
      `[Viewer] Normalizing geometry: scale ratio ${scaleRatio.toFixed(1)}:1, applying scale ${normalizationScale.toFixed(6)}`
    );

    for (const mesh of meshes) {
      mesh.scale.x *= normalizationScale;
      mesh.scale.y *= normalizationScale;
      mesh.scale.z *= normalizationScale;
    }
  }
}
