import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { computeCombinedBoundingBox, disposeObjectTree } from '../shared/index.js';
import { isoOffset } from './up-axis';

const CAMERA_CONFIG = {
	HUGE_THRESHOLD: 10000,
	LARGE_THRESHOLD: 1000,
	SCALE_RATIO_THRESHOLD: 100,
	NEAR_PLANE_FACTOR: {
		TINY: 0.0001,
		SMALL: 0.001,
		NORMAL: 0.01
	},
	FAR_PLANE_FACTOR: {
		HUGE: 100,
		LARGE: 50,
		NORMAL: 20
	},
	INITIAL_DISTANCE_MULTIPLIER: 4
};

/** Replaces scene content with `meshes`, rescales the camera frustum to fit, and (first call only) positions the camera/controls. */
export function updateScene(
	scene: THREE.Scene,
	meshes: THREE.Object3D[],
	camera: THREE.PerspectiveCamera,
	controls: OrbitControls,
	initialPositionSet: boolean
) {
	clearScene(scene);

	if (meshes.length === 0) return;

	meshes.forEach((mesh) => {
		scene.add(mesh);
	});

	const unionBoundingBox = computeCombinedBoundingBox(meshes);
	const center = unionBoundingBox.getCenter(new THREE.Vector3());
	const size = unionBoundingBox.getSize(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z);

	// Frustum is rescaled to content size every call (not just on first frame) so near/far stay
	// well-conditioned when geometry size changes drastically between solves.
	const scaleRatio = maxDim / Math.min(size.x || 1, size.y || 1, size.z || 1);

	if (scaleRatio > CAMERA_CONFIG.SCALE_RATIO_THRESHOLD || maxDim > CAMERA_CONFIG.HUGE_THRESHOLD) {
		camera.near = maxDim * CAMERA_CONFIG.NEAR_PLANE_FACTOR.TINY;
		camera.far = maxDim * CAMERA_CONFIG.FAR_PLANE_FACTOR.HUGE;
	} else if (maxDim > CAMERA_CONFIG.LARGE_THRESHOLD) {
		camera.near = maxDim * CAMERA_CONFIG.NEAR_PLANE_FACTOR.SMALL;
		camera.far = maxDim * CAMERA_CONFIG.FAR_PLANE_FACTOR.LARGE;
	} else {
		camera.near = Math.max(0.01, maxDim * CAMERA_CONFIG.NEAR_PLANE_FACTOR.NORMAL);
		camera.far = Math.max(2000, maxDim * CAMERA_CONFIG.FAR_PLANE_FACTOR.NORMAL);
	}

	camera.updateProjectionMatrix();

	// Only reposition camera and controls on first frame.
	// Zoom limits (min/maxDistance) are deliberately NOT touched here: they are owned by the
	// host via setupControls, and overwriting them per solve silently discarded user-supplied
	// configuration after the first geometry update.
	if (!initialPositionSet) {
		const distance = maxDim * CAMERA_CONFIG.INITIAL_DISTANCE_MULTIPLIER;

		// Frame from the standard 3/4 iso, derived from the camera's own up axis (initThree sets it to
		// the configured sceneUp before this ever runs) rather than a hardcoded offset — keeps the
		// first solve's angle consistent with whatever up-axis the viewer opened at.
		camera.position.copy(center).add(isoOffset(camera.up, distance));
		controls.target.copy(center);

		controls.update();
	}
}

/**
 * userData.id of objects that are viewer *aids*, not content — the grid, floor, CSS2D label layer and
 * measure markers. Excluded from every content-bounds query: the grid especially is a huge plane that
 * re-centers on the camera each frame, so including it would make fit-to-view frame the camera's
 * position instead of the geometry.
 */
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
 * Axis-aligned world bounds of the scene's renderable *content* — every visible mesh/line/points, with
 * viewer aids (grid/floor/labels/measure) excluded. The single content-bounds function: shared by
 * fit-to-view, pick-threshold scaling, camera framing (`setView`), and shadow-frustum fitting so they
 * all measure exactly the same box. Returns an empty Box3 when there is no content.
 *
 * Refreshes world matrices once up front (one traversal) so `expandByObject` reads current transforms
 * regardless of when the caller invokes this — cheaper and more correct than updating per object.
 */
export function computeContentBounds(scene: THREE.Scene): THREE.Box3 {
	scene.updateMatrixWorld(true);
	const box = new THREE.Box3();
	scene.traverse((object) => {
		const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
		if (object.visible && !isViewerAid(object) && renderable.geometry) {
			box.expandByObject(object);
		}
	});
	return box;
}

/** IDs of scene infrastructure that survives content updates (floor, grid, label layer). */
const PERSISTENT_SCENE_IDS = new Set(['floor', 'grid', 'label-layer']);

/** Removes all compute content except persistent infrastructure and shared materials. */
export function clearScene(scene: THREE.Scene): void {
	// Snapshot — removeFromParent below mutates scene.children during iteration.
	const topLevel = [...scene.children];

	topLevel.forEach((object) => {
		// Removing the label-layer group here would orphan it: the CSS2D renderer only finds labels
		// by walking the live scene, so labels added afterwards would never render.
		if (PERSISTENT_SCENE_IDS.has(object.userData.id)) return;

		// User-drawn geometry (added via the viewer's addUserGeometry, tagged source==='user')
		// persists across solves so it isn't lost when compute content is replaced.
		if (object.userData.source === 'user') return;

		// One ownership-aware walker for every teardown path (shared/gpu-dispose.ts). Edge overlays
		// are children of the meshes they outline, so this traversal disposes their line geometries
		// too — each overlay owns its own outright (see edges/line-geometry.ts).
		disposeObjectTree(object);

		object.removeFromParent();
	});
}
