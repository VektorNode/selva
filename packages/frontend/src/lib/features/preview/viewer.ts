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
    environment: { backgroundColor: '#4b5357' },
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

export async function processMeshBatches(
  batches: MeshBatch[],
  modelUnits: string
): Promise<any[]> {
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
    const offsetY = boundingBox.min.y;
    if (offsetY !== 0) {
      console.log(`[Viewer] Applying ground offset: ${offsetY}`);
      applyOffset(meshes, offsetY);
    }
  } catch (err) {
    console.warn('[Viewer] Could not apply ground offset:', err);
  }
}
