import * as THREE from 'three';

/**
 * Single source of truth for "which way is up, and what do front/right mean" in the viewer. Every
 * up-dependent default (camera framing, sun position, ground offset, view presets) derives from
 * {@link buildUpBasis} rather than hardcoding an axis — that's what lets a Y-up scene get a correct
 * horizon and sun instead of the below-horizon/near-flat result a hardcoded Z-up vector would give.
 *
 * `forward` is the direction the camera looks (camera → model); preset positions are the reverse
 * (target → camera). Deriving `right` as `seed x up` (not `up x seed`) matches Rhino's handedness:
 * Front looks along +Y (camera at -Y), Right looks along -X (camera at +X).
 */

/** An orthonormal frame derived from a scene up axis. All vectors are unit length. */
export interface UpBasis {
	up: THREE.Vector3;
	/** Direction a "front" view looks along (camera toward model). */
	forward: THREE.Vector3;
	right: THREE.Vector3;
}

/**
 * Ground-plane axes for a given up vector: Z-up yields forward = +Y, right = +X (Rhino's
 * Front/Right); Y-up yields forward = -Z, right = +X (Three's default -Z look).
 */
export function buildUpBasis(up: THREE.Vector3): UpBasis {
	const u = up.clone().normalize();

	// Seed with a world axis that isn't (nearly) parallel to up, so the cross product is stable.
	const worldZ = new THREE.Vector3(0, 0, 1);
	const worldY = new THREE.Vector3(0, 1, 0);
	const seed = Math.abs(u.dot(worldZ)) > 0.9 ? worldY : worldZ;

	// `seed x up`, not `up x seed` — matches Rhino's handedness (Z-up gives right = +X).
	const right = new THREE.Vector3().crossVectors(seed, u).normalize();
	const forward = new THREE.Vector3().crossVectors(u, right).normalize();

	return { up: u, forward, right };
}

/**
 * Default 3/4 iso camera offset from the target, scaled to `distance` — behind-left and above the
 * model, expressed in the scene's own basis so it reads the same in any up convention. Add to the
 * framing target to get a camera position.
 */
export function isoOffset(up: THREE.Vector3, distance: number): THREE.Vector3 {
	const { forward, right, up: u } = buildUpBasis(up);
	// Normalized first so `distance` is the true radius, not the diagonal of the unnormalized sum.
	return forward
		.clone()
		.multiplyScalar(-1)
		.add(right.clone().multiplyScalar(-1))
		.add(u)
		.normalize()
		.multiplyScalar(distance);
}

/**
 * A default sun position: high above the model, offset to one side so surfaces get a directional
 * gradient instead of flat top-down light. Expressed in the scene basis rather than a literal
 * Z-up vector, so a Y-up scene still gets an overhead sun rather than a horizontal one.
 */
export function sunOffset(up: THREE.Vector3, sideDistance: number, height: number): THREE.Vector3 {
	const { forward, right, up: u } = buildUpBasis(up);
	return right
		.clone()
		.multiplyScalar(sideDistance)
		.add(forward.clone().multiplyScalar(sideDistance))
		.add(u.clone().multiplyScalar(height));
}

/**
 * The rotation that puts an equirectangular environment map's horizon on the scene's ground plane.
 *
 * Three's equirect mapping is hardcoded to Y-up: it assumes the HDR's horizon lies in the XZ plane
 * and its zenith points along +Y. In a Z-up scene that leaves the environment on its side — the
 * horizon runs vertically and image-based lighting arrives from +Y rather than from overhead. The
 * result is a subtly wrong key direction that a neutral studio HDR hides but any sky/ground HDR
 * makes obvious.
 *
 * Returns the Euler that rotates the map's native +Y zenith onto `up`. Identity for a Y-up scene.
 * Apply to BOTH `scene.environmentRotation` and `scene.backgroundRotation` — they are independent
 * properties, and setting only one makes the visible background disagree with the lighting.
 */
export function environmentRotationFor(up: THREE.Vector3): THREE.Euler {
	const u = up.clone().normalize();
	const mapZenith = new THREE.Vector3(0, 1, 0);

	if (u.dot(mapZenith) > 0.9999) return new THREE.Euler();

	// Upside-down (-Y): setFromUnitVectors picks an arbitrary perpendicular axis for a 180° flip,
	// which would also spin the horizon. Roll about X so the horizon stays put.
	if (u.dot(mapZenith) < -0.9999) return new THREE.Euler(Math.PI, 0, 0);

	const quaternion = new THREE.Quaternion().setFromUnitVectors(mapZenith, u);
	return new THREE.Euler().setFromQuaternion(quaternion);
}

/**
 * Which world axis the up vector most closely aligns with — used where the grid plane and
 * ground-offset need a single component index rather than a full vector.
 */
export function upToAxis(up: THREE.Vector3): 'x' | 'y' | 'z' {
	const ax = Math.abs(up.x);
	const ay = Math.abs(up.y);
	const az = Math.abs(up.z);
	if (ax >= ay && ax >= az) return 'x';
	if (ay >= az) return 'y';
	return 'z';
}
