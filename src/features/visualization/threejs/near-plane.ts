import * as THREE from 'three';

import { computeContentBounds } from './three-helpers';

/**
 * Per-frame dynamic near-plane fitting for the perspective camera.
 *
 * Depth-buffer precision is ∝ near/z²: with a fixed tiny near (0.01 m for the 'm' scale) a depth
 * ULP grows to ~0.25 m at 200 m viewing distance, which is what makes distant coplanar-ish surfaces
 * z-fight and any constant depth bias balloon to meter scale. Pushing `near` up to a fraction of
 * the camera's gap to the nearest thing it can see recovers that precision — 10–100× when zoomed
 * out — without clipping anything.
 *
 * Only `near` is fitted; `far` barely affects precision and must keep covering large aids (grid
 * fade region, floor), so it stays owned by config/`updateScene`. External writes to `camera.near`
 * (the per-solve static fit in `updateScene`, host code) are adopted as the new lower bound rather
 * than fought: the fitter only ever *raises* near above that floor.
 *
 * The 2D orthographic camera needs no fitting (ortho depth is linear) and is untouched — updating
 * the dormant perspective camera while 2D is active is harmless.
 */

/** Stay this fraction of the gap back from the nearest clippable thing — headroom for the frame's camera motion and bounds staleness. */
const NEAR_GAP_FRACTION = 0.5;
/** Never push near beyond this fraction of far: keeps the frustum sane if the camera flies out. */
const MAX_NEAR_TO_FAR = 0.01;
/** Skip sub-5% changes so the projection matrix isn't rebuilt every frame while orbiting. */
const APPLY_THRESHOLD = 0.05;

export interface NearPlaneFitterOptions {
	camera: THREE.PerspectiveCamera;
	scene: THREE.Scene;
	/**
	 * Unit normals of ground planes through the origin that carry always-visible aids (grid, floor).
	 * The camera's perpendicular distance to each also bounds near — the grid re-centers under the
	 * camera, so content distance alone would clip it at grazing views. Empty when neither aid is on.
	 */
	groundNormals?: THREE.Vector3[];
}

export interface NearPlaneFitter {
	/** Refit `camera.near` to the current camera/content. Call once per frame, before rendering. */
	update: () => void;
}

export function createNearPlaneFitter({
	camera,
	scene,
	groundNormals = []
}: NearPlaneFitterOptions): NearPlaneFitter {
	// The floor near never fitted below. Seeded from construction config; re-adopted whenever
	// something other than this fitter writes camera.near.
	let baseNear = camera.near;
	let appliedNear = camera.near;

	const center = new THREE.Vector3();
	const size = new THREE.Vector3();

	const update = () => {
		if (camera.near !== appliedNear) baseNear = camera.near; // external write → new floor

		const bounds = computeContentBounds(scene);
		let near = baseNear;
		if (!bounds.isEmpty()) {
			// Gap to the content's bounding sphere: the closest any content can be to the camera.
			const radius = bounds.getSize(size).length() * 0.5;
			let gap = camera.position.distanceTo(bounds.getCenter(center)) - radius;
			for (const normal of groundNormals) {
				gap = Math.min(gap, Math.abs(camera.position.dot(normal)));
			}
			near = THREE.MathUtils.clamp(gap * NEAR_GAP_FRACTION, baseNear, camera.far * MAX_NEAR_TO_FAR);
		}

		if (Math.abs(near - appliedNear) > appliedNear * APPLY_THRESHOLD) {
			camera.near = near;
			camera.updateProjectionMatrix();
			appliedNear = near;
		}
	};

	return { update };
}
