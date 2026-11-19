// Loaded by `captureSolve` in a headless browser, never by an MCP client: it draws one
// Rhino.Compute response and hands back a PNG through `window.selvaCapture`.

import {
	getThreeObjectsFromComputeResponse,
	setTextureAnisotropy
} from '@selvajs/visualization/parse';
import {
	initThree,
	LOOKS,
	updateScene,
	type Look,
	type ViewPreset
} from '@selvajs/visualization/render';

export interface CaptureRequest {
	response: unknown;
	view: ViewPreset;
	grid: boolean;
	look?: string;
	background?: string;
	/** An HDR environment's URL; `data:` works. Without one the viewer generates its lighting. */
	hdr?: string;
}

export interface CaptureResult {
	/** Base64 PNG, no `data:` prefix; empty when nothing was drawn. */
	png: string;
	drawn: number;
}

declare global {
	interface Window {
		selvaCapture(request: CaptureRequest): Promise<CaptureResult>;
	}
}

const ENVIRONMENT_WAIT_MS = 10_000;

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

// One capture per page: the look and environment are fixed when the viewer is made.
window.selvaCapture = async ({ response, view, grid, look, background, hdr }) => {
	const canvas = document.createElement('canvas');
	canvas.style.cssText = 'display:block;width:100%;height:100%';
	document.getElementById('stage')!.append(canvas);

	let ready!: () => void;
	const environment = new Promise<void>((resolve) => (ready = resolve));
	const viewer = initThree(canvas, {
		// A saved schema can name a look this build lacks, and an unknown look throws.
		look: LOOKS.includes(look as Look) ? (look as Look) : 'technical',
		onMaxAnisotropy: setTextureAnisotropy,
		environment: { hdrPath: hdr ?? false, ...(background && { backgroundColor: background }) },
		events: { enableEventHandlers: false, onReady: () => ready() }
	});

	await Promise.race([environment, new Promise((r) => setTimeout(r, ENVIRONMENT_WAIT_MS))]);
	const objects = await getThreeObjectsFromComputeResponse(response as never, {
		parsing: { material: viewer.getMaterialAppearance() }
	});
	updateScene(viewer.scene, objects, viewer.camera, viewer.controls, false);
	if (!objects.length) return { png: '', drawn: 0 };
	viewer.grid?.setVisible(grid);
	viewer.updateGridScale();
	viewer.updateShadowBounds();
	viewer.syncEmissiveLights();
	viewer.cameraController.setView(view, false);
	// Edges attach off-thread for large meshes; two frames let them land.
	await frame();
	await frame();
	const blob = await viewer.captureImage('image/png');
	if (!blob) return { png: '', drawn: objects.length };
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return { png: btoa(binary), drawn: objects.length };
};
