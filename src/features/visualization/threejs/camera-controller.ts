import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { computeCombinedBoundingBox } from './three-helpers';

/**
 * Runtime camera control for the viewer: preset views (top/front/…), a true 2D/3D toggle
 * (orthographic ⇄ perspective), and a rotate lock.
 *
 * Why a controller and not just loose methods: all three features have to agree on *which* camera
 * is active. Switching projection swaps the camera object OrbitControls drives, the animation loop
 * renders, the resize handler reshapes, and the raycaster picks with. Centralizing that here keeps
 * those four call sites reading one source of truth ({@link getActiveCamera}) instead of each
 * branching on a `mode` flag.
 *
 * The perspective camera stays the primary (it's what {@link updateScene} and existing consumers
 * size). The orthographic camera shadows it: same position/target, frustum derived from the
 * perspective FOV + current distance so the 3D→2D switch doesn't visually jump.
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
	 * Frame current content viewed from `direction` (a world-space vector from target toward camera).
	 * Like {@link setView} but takes an explicit direction — used by the nav-cube, whose clicked axis
	 * is a world axis, not a named preset. Pole directions are nudged off-axis to avoid the orbit
	 * singularity.
	 */
	setViewDirection(direction: THREE.Vector3, animate?: boolean): void;
	/**
	 * Frame an arbitrary world-space box (e.g. a double-clicked object) from the current view
	 * direction, moving the *active* camera — in 2D mode that means resizing the ortho frustum, not
	 * just translating. No-op on an empty box.
	 */
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
	/** Called whenever the active camera identity changes, so callers can re-point the renderer/raycaster. */
	onActiveCameraChange: (camera: THREE.Camera) => void;
	/**
	 * The scene's up axis. Presets, the orthographic camera's up, and the iso direction are all derived
	 * from this so the controller is correct in any up convention (Three's native Y-up, Rhino's Z-up, …)
	 * without hardcoding an axis. Defaults to Y-up.
	 */
	up?: THREE.Vector3;
}

/**
 * Build the seven preset view directions (from target toward camera, unit vectors) for a given up
 * axis. "Top" looks straight down the up axis; front/back/left/right are the two axes orthogonal to
 * up, with "front" chosen as the more conventional facing for that up convention; iso is a 3/4 blend.
 *
 * Deriving these from `up` (instead of a fixed Y-up table) is what keeps Top/Front/… meaningful for
 * Z-up Rhino scenes — otherwise "Top" would frame the side of the model.
 */
function buildViewDirections(up: THREE.Vector3): Record<ViewPreset, THREE.Vector3> {
	const u = up.clone().normalize();

	// Two axes spanning the ground plane (orthogonal to up). `forward` is the camera-facing "front"
	// direction, `right` completes a right-handed basis with up.
	const worldZ = new THREE.Vector3(0, 0, 1);
	const worldY = new THREE.Vector3(0, 1, 0);
	// Pick a seed not parallel to up to derive an in-plane axis from.
	const seed = Math.abs(u.dot(worldZ)) > 0.9 ? worldY : worldZ;
	const right = new THREE.Vector3().crossVectors(u, seed).normalize();
	const forward = new THREE.Vector3().crossVectors(right, u).normalize();

	return {
		top: u.clone(),
		bottom: u.clone().negate(),
		front: forward.clone(),
		back: forward.clone().negate(),
		right: right.clone(),
		left: right.clone().negate(),
		// 3/4 iso: blend front, right, and up so it reads as a corner view regardless of up axis.
		iso: forward.clone().multiplyScalar(1.2).add(right.clone()).add(u.clone()).normalize()
	};
}

export function createCameraController(deps: CameraControllerDeps): CameraController {
	const { scene, perspective, controls, onActiveCameraChange } = deps;

	// Up axis drives presets, the ortho camera's up, and the iso direction. Prefer an explicit `up`,
	// fall back to the perspective camera's current up (which initThree sets to sceneUp).
	const up = (deps.up ?? perspective.up).clone().normalize();
	const VIEW_DIRECTIONS = buildViewDirections(up);

	const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, perspective.near, perspective.far);
	ortho.up.copy(up);

	let projection: CameraProjection = 'perspective';
	let aspect = perspective.aspect;

	const active = (): THREE.Camera => (projection === 'perspective' ? perspective : ortho);

	// The one in-flight camera tween, if any. Starting a new tween cancels the previous one (two
	// concurrent loops would fight, each lerping from its own snapshot), and dispose() cancels it so
	// no tick can touch disposed controls after teardown.
	let activeTween: TweenHandle | null = null;
	const cancelTween = () => {
		activeTween?.cancel();
		activeTween = null;
	};

	// Sizes the ortho frustum so its on-screen content matches the perspective view at the current
	// distance — the apparent height of the perspective view at the target plane is
	// 2 * distance * tan(fov/2). Half-height drives top/bottom; aspect drives left/right.
	const syncOrthoFrustum = () => {
		// While ortho is active, the ORTHO camera is the one presets/fit move (OrbitControls only
		// changes its zoom); the perspective camera's distance is stale until the next 3D switch.
		// Measure whichever camera is live so presets and resizes in 2D size the frustum correctly.
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
			// OrbitControls dollies an ortho camera via `zoom`, not position — start each 2D session
			// at 1 so the freshly-derived frustum isn't still multiplied by zoom left over from a
			// previous 2D session (which showed as a zoom jump on every 2D→3D→2D round-trip).
			ortho.zoom = 1;
			syncOrthoFrustum();
		} else {
			// Carry the ortho dolly back as perspective DISTANCE so the switch preserves apparent
			// size: the ortho view shows a half-height of top/zoom at the target plane, and the
			// perspective camera shows the same at distance = halfH / tan(fov/2). Copying position
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

	// Shared framing move: position the ACTIVE camera along `direction` at the distance that fits
	// `maxDim`, retargeting controls at `center`. In ortho mode the dolly zoom is reset and the
	// frustum re-derived (per tick while animating) — moving position alone wouldn't change the
	// apparent size of an orthographic view.
	const frame = (
		center: THREE.Vector3,
		maxDim: number,
		direction: THREE.Vector3,
		animate: boolean
	) => {
		// Distance to fit the content for the perspective camera; ortho reuses it via syncOrthoFrustum.
		const fov = perspective.fov * (Math.PI / 180);
		const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

		// A direction along the up axis (top/bottom) puts the view direction parallel to camera.up — an
		// OrbitControls singularity (the next mouse drag flips the view 180° and the gizmo jitters).
		// Tilt it a hair off-axis so the orbit basis stays well-defined.
		const dir = nudgeOffPole(direction, up);
		const toPosition = center.clone().add(dir.clone().multiplyScalar(distance));

		const cam = active();
		// Framing means fitting: a leftover ortho dolly (OrbitControls zooms ortho via `zoom`) would
		// keep multiplying the freshly-derived frustum and defeat the fit.
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
		const box = computeContentBox(scene);
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

/** userData.id of objects that are viewer aids, not content — excluded from view framing. */
const VIEWER_AID_IDS = new Set(['grid', 'floor', 'label-layer', 'measure']);

/** True if the object or any ancestor is a viewer aid (grid/floor/labels/measure markers). */
function isViewerAid(object: THREE.Object3D): boolean {
	let current: THREE.Object3D | null = object;
	while (current) {
		if (typeof current.userData.id === 'string' && VIEWER_AID_IDS.has(current.userData.id)) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

/**
 * Bounding box of renderable scene content. Excludes viewer aids — crucially the grid, a huge plane
 * that re-centers on the camera every frame; including it would make `setView` frame the grid (i.e.
 * wherever the camera is) instead of the actual content, so a preset view wouldn't recenter.
 */
function computeContentBox(scene: THREE.Scene): THREE.Box3 {
	const renderables: THREE.Object3D[] = [];
	scene.traverse((object) => {
		const r = object as Partial<THREE.Mesh> & THREE.Object3D;
		if (object.visible && !isViewerAid(object) && r.geometry) {
			renderables.push(object);
		}
	});
	return computeCombinedBoundingBox(renderables);
}

/**
 * If a view direction is (nearly) parallel to the up axis — i.e. top/bottom — tilt it a fraction of
 * a degree toward an in-plane axis. Looking exactly down `up` is an OrbitControls singularity: the
 * camera direction coincides with `camera.up`, so azimuth is undefined and the first drag snaps the
 * view. A ~0.5° tilt is imperceptible but keeps the orbit basis well-defined. Non-pole presets pass
 * through unchanged.
 */
function nudgeOffPole(dir: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
	const u = up.clone().normalize();
	const d = dir.clone().normalize();
	if (Math.abs(d.dot(u)) < 0.9999) return dir;

	// Derive an in-plane axis (orthogonal to up) to lean toward, same construction as the presets.
	const seed =
		Math.abs(u.dot(new THREE.Vector3(0, 0, 1))) > 0.9
			? new THREE.Vector3(0, 1, 0)
			: new THREE.Vector3(0, 0, 1);
	const inPlane = new THREE.Vector3().crossVectors(u, seed).normalize();
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

/**
 * Tween camera position + controls target. Returns a cancel handle: the controller cancels the
 * previous tween before starting a new one (two loops would fight over the camera) and on
 * dispose() so no tick touches disposed controls after teardown.
 */
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
