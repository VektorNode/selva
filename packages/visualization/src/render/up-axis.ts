import * as THREE from 'three';

/**
 * The single source of truth for "which way is up, and what do front/right mean" in the viewer.
 *
 * Every up-dependent default (camera framing, sun position, ground offset, view presets) derives
 * from {@link buildUpBasis} instead of hardcoding an axis. Before this module those defaults each
 * spelled out a Z-up vector inline, so a scene configured Y-up got a below-horizon camera and a
 * near-horizontal sun while the presets and floor correctly followed `sceneUp`.
 *
 * ## Why front is -forward
 *
 * The basis returns `forward` = the direction the camera LOOKS (from camera toward model), and the
 * preset positions are the opposite (from target toward camera). Rhino's convention fixes the signs:
 * its Front view looks along +Y, so the camera sits at -Y; its Right view looks along -X, so the
 * camera sits at +X. Deriving `right` as `seed x up` (rather than `up x seed`) is what makes the
 * handedness come out matching Rhino rather than mirrored.
 */

/** An orthonormal frame derived from a scene up axis. All vectors are unit length. */
export interface UpBasis {
	/** The scene up axis, normalized. */
	up: THREE.Vector3;
	/** The direction a "front" view looks along (from camera toward the model). */
	forward: THREE.Vector3;
	/** Completes a right-handed frame with `up` and `forward`. */
	right: THREE.Vector3;
}

/**
 * Derive the ground-plane axes for a given up vector.
 *
 * The seed picks whichever world axis is least parallel to `up`, so the cross products stay
 * well-conditioned in any up convention. For Rhino's Z-up this yields forward = +Y and right = +X,
 * matching Rhino's own Front/Right views; for Three's native Y-up it yields forward = -Z and
 * right = +X, matching Three's convention that the default camera looks down -Z.
 */
export function buildUpBasis(up: THREE.Vector3): UpBasis {
	const u = up.clone().normalize();

	// Seed with a world axis that isn't (nearly) parallel to up, so the cross product is stable.
	const worldZ = new THREE.Vector3(0, 0, 1);
	const worldY = new THREE.Vector3(0, 1, 0);
	const seed = Math.abs(u.dot(worldZ)) > 0.9 ? worldY : worldZ;

	// `seed x up` (not `up x seed`) so the handedness matches Rhino: Z-up gives right = +X.
	const right = new THREE.Vector3().crossVectors(seed, u).normalize();
	// Completes the frame. Z-up: forward = +Y (Rhino's Front looks along +Y). Y-up: forward = -Z.
	const forward = new THREE.Vector3().crossVectors(u, right).normalize();

	return { up: u, forward, right };
}

/**
 * The default 3/4 iso camera OFFSET from the target, scaled to `distance`.
 *
 * Placed behind-left and above the model (the conventional architectural 3/4), expressed in the
 * scene's own basis so it reads the same in any up convention. Callers add this to the framing
 * target to get a camera position.
 */
export function isoOffset(up: THREE.Vector3, distance: number): THREE.Vector3 {
	const { forward, right, up: u } = buildUpBasis(up);
	// Behind (-forward), left (-right), above (+up) — normalized so `distance` is the true radius.
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

	// Already Y-up: the map is authored in this frame, so no correction is needed.
	if (u.dot(mapZenith) > 0.9999) return new THREE.Euler();

	// Upside-down (-Y): setFromUnitVectors picks an arbitrary perpendicular axis for a 180° flip,
	// which would also spin the horizon. Roll about X so the horizon stays put.
	if (u.dot(mapZenith) < -0.9999) return new THREE.Euler(Math.PI, 0, 0);

	const quaternion = new THREE.Quaternion().setFromUnitVectors(mapZenith, u);
	return new THREE.Euler().setFromQuaternion(quaternion);
}

/**
 * Which world axis (`'x' | 'y' | 'z'`) the up vector most closely aligns with.
 *
 * Used for the grid plane and for the ground-offset axis — both need a single component index
 * rather than a full vector. An off-axis up vector resolves to its dominant component.
 */
export function upToAxis(up: THREE.Vector3): 'x' | 'y' | 'z' {
	const ax = Math.abs(up.x);
	const ay = Math.abs(up.y);
	const az = Math.abs(up.z);
	if (ax >= ay && ax >= az) return 'x';
	if (ay >= az) return 'y';
	return 'z';
}
