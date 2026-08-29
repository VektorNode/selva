/**
 * Demo: the smallest real app. Deliberately does NOT use the shared playground shell — every line
 * you need is here, so you can read it top to bottom and paste it into your own project.
 *
 * The other demos wrap `initThree` in a harness to keep their control panels short. This one
 * doesn't, because the point is to show what the library actually asks of a host:
 *
 *   1. initThree(canvas, options)              — build the viewer
 *   2. getThreeObjectsFromComputeResponse(res) — turn a solve response into THREE objects
 *   3. updateScene(...)                        — put them in the scene and frame them
 *   4. viewer.dispose()                        — hand the GPU context back
 */
import {
	initThree,
	updateScene,
	type ThreeViewer,
	type ThreeInitializerOptions
} from '@/render/index.js';
import { getThreeObjectsFromComputeResponse } from '@/parse/index.js';

import responseUrl from '../shared/samples/compute-response.json?url';

// ============================================================================
// 1. BUILD THE VIEWER
// ============================================================================
// One call builds camera, lights, orbit controls, the render loop, and any overlays you switch on.
// Everything below is optional — `initThree(canvas)` alone gives you a working viewer.

const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement;

const options: ThreeInitializerOptions = {
	look: 'technical', // flat CAD shading; try 'studio' for a product shot
	grid: { enabled: true },
	edges: { enabled: true }, // crease lines on meshes
	events: {
		onObjectSelected: (object) => setStatus(`Selected: ${object.name || object.type}`),
		onBackgroundClicked: () => setStatus('Nothing selected.')
	}
};

const viewer: ThreeViewer = initThree(canvas, options);

// ============================================================================
// 2 + 3. PARSE A SOLVE RESPONSE AND SHOW IT
// ============================================================================
// `response` here is read from a bundled sample file. In a real app it's whatever your solve
// returned — see `@selvajs/solve/client` for getting one.

/**
 * False until the first load. `updateScene` uses this to decide whether to frame the model: frame it
 * the first time, then leave the user's camera alone on every later solve.
 */
let cameraPlaced = false;

async function loadAndShow() {
	setStatus('Solving…');

	type ComputeResponse = Parameters<typeof getThreeObjectsFromComputeResponse>[0];
	const response: ComputeResponse = await fetch(responseUrl).then((r) => r.json());

	// Meshes, curves and points in one flat array, with materials and colours already applied.
	const objects = await getThreeObjectsFromComputeResponse(response);

	// Clears the previous content, adds the new objects, fits the clip planes, frames the model.
	updateScene(viewer.scene, objects, viewer.camera, viewer.controls, cameraPlaced);
	cameraPlaced = true;

	// updateScene replaced the content, so anything attached to the old objects needs re-attaching.
	viewer.applyEdges(viewer.scene);
	viewer.updateGridScale();

	setStatus(`Showing ${objects.length} objects. Click one to select it.`);
}

void loadAndShow();

// ============================================================================
// 4. CLEAN UP
// ============================================================================
// `dispose` frees the WebGL context itself, not just the objects in it. Call it when the canvas
// goes away — in React an effect cleanup, in Svelte `onDestroy`.

window.addEventListener('beforeunload', () => viewer.dispose());

// ============================================================================
// PAGE WIRING — not part of the library
// ============================================================================

function setStatus(text: string) {
	const el = document.getElementById('status');
	if (el) el.textContent = text;
}

document.getElementById('reload')?.addEventListener('click', () => void loadAndShow());
document.getElementById('fit')?.addEventListener('click', () => viewer.fitToView());
