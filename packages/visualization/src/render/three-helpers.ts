import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { computeCombinedBoundingBox, disposeObjectTree } from '../shared/index.js';
import { isHostOwned } from './scene-ownership.js';
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

	// Rescaled every call, not just the first, so near/far stay well-conditioned when geometry
	// size changes drastically between solves.
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

	// Camera/controls are repositioned on first frame only. Zoom limits (min/maxDistance) are
	// deliberately NOT touched here: they're owned by the host via setupControls, and overwriting
	// them per solve would silently discard user-supplied configuration after the first update.
	if (!initialPositionSet) {
		const distance = maxDim * CAMERA_CONFIG.INITIAL_DISTANCE_MULTIPLIER;

		// camera.up is already the configured sceneUp (initThree sets it before this runs), so the
		// iso offset stays consistent with whatever up-axis the viewer opened at.
		camera.position.copy(center).add(isoOffset(camera.up, distance));
		controls.target.copy(center);

		controls.update();
	}
}

// Excluded from every content-bounds query: the grid is a huge plane that re-centers on the
// camera each frame, so including it would make fit-to-view frame the camera's position instead
// of the geometry.
const VIEWER_AID_IDS = new Set(['grid', 'floor', 'label-layer', 'measure']);

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
 * Bounds of the scene's renderable content, excluding viewer aids (grid/floor/labels/measure).
 * Shared by fit-to-view, pick-threshold scaling, camera framing (`setView`), and shadow-frustum
 * fitting so they all measure exactly the same box.
 */
export function computeContentBounds(scene: THREE.Scene): THREE.Box3 {
	// Refresh world matrices once up front so expandByObject reads current transforms, regardless
	// of when the caller invokes this.
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

const PERSISTENT_SCENE_IDS = new Set(['floor', 'grid', 'label-layer']);

export function clearScene(scene: THREE.Scene): void {
	// Snapshot — removeFromParent below mutates scene.children during iteration.
	const topLevel = [...scene.children];

	topLevel.forEach((object) => {
		// Removing the label-layer group here would orphan it: the CSS2D renderer only finds labels
		// by walking the live scene, so labels added afterwards would never render.
		if (PERSISTENT_SCENE_IDS.has(object.userData.id)) return;

		// Host-added geometry (tagged by addUserGeometry, either plain 'user' or an app: scope)
		// persists across solves so it isn't lost when compute content is replaced.
		if (isHostOwned(object)) return;

		// Edge overlays are children of the meshes they outline, so this traversal disposes their
		// line geometries too — each overlay owns its geometry outright.
		disposeObjectTree(object);

		object.removeFromParent();
	});
}
