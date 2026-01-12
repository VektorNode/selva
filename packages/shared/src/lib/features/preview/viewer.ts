import type { UISchema } from '$lib/types/generated';
import type { MeshBatch } from '@selva/core/visualization';
import {
	parseMeshBatchObject,
	SCALE_FACTORS,
	initThree,
	updateScene
} from '@selva/core/visualization';
import type { ThreeInitializerOptions } from '@selva/core/visualization';

export interface ViewerState {
	scene: unknown | null;
	camera: unknown | null;
	controls: unknown | null;
	initialized?: boolean;
}

export async function ensureRhinoComputeLoaded() {
	return await import('@selva/core');
}

export async function initializeViewerScene(
	canvas: HTMLCanvasElement,
	rhinoCompute: typeof import('@selva/core'),
	schema: UISchema
): Promise<ViewerState> {
	const opts: ThreeInitializerOptions = {
		environment: { backgroundColor: schema.viewerOptions?.backgroundColor || '#ffffff' }
	};

	const { scene, camera, controls } = initThree(canvas, opts);

	return {
		scene,
		camera,
		controls
	};
}

export async function updateViewerScene(
	rhinoCompute: typeof import('@selva/core'),
	state: ViewerState,
	displayMeshes: any[]
): Promise<void> {
	if (!state.scene || !state.camera || !state.controls || displayMeshes.length === 0) {
		return;
	}

	updateScene(
		state.scene as any,
		displayMeshes,
		state.camera as any,
		state.controls as any,
		state.initialized ?? false
	);
}

export async function processMeshBatches(batches: MeshBatch[], modelUnits: string): Promise<any[]> {
	const allMeshes: any[] = [];
	const scaleFactor = SCALE_FACTORS[modelUnits] ?? 1;

	for (const batchData of batches) {
		const meshes = await parseMeshBatchObject(batchData, {
			mergeByMaterial: true,
			applyTransforms: true,
			scaleFactor: scaleFactor,
			debug: false
		});
		allMeshes.push(...meshes);
	}

	return allMeshes;
}
