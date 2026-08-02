import * as THREE from 'three';

/**
 * Single source of truth for "which way is up, and what do front/right mean" — camera framing, sun
 * position, ground offset, and view presets all derive from {@link buildUpBasis} rather than
 * hardcoding an axis, so a Y-up scene gets a correct horizon and sun instead of the below-horizon
 * result a hardcoded Z-up vector would give.
 *
 * `forward` is the camera's look direction (camera → model); a view preset's camera position is the
 * reverse (target → camera), see `camera-controller.ts`. `right` is `seed x up`, not `up x seed`, to
 * match Rhino's handedness: for Z-up this makes the Front-view camera look along +Y and the
 * Right-view camera look along -X (it sits at `right` = +X, facing back toward the origin).
 */

/** Orthonormal frame derived from a scene up axis. All vectors are unit length. */
export interface UpBasis {
	up: THREE.Vector3;
	forward: THREE.Vector3;
	right: THREE.Vector3;
}

/** Ground-plane axes for a given up vector: Z-up yields forward = +Y, right = +X (Rhino's Front/Right). */
export function buildUpBasis(up: THREE.Vector3): UpBasis {
	const u = up.clone().normalize();

	// Seed must not be (nearly) parallel to up, or the cross product is unstable.
	const worldZ = new THREE.Vector3(0, 0, 1);
	const worldY = new THREE.Vector3(0, 1, 0);
	const seed = Math.abs(u.dot(worldZ)) > 0.9 ? worldY : worldZ;

	const right = new THREE.Vector3().crossVectors(seed, u).normalize();
	const forward = new THREE.Vector3().crossVectors(u, right).normalize();

	return { up: u, forward, right };
}

/** Default 3/4 iso camera offset from the target (behind-left, above), scaled to `distance`. */
export function isoOffset(up: THREE.Vector3, distance: number): THREE.Vector3 {
	const { forward, right, up: u } = buildUpBasis(up);
	// Normalize before scaling so `distance` is the true radius, not the diagonal of the raw sum.
	return forward
		.clone()
		.multiplyScalar(-1)
		.add(right.clone().multiplyScalar(-1))
		.add(u)
		.normalize()
		.multiplyScalar(distance);
}

/** Default sun position: high above the model, offset to one side for a directional gradient. */
export function sunOffset(up: THREE.Vector3, sideDistance: number, height: number): THREE.Vector3 {
	const { forward, right, up: u } = buildUpBasis(up);
	return right
		.clone()
		.multiplyScalar(sideDistance)
		.add(forward.clone().multiplyScalar(sideDistance))
		.add(u.clone().multiplyScalar(height));
}

/**
 * Rotates an equirectangular environment map's horizon onto the scene's ground plane.
 *
 * Three's equirect mapping is hardcoded to Y-up: the HDR's horizon is assumed to lie in the XZ
 * plane with zenith along +Y. In a Z-up scene that leaves the environment on its side — horizon
 * vertical, lighting arriving from +Y instead of overhead. A neutral studio HDR hides this; any
 * sky/ground HDR makes it obvious.
 *
 * Returns the Euler rotating the map's native +Y zenith onto `up` (identity for Y-up). Apply to
 * BOTH `scene.environmentRotation` and `scene.backgroundRotation` — they're independent, and
 * setting only one desyncs background from lighting.
 */
export function environmentRotationFor(up: THREE.Vector3): THREE.Euler {
	const u = up.clone().normalize();
	const mapZenith = new THREE.Vector3(0, 1, 0);

	if (u.dot(mapZenith) > 0.9999) return new THREE.Euler();

	// Upside-down (-Y): setFromUnitVectors picks an arbitrary perpendicular axis for a 180° flip,
	// spinning the horizon. Roll about X instead so the horizon stays put.
	if (u.dot(mapZenith) < -0.9999) return new THREE.Euler(Math.PI, 0, 0);

	const quaternion = new THREE.Quaternion().setFromUnitVectors(mapZenith, u);
	return new THREE.Euler().setFromQuaternion(quaternion);
}

/** Which world axis the up vector most closely aligns with. */
export function upToAxis(up: THREE.Vector3): 'x' | 'y' | 'z' {
	const ax = Math.abs(up.x);
	const ay = Math.abs(up.y);
	const az = Math.abs(up.z);
	if (ax >= ay && ax >= az) return 'x';
	if (ay >= az) return 'y';
	return 'z';
}
