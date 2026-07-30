import * as THREE from 'three';

import { computeContentBounds } from './three-helpers';

/**
 * Per-frame dynamic near-plane fitting for the perspective camera.
 *
 * Depth-buffer precision is ∝ near/z²: a fixed tiny near (0.01 m) grows to a ~0.25 m depth ULP at
 * 200 m, causing distant coplanar surfaces to z-fight. Pushing `near` up to a fraction of the
 * camera's gap to the nearest visible content recovers 10–100× precision when zoomed out, without
 * clipping anything.
 *
 * Only `near` is fitted; `far` stays owned by config/`updateScene` (must keep covering grid fade,
 * floor). External writes to `camera.near` are adopted as the new lower bound rather than fought —
 * the fitter only ever *raises* near above that floor.
 *
 * Ortho camera needs no fitting (linear depth) and is left untouched; updating the dormant
 * perspective camera while ortho is active is harmless.
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
	 * Unit normals of ground planes through the origin carrying ground aids (grid, floor). The
	 * camera's perpendicular distance to each also bounds near, since the aid re-centers under the
	 * camera and content distance alone would clip it at grazing views.
	 *
	 * Pass a callback, not a snapshot: return only planes whose aid is visible this frame. A hidden
	 * grid (built once so it can be toggled, but currently off) must not collapse `near` toward 0 to
	 * protect geometry nobody can see — that would destroy depth precision (ULP ∝ 1/near).
	 */
	groundNormals?: () => THREE.Vector3[];
}

export interface NearPlaneFitter {
	/** Refit `camera.near` to the current camera/content. Call once per frame, before rendering. */
	update: () => void;
}

const NO_GROUND_NORMALS: THREE.Vector3[] = [];

export function createNearPlaneFitter({
	camera,
	scene,
	groundNormals = () => NO_GROUND_NORMALS
}: NearPlaneFitterOptions): NearPlaneFitter {
	// Floor `near` never fitted below; re-adopted whenever something else writes camera.near.
	let baseNear = camera.near;
	let appliedNear = camera.near;

	const center = new THREE.Vector3();
	const size = new THREE.Vector3();

	const update = () => {
		if (camera.near !== appliedNear) baseNear = camera.near; // external write → new floor

		const bounds = computeContentBounds(scene);
		let near = baseNear;
		if (!bounds.isEmpty()) {
			// Gap to content's bounding sphere: closest content can be to the camera.
			const radius = bounds.getSize(size).length() * 0.5;
			let gap = camera.position.distanceTo(bounds.getCenter(center)) - radius;
			for (const normal of groundNormals()) {
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
