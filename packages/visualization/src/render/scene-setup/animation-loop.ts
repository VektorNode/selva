import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { CameraController } from '../camera-controller.js';
import type { Grid } from '../grid.js';
import type { LabelLayer } from '../label-layer.js';
import type { NearPlaneFitter } from '../near-plane.js';
import type { RenderPipeline } from '../render-pipeline.js';
import type { ViewGizmo } from '../view-gizmo.js';

// Resize applied before render so buffer clear and draw happen in the same frame,
// preventing visible blank frames when the canvas is resized
export function createAnimationLoop(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.PerspectiveCamera,
	getActiveCamera: () => THREE.Camera,
	cameraController: CameraController,
	controls: OrbitControls,
	getCanvasSize: () => { width: number; height: number },
	// The resolved config.render.pixelRatio — the single source of truth for DPR (see initThree).
	pixelRatio: number,
	onFrame?: (delta: number) => void,
	grid?: Grid | null,
	gizmo?: ViewGizmo | null,
	getRenderPipeline?: () => RenderPipeline | null,
	labelLayer?: LabelLayer | null,
	nearFitter?: NearPlaneFitter | null,
	// On-demand rendering (audit P4): render only when something changed. False = legacy every-frame.
	onDemand: boolean = true
): { animate: () => void; dispose: () => void; invalidate: () => void } {
	let animationId: number | null = null;
	let lastTime = performance.now();

	// The loop always *ticks* (updates are cheap); it only *renders* when: invalidate() was called
	// (scene content, style toggles, async edge attach), the active camera moved — a matrix compare
	// catches every driver: damping, presets, gizmo snaps, near-plane refits — or the safety repaint
	// interval elapsed, which bounds the staleness of any mutation that forgot to invalidate.
	let renderRequested = true; // first frame always renders
	let lastRenderTime = 0;
	const IDLE_REPAINT_INTERVAL_MS = 500;
	const lastWorldMatrix = new THREE.Matrix4();
	const lastProjectionMatrix = new THREE.Matrix4();
	let lastCamera: THREE.Camera | null = null;
	const invalidate = () => {
		renderRequested = true;
	};

	const cameraMoved = (activeCamera: THREE.Camera): boolean => {
		// matrixWorld is normally refreshed by renderer.render — which we're deciding whether to
		// call — so refresh it here first (cheap: a camera has no deep subtree).
		activeCamera.updateMatrixWorld();
		const moved =
			lastCamera !== activeCamera ||
			!lastWorldMatrix.equals(activeCamera.matrixWorld) ||
			!lastProjectionMatrix.equals(activeCamera.projectionMatrix);
		if (moved) {
			lastCamera = activeCamera;
			lastWorldMatrix.copy(activeCamera.matrixWorld);
			lastProjectionMatrix.copy(activeCamera.projectionMatrix);
		}
		return moved;
	};

	// Pointer/wheel activity is a catch-all for click-driven scene mutations (measure points,
	// selection highlights) whose code paths predate on-demand rendering.
	const canvas = renderer.domElement;
	const pointerEvents = ['pointerdown', 'pointerup', 'wheel'] as const;
	if (onDemand) {
		for (const type of pointerEvents) {
			canvas.addEventListener(type, invalidate, { passive: true });
		}
	}

	const checkResize = () => {
		const { width, height } = getCanvasSize();
		if (width === 0 || height === 0) return;

		// Must floor, not round: renderer.setSize floors the buffer size, and a mismatched rounding
		// here makes the comparison never settle — the resize branch would then run every frame.
		const newW = Math.floor(width * pixelRatio);
		const newH = Math.floor(height * pixelRatio);

		if (renderer.domElement.width !== newW || renderer.domElement.height !== newH) {
			renderer.setPixelRatio(pixelRatio);
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			// Reshape the orthographic frustum too, if it's the active projection.
			cameraController.updateAspect(width, height);
			// Keep the AO composer's render targets in step with the canvas.
			getRenderPipeline?.()?.setSize(width, height, pixelRatio);
			// CSS2D overlay matches the canvas's CSS size (not the pixel-ratio buffer size).
			labelLayer?.setSize(width, height);
			invalidate();
		}
	};

	const animate = function () {
		animationId = requestAnimationFrame(animate);

		const now = performance.now();
		const delta = (now - lastTime) / 1000;
		lastTime = now;

		checkResize();

		if (controls.enableDamping || controls.autoRotate) {
			controls.update();
		}

		// Keep the grid centered on the camera so it reads as infinite.
		if (grid) grid.update(getActiveCamera().position);

		// Advance the gizmo's fade/spin animation (no-op when idle).
		if (gizmo) gizmo.update(delta);

		// Refit the perspective near plane to the camera↔content gap (after controls moved the
		// camera, before anything renders) so depth precision tracks the viewing distance.
		if (nearFitter) nearFitter.update();

		onFrame?.(delta);

		const activeCamera = getActiveCamera();

		// On-demand gate: skip the draw (the expensive part, especially with the AO composer) when
		// nothing changed. Ticking continues regardless, so damping/tweens re-trigger via the camera
		// compare on their next movement.
		if (onDemand) {
			const shouldRender =
				renderRequested ||
				cameraMoved(activeCamera) ||
				now - lastRenderTime >= IDLE_REPAINT_INTERVAL_MS;
			if (!shouldRender) return;
			renderRequested = false;
			lastRenderTime = now;
		}

		const renderPipeline = getRenderPipeline?.();
		if (renderPipeline) {
			// AO path: composer owns the render. Retarget to the active camera in case 2D/3D swapped.
			renderPipeline.setCamera(activeCamera);
			renderPipeline.render(delta);
		} else {
			renderer.render(scene, activeCamera);
		}

		// HTML labels follow their 3D anchors — render the DOM overlay against the active camera.
		if (labelLayer) labelLayer.render(scene, activeCamera);

		// The gizmo draws as an overlay in a corner viewport with its own clear; render it last so it
		// sits on top of the scene.
		if (gizmo) gizmo.render(renderer);
	};

	const dispose = () => {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
		if (onDemand) {
			for (const type of pointerEvents) {
				canvas.removeEventListener(type, invalidate);
			}
		}
	};

	return { animate, dispose, invalidate };
}
