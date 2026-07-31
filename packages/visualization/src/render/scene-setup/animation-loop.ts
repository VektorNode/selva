import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { CameraController } from '../camera-controller.js';
import type { Grid } from '../grid.js';
import type { LabelLayer } from '../label-layer.js';
import type { NearPlaneFitter } from '../near-plane.js';
import type { RenderPipeline } from '../render-pipeline.js';
import type { ViewGizmo } from '../view-gizmo.js';

// Resize applied before render so buffer clear and draw happen in the same frame — avoids a
// visible blank frame on resize.
export function createAnimationLoop(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.PerspectiveCamera,
	getActiveCamera: () => THREE.Camera,
	cameraController: CameraController,
	controls: OrbitControls,
	getCanvasSize: () => { width: number; height: number },
	pixelRatio: number,
	onFrame?: (delta: number) => void,
	grid?: Grid | null,
	gizmo?: ViewGizmo | null,
	getRenderPipeline?: () => RenderPipeline | null,
	labelLayer?: LabelLayer | null,
	nearFitter?: NearPlaneFitter | null,
	// false = render every frame regardless of invalidate()/camera movement.
	onDemand: boolean = true
): { animate: () => void; dispose: () => void; invalidate: () => void } {
	let animationId: number | null = null;
	let lastTime = performance.now();

	// The loop always *ticks* (cheap); it only *renders* when invalidate() was called, the active
	// camera moved (matrix compare catches damping/presets/gizmo/near-plane), or the idle-repaint
	// interval elapsed as a safety net for any mutation that forgot to invalidate.
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
		// renderer.render normally refreshes matrixWorld, but we're deciding whether to call it — so
		// refresh here first (cheap: a camera has no deep subtree).
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

	// Click-driven mutations (measure points, selection highlights) don't call invalidate() themselves.
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

		// Must floor (not round) to match renderer.setSize's own flooring — otherwise the size
		// comparison below never settles and the resize branch runs every frame.
		const newW = Math.floor(width * pixelRatio);
		const newH = Math.floor(height * pixelRatio);

		if (renderer.domElement.width !== newW || renderer.domElement.height !== newH) {
			renderer.setPixelRatio(pixelRatio);
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			cameraController.updateAspect(width, height);
			getRenderPipeline?.()?.setSize(width, height, pixelRatio);
			labelLayer?.setSize(width, height); // CSS2D overlay uses CSS size, not the pixel-ratio buffer
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

		if (grid) grid.update(getActiveCamera().position); // recenter on camera so it reads as infinite
		if (gizmo) gizmo.update(delta);

		// Before render, so depth precision tracks the camera's current distance from content.
		if (nearFitter) nearFitter.update();

		onFrame?.(delta);

		const activeCamera = getActiveCamera();

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
			renderPipeline.setCamera(activeCamera); // retarget in case 2D/3D swapped
			renderPipeline.render(delta);
		} else {
			renderer.render(scene, activeCamera);
		}

		if (labelLayer) labelLayer.render(scene, activeCamera);

		// Corner-viewport overlay with its own clear; must render last to sit on top.
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
