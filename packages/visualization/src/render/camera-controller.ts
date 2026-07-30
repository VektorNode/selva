import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { computeContentBounds } from './three-helpers';
import { buildUpBasis } from './up-axis';

/**
 * Runtime camera control: preset views, perspective⇄orthographic toggle, rotate lock.
 *
 * Centralized (not loose methods) because projection switching swaps the camera object that
 * OrbitControls drives, the render loop renders, resize reshapes, and the raycaster picks with —
 * {@link getActiveCamera} is the one source of truth for all four call sites.
 *
 * Perspective is primary; orthographic shadows it (same position/target, frustum derived from
 * perspective FOV + distance) so switching doesn't visually jump.
 */

/** The six axis-aligned presets plus the default 3/4 iso. Named in Three's Y-up frame. */
export type ViewPreset = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

export type CameraProjection = 'perspective' | 'orthographic';

export interface CameraController {
	/** The camera currently being rendered/picked with. Swaps identity on {@link setProjection}. */
	getActiveCamera(): THREE.Camera;
	/** Current projection mode. */
	getProjection(): CameraProjection;
	/** Switch between perspective (3D) and orthographic (2D). No-op if already in that mode. */
	setProjection(projection: CameraProjection): void;
	/** Convenience toggle for a 2D/3D button. */
	toggleProjection(): CameraProjection;
	/** Move the camera to a preset orientation, framing current scene content. Animated. */
	setView(preset: ViewPreset, animate?: boolean): void;
	/**
	 * Frame current content from an explicit world-space direction (target → camera) instead of a
	 * named preset — used by the nav-cube, whose clicked axis is a world axis. Poles are nudged
	 * off-axis to avoid the orbit singularity.
	 */
	setViewDirection(direction: THREE.Vector3, animate?: boolean): void;
	/** Frame a world-space box from the current view direction. No-op on an empty box. */
	frameBounds(box: THREE.Box3, animate?: boolean): void;
	/** Enable/disable orbit rotation at runtime (pan/zoom unaffected). */
	setRotateEnabled(enabled: boolean): void;
	/** Whether rotation is currently enabled. */
	isRotateEnabled(): boolean;
	/** Keep the orthographic frustum aspect in sync on canvas resize. Called by the resize loop. */
	updateAspect(width: number, height: number): void;
	/** Cancel any in-flight camera tween. Call on viewer teardown so ticks can't touch disposed controls. */
	dispose(): void;
}

interface CameraControllerDeps {
	scene: THREE.Scene;
	perspective: THREE.PerspectiveCamera;
	controls: OrbitControls;
	/** Fires when the active camera identity changes, so callers can re-point renderer/raycaster. */
	onActiveCameraChange: (camera: THREE.Camera) => void;
	/**
	 * Scene up axis — drives presets, ortho camera up, and iso direction, so the controller works
	 * for any up convention (Three's Y-up, Rhino's Z-up, …). Falls back to `perspective.up`.
	 */
	up?: THREE.Vector3;
}

/**
 * Seven preset view directions (target → camera, unit vectors), derived from `up` rather than a
 * fixed Y-up table so Top/Front/… stay meaningful for Z-up Rhino scenes.
 *
 * Sign flip vs {@link buildUpBasis}: its `forward` is the LOOK direction (camera → model), but these
 * are camera POSITIONS relative to target, so "front" is `-forward`. Getting this backwards puts
 * the camera behind the model and swaps left/right.
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
		// 3/4 iso: blend front, right, and up so it reads as a corner view regardless of up axis.
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

	// Starting a new tween cancels any prior one (two loops would fight); dispose() also cancels so
	// no tick touches disposed controls after teardown.
	let activeTween: TweenHandle | null = null;
	const cancelTween = () => {
		activeTween?.cancel();
		activeTween = null;
	};

	// Sizes the ortho frustum to match the perspective view's apparent size at the current distance
	// (apparent height at the target plane = 2 * distance * tan(fov/2)).
	const syncOrthoFrustum = () => {
		// Measure whichever camera is live: while ortho is active it's the one presets/fit move
		// (OrbitControls only changes its zoom), so perspective's distance is stale until the next
		// 3D switch.
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

		// Carry position/target across so the switch doesn't jump.
		if (next === 'orthographic') {
			ortho.position.copy(perspective.position);
			ortho.up.copy(perspective.up);
			ortho.lookAt(controls.target);
			// OrbitControls dollies ortho via `zoom`, not position — reset to 1 so a leftover zoom
			// from a prior 2D session doesn't double up with the freshly-derived frustum.
			ortho.zoom = 1;
			syncOrthoFrustum();
		} else {
			// Convert ortho zoom back to perspective DISTANCE (halfH / tan(fov/2)) to preserve
			// apparent size — copying position alone would discard any zooming done in 2D.
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

	// Positions the ACTIVE camera along `direction` at the distance fitting `maxDim`, retargeting
	// controls at `center`. In ortho mode, zoom resets and the frustum re-derives — position alone
	// wouldn't change an orthographic view's apparent size.
	const frame = (
		center: THREE.Vector3,
		maxDim: number,
		direction: THREE.Vector3,
		animate: boolean
	) => {
		// Distance to fit the content for the perspective camera; ortho reuses it via syncOrthoFrustum.
		const fov = perspective.fov * (Math.PI / 180);
		const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

		// A direction along the up axis is an OrbitControls singularity (parallel to camera.up —
		// next drag flips the view 180°); nudge off-axis to keep the orbit basis well-defined.
		const dir = nudgeOffPole(direction, up);
		const toPosition = center.clone().add(dir.clone().multiplyScalar(distance));

		const cam = active();
		// Reset ortho zoom first — otherwise it multiplies the freshly-derived frustum and defeats the fit.
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
 * unchanged. Looking exactly down `up` is an OrbitControls singularity (camera direction coincides
 * with `camera.up`, azimuth undefined, first drag snaps the view).
 *
 * At the pole, `camera.up` can't define roll — the tilt direction does instead. Both poles lean
 * toward `-forward` to reproduce Rhino's convention: Top has +forward at screen-top; Bottom mirrors
 * about the horizontal axis (correct — you're viewing the far side, so geometry text reads backwards
 * there in Rhino too). Leaning the poles opposite ways also mirrors, but rolled 180° from Rhino's
 * convention — looked wrong for that reason.
 */
function nudgeOffPole(dir: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
	const { up: u, forward } = buildUpBasis(up);
	const d = dir.clone().normalize();
	if (Math.abs(d.dot(u)) < 0.9999) return dir;

	// Same lean for both poles so Bottom flips about the horizontal axis, not the vertical.
	const inPlane = forward.clone().negate();

	const tilt = (0.5 * Math.PI) / 180; // ~0.5°
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
