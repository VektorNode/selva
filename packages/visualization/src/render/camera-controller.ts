import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { computeContentBounds } from './three-helpers';
import { buildUpBasis } from './up-axis';

/**
 * Runtime camera control: preset views, perspective⇄orthographic toggle, rotate lock.
 *
 * Centralized because projection switching swaps the camera object that OrbitControls drives, the
 * render loop renders, resize reshapes, and the raycaster picks with — {@link getActiveCamera} is
 * the one source of truth for all four call sites.
 *
 * Orthographic mirrors perspective's position/target with a frustum derived from perspective's FOV
 * and distance, so switching projections doesn't visually jump.
 */

export type ViewPreset = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

export type CameraProjection = 'perspective' | 'orthographic';

export interface CameraController {
	/** Swaps identity on {@link setProjection}. */
	getActiveCamera(): THREE.Camera;
	getProjection(): CameraProjection;
	setProjection(projection: CameraProjection): void;
	toggleProjection(): CameraProjection;
	setView(preset: ViewPreset, animate?: boolean): void;
	/**
	 * Frame current content from an explicit world-space direction (target → camera) instead of a
	 * named preset — used by the nav-cube, whose clicked axis is a world axis.
	 */
	setViewDirection(direction: THREE.Vector3, animate?: boolean): void;
	/** Frame a world-space box from the current view direction. No-op on an empty box. */
	frameBounds(box: THREE.Box3, animate?: boolean): void;
	setRotateEnabled(enabled: boolean): void;
	isRotateEnabled(): boolean;
	updateAspect(width: number, height: number): void;
	/** Cancel any in-flight camera tween. Call on viewer teardown so ticks can't touch disposed controls. */
	dispose(): void;
}

interface CameraControllerDeps {
	scene: THREE.Scene;
	perspective: THREE.PerspectiveCamera;
	controls: OrbitControls;
	onActiveCameraChange: (camera: THREE.Camera) => void;
	/** Drives presets, ortho camera up, and iso direction. Falls back to `perspective.up`. */
	up?: THREE.Vector3;
}

/**
 * Seven preset view directions (target → camera, unit vectors), derived from `up` rather than a
 * fixed Y-up table so Top/Front/… stay meaningful for Z-up Rhino scenes.
 *
 * `buildUpBasis`'s `forward` is camera→model; these are camera positions relative to target, so
 * "front" is `-forward`. Flipping this puts the camera behind the model and swaps left/right.
 */
function buildViewDirections(up: THREE.Vector3): Record<ViewPreset, THREE.Vector3> {
	const { up: u, forward, right } = buildUpBasis(up);

	// Camera positions are opposite the look direction: Rhino's Front looks along +Y from -Y.
	const frontPosition = forward.clone().negate();
	const rightPosition = right.clone();

	return {
		top: u.clone(),
		bottom: u.clone().negate(),
		front: frontPosition.clone(),
		back: frontPosition.clone().negate(),
		right: rightPosition.clone(),
		left: rightPosition.clone().negate(),
		iso: frontPosition
			.clone()
			.multiplyScalar(1.2)
			.add(rightPosition.clone())
			.add(u.clone())
			.normalize()
	};
}

export function createCameraController(deps: CameraControllerDeps): CameraController {
	const { scene, perspective, controls, onActiveCameraChange } = deps;

	const up = (deps.up ?? perspective.up).clone().normalize();
	const VIEW_DIRECTIONS = buildViewDirections(up);

	const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, perspective.near, perspective.far);
	ortho.up.copy(up);

	let projection: CameraProjection = 'perspective';
	let aspect = perspective.aspect;

	const active = (): THREE.Camera => (projection === 'perspective' ? perspective : ortho);

	// Starting a new tween cancels any prior one — two loops would otherwise fight over the camera.
	let activeTween: TweenHandle | null = null;
	const cancelTween = () => {
		activeTween?.cancel();
		activeTween = null;
	};

	// Sizes the ortho frustum to match perspective's apparent size at the current distance.
	const syncOrthoFrustum = () => {
		// Measure whichever camera is live: while ortho is active, OrbitControls moves ortho's
		// position (only its zoom changes), leaving perspective's distance stale.
		const reference = projection === 'orthographic' ? ortho : perspective;
		const distance = reference.position.distanceTo(controls.target);
		const halfH = distance * Math.tan((perspective.fov * Math.PI) / 360);
		const halfW = halfH * aspect;
		ortho.left = -halfW;
		ortho.right = halfW;
		ortho.top = halfH;
		ortho.bottom = -halfH;
		ortho.near = perspective.near;
		ortho.far = perspective.far;
		ortho.updateProjectionMatrix();
	};

	const setProjection = (next: CameraProjection) => {
		if (next === projection) return;
		// A tween mid-flight would keep lerping the OLD active camera after the swap.
		cancelTween();

		if (next === 'orthographic') {
			ortho.position.copy(perspective.position);
			ortho.up.copy(perspective.up);
			ortho.lookAt(controls.target);
			// OrbitControls dollies ortho via `zoom`, not position — reset to 1 so a leftover zoom
			// from a prior 2D session doesn't double up with the freshly-derived frustum.
			ortho.zoom = 1;
			syncOrthoFrustum();
		} else {
			// Convert ortho zoom back to perspective DISTANCE (halfH / tan(fov/2)) — copying position
			// alone would discard any zooming done in 2D.
			const halfH = (ortho.top - ortho.bottom) / (2 * ortho.zoom);
			const distance = halfH / Math.tan((perspective.fov * Math.PI) / 360);
			const direction = ortho.position.clone().sub(controls.target);
			if (direction.lengthSq() < 1e-12) direction.copy(up);
			direction.normalize();
			perspective.position.copy(controls.target).add(direction.multiplyScalar(distance));
		}

		projection = next;
		controls.object = active();
		controls.update();
		onActiveCameraChange(active());
	};

	// Positions the active camera along `direction` at the distance fitting `maxDim`, retargeting
	// controls at `center`. Ortho zoom resets and the frustum re-derives via syncOrthoFrustum —
	// position alone wouldn't change an orthographic view's apparent size.
	const frame = (
		center: THREE.Vector3,
		maxDim: number,
		direction: THREE.Vector3,
		animate: boolean
	) => {
		const fov = perspective.fov * (Math.PI / 180);
		const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

		const dir = nudgeOffPole(direction, up);
		const toPosition = center.clone().add(dir.clone().multiplyScalar(distance));

		const cam = active();
		// Reset zoom before re-deriving the frustum, else it multiplies in and defeats the fit.
		if (projection === 'orthographic') ortho.zoom = 1;

		cancelTween();
		if (animate) {
			activeTween = animateMove(cam, controls, toPosition, center, () => {
				if (projection === 'orthographic') syncOrthoFrustum();
			});
		} else {
			cam.position.copy(toPosition);
			controls.target.copy(center);
			if (projection === 'orthographic') syncOrthoFrustum();
			controls.update();
		}
	};

	const setViewDirection = (direction: THREE.Vector3, animate = true) => {
		const box = computeContentBounds(scene);
		const center = box.isEmpty() ? controls.target.clone() : box.getCenter(new THREE.Vector3());
		const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		frame(center, maxDim, direction, animate);
	};

	const frameBounds = (box: THREE.Box3, animate = true) => {
		if (box.isEmpty()) return;
		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		// Keep the user's current viewing direction; only the distance/target change.
		const direction = active().position.clone().sub(controls.target);
		if (direction.lengthSq() < 1e-12) direction.copy(VIEW_DIRECTIONS.iso);
		frame(center, maxDim, direction.normalize(), animate);
	};

	const setView = (preset: ViewPreset, animate = true) => {
		setViewDirection(VIEW_DIRECTIONS[preset], animate);
	};

	const setRotateEnabled = (enabled: boolean) => {
		controls.enableRotate = enabled;
	};

	const updateAspect = (width: number, height: number) => {
		aspect = height === 0 ? aspect : width / height;
		if (projection === 'orthographic') syncOrthoFrustum();
	};

	return {
		getActiveCamera: active,
		getProjection: () => projection,
		setProjection,
		toggleProjection: () => {
			setProjection(projection === 'perspective' ? 'orthographic' : 'perspective');
			return projection;
		},
		setView,
		setViewDirection,
		frameBounds,
		setRotateEnabled,
		isRotateEnabled: () => controls.enableRotate,
		updateAspect,
		dispose: cancelTween
	};
}

/**
 * Nudges a top/bottom view direction a ~0.5° tilt off the up axis; other presets pass through
 * unchanged. Looking exactly down `up` is an OrbitControls singularity: camera direction coincides
 * with `camera.up`, azimuth is undefined, and the first drag snaps the view.
 *
 * At the pole, `camera.up` can't define roll, so the tilt direction does instead. Both poles lean
 * toward `-forward` to reproduce Rhino's convention (Top has +forward at screen-top; Bottom mirrors
 * about the horizontal axis, matching Rhino where the far side reads backwards too) — leaning the
 * poles opposite ways also mirrors correctly, but rolled 180° from Rhino.
 */
function nudgeOffPole(dir: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
	const { up: u, forward } = buildUpBasis(up);
	const d = dir.clone().normalize();
	if (Math.abs(d.dot(u)) < 0.9999) return dir;

	const inPlane = forward.clone().negate();

	const tilt = (0.5 * Math.PI) / 180;
	return d
		.multiplyScalar(Math.cos(tilt))
		.add(inPlane.multiplyScalar(Math.sin(tilt)))
		.normalize();
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Handle to a running camera tween, so callers can stop it (new move, projection swap, teardown). */
interface TweenHandle {
	cancel(): void;
}

/** Tweens camera position + controls target; returns a cancel handle for teardown/preemption. */
function animateMove(
	camera: THREE.Camera,
	controls: OrbitControls,
	toPosition: THREE.Vector3,
	toTarget: THREE.Vector3,
	onTick: () => void,
	durationMs = 250
): TweenHandle {
	const fromPosition = camera.position.clone();
	const fromTarget = controls.target.clone();
	const startTime = performance.now();
	let rafId: number | null = null;

	const tick = () => {
		rafId = null;
		const t = easeOut(Math.min((performance.now() - startTime) / durationMs, 1));
		camera.position.lerpVectors(fromPosition, toPosition, t);
		controls.target.lerpVectors(fromTarget, toTarget, t);
		onTick();
		controls.update();
		if (t < 1) rafId = requestAnimationFrame(tick);
	};

	rafId = requestAnimationFrame(tick);

	return {
		cancel: () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
		}
	};
}
