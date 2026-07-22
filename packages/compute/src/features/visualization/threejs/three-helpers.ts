import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getLogger } from '@/core';

import { SHARED_MATERIALS } from './three-materials';

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

/** Updates scene with meshes and positions camera on first call. */
export function updateScene(
	scene: THREE.Scene,
	meshes: THREE.Object3D[],
	camera: THREE.PerspectiveCamera,
	controls: OrbitControls,
	initialPositionSet: boolean
) {
	clearScene(scene);

	if (meshes.length === 0) return;

	// Add new objects (meshes, lines, points) to scene
	meshes.forEach((mesh) => {
		scene.add(mesh);
	});

	// Calculate bounds of the new content
	const unionBoundingBox = computeCombinedBoundingBox(meshes);

	// Get the center of the union bounding box
	const center = unionBoundingBox.getCenter(new THREE.Vector3());
	const size = unionBoundingBox.getSize(new THREE.Vector3());

	// Calculate a distance that is slightly larger than the largest dimension of the union bounding box
	const maxDim = Math.max(size.x, size.y, size.z);

	// Always update camera frustum to ensure geometry is visible
	// This prevents clipping when geometry size changes significantly
	const scaleRatio = maxDim / Math.min(size.x || 1, size.y || 1, size.z || 1);

	if (scaleRatio > CAMERA_CONFIG.SCALE_RATIO_THRESHOLD || maxDim > CAMERA_CONFIG.HUGE_THRESHOLD) {
		// Large scale range detected - use logarithmic depth buffer approach
		camera.near = maxDim * CAMERA_CONFIG.NEAR_PLANE_FACTOR.TINY;
		camera.far = maxDim * CAMERA_CONFIG.FAR_PLANE_FACTOR.HUGE;
	} else if (maxDim > CAMERA_CONFIG.LARGE_THRESHOLD) {
		// Large scene
		camera.near = maxDim * CAMERA_CONFIG.NEAR_PLANE_FACTOR.SMALL;
		camera.far = maxDim * CAMERA_CONFIG.FAR_PLANE_FACTOR.LARGE;
	} else {
		// Normal scene
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

		camera.position.set(center.x + distance * 0.8, center.y + distance, center.z + distance * 1.2);
		controls.target.copy(center);

		controls.update();
	}
}

/** Parses color strings (hex, RGB, CSS names). */
export function parseColor(colorString: string): THREE.Color {
	if (!colorString || typeof colorString !== 'string') {
		getLogger().warn(`Invalid color input: ${colorString}, using white`);
		return new THREE.Color(0xffffff);
	}

	const trimmed = colorString.trim();

	// Try hex format (#C7A5A5 or C7A5A5) — require exactly 6 hex chars
	if (/^#?[0-9A-Fa-f]{6}$/.test(trimmed)) {
		try {
			const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
			return new THREE.Color(hex);
		} catch {
			getLogger().warn(`Invalid hex color: ${colorString}, using white`);
			return new THREE.Color(0xffffff);
		}
	}

	// Try RGB format (R, G, B)
	if (trimmed.includes(',')) {
		const rgb = trimmed.split(',').map((c) => parseInt(c.trim(), 10));
		if (rgb.length === 3 && rgb.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
			return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
		}
	}

	// Try CSS named color. `new THREE.Color(name)` never throws on unknown names (it logs its own
	// warning and leaves the color white), so validate against three's CSS name table instead.
	const named = trimmed.toLowerCase();
	if (named in THREE.Color.NAMES) {
		return new THREE.Color(THREE.Color.NAMES[named as keyof typeof THREE.Color.NAMES]);
	}

	getLogger().warn(`Invalid color string: ${colorString}, using white`);
	return new THREE.Color(0xffffff);
}

/**
 * Shift objects along one world axis. Defaults to `z` — the up axis of the unified Z-up scene
 * frame (see `../coordinate-transform.ts`), so grounding subtracts the content's lowest z.
 */
export function applyOffset(
	meshes: THREE.Object3D[],
	offset: number,
	axis: 'x' | 'y' | 'z' = 'z'
): void {
	meshes.forEach((mesh) => {
		mesh.position[axis] -= offset;
	});
}

/**
 * Computes the combined world-axis-aligned bounding box of a set of objects (meshes, lines, points).
 * Correctly accounts for transformations (rotation, position, scale).
 */
export function computeCombinedBoundingBox(meshes: THREE.Object3D[]): THREE.Box3 {
	const combinedBoundingBox = new THREE.Box3();
	if (meshes.length === 0) return combinedBoundingBox;
	meshes.forEach((mesh) => {
		// Ensure the world matrix is up to date before calculating the box
		mesh.updateMatrixWorld(true);
		const bbox = new THREE.Box3().setFromObject(mesh);
		combinedBoundingBox.union(bbox);
	});
	return combinedBoundingBox;
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

/**
 * `geometry.userData` tag marking a geometry owned by the cross-solve geometry cache
 * (webdisplay/geometry-cache.ts). `clearScene` must NOT dispose these — the cache keeps them alive
 * (GPU buffers included) so the next solve can reuse them; the cache disposes on eviction instead.
 */
export const CACHED_GEOMETRY_USERDATA_FLAG = 'selvaGeometryCache';

/** Removes all compute content except persistent infrastructure and shared materials. */
export function clearScene(scene: THREE.Scene): void {
	// Snapshot children — we mutate the array via removeFromParent during iteration
	const topLevel = [...scene.children];

	topLevel.forEach((object) => {
		// Persistent scene infrastructure (floor, grid, the CSS2D label layer) outlives content
		// updates — it's added once at init, not per solve. Removing the label-layer group here
		// orphans it, so labels created afterwards never render (the CSS2D renderer walks the live
		// scene and never finds them).
		if (PERSISTENT_SCENE_IDS.has(object.userData.id)) return;

		// User-drawn geometry (added via the viewer's addUserGeometry, tagged source==='user')
		// persists across solves so it isn't lost when compute content is replaced.
		if (object.userData.source === 'user') return;

		// Recursively dispose all renderable objects (meshes, lines, points) in this subtree.
		object.traverse((child) => {
			const renderable = child as Partial<THREE.Mesh> & THREE.Object3D;
			if (!renderable.geometry && !renderable.material) return;

			// Cache-owned geometries survive scene rebuilds — the cache disposes them on eviction.
			if (!renderable.geometry?.userData?.[CACHED_GEOMETRY_USERDATA_FLAG]) {
				renderable.geometry?.dispose();
			}

			const material = renderable.material;
			if (!material) return;
			const materials = Array.isArray(material) ? material : [material];
			materials.forEach((material) => {
				// Module-scope singletons (METAL_MATERIAL et al.) are shared across meshes and across
				// solves — disposing one here would force a shader rebuild on its next use and free
				// textures still referenced by surviving objects.
				if (SHARED_MATERIALS.has(material)) return;

				// Walk only own enumerable properties — `for...in` on a Three.js material
				// also iterates the prototype chain, which is needlessly expensive.
				for (const value of Object.values(material)) {
					if (value instanceof THREE.Texture) {
						value.dispose();
					}
				}
				material.dispose();
			});
		});

		object.removeFromParent();
	});
}
