import * as THREE from 'three';

/** Room left around a fitted box, as a factor on the tight distance. */
export const FIT_MARGIN = 1.1;

/**
 * How far from the box's center, along `direction` (target → camera), a perspective camera with
 * vertical field of view `fovDegrees` and `aspect` must sit to see the whole box, with `margin`.
 *
 * Every corner is fitted across both the width and the height of the view. Fitting the box's
 * largest side to the vertical field of view alone left a long part in a wide viewport filling a
 * third of it.
 */
export function fitDistance(
	box: THREE.Box3,
	direction: THREE.Vector3,
	up: THREE.Vector3,
	fovDegrees: number,
	aspect: number,
	margin = FIT_MARGIN
): number {
	if (box.isEmpty()) return margin;
	const dir = direction.clone().normalize();
	const center = box.getCenter(new THREE.Vector3());
	const tanV = Math.tan((fovDegrees * Math.PI) / 360);
	const tanH = tanV * (aspect > 0 && Number.isFinite(aspect) ? aspect : 1);

	// The view's own right and up. Looking along `up` leaves `right` undefined; any perpendicular
	// then serves, since only the corners' distances from the view axis count.
	const right = new THREE.Vector3().crossVectors(up, dir);
	if (right.lengthSq() < 1e-12) {
		right.crossVectors(
			Math.abs(dir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0),
			dir
		);
	}
	right.normalize();
	const viewUp = new THREE.Vector3().crossVectors(dir, right).normalize();

	const corner = new THREE.Vector3();
	let distance = 0;
	for (const x of [box.min.x, box.max.x])
		for (const y of [box.min.y, box.max.y])
			for (const z of [box.min.z, box.max.z]) {
				corner.set(x, y, z).sub(center);
				// A corner nearer the camera needs the camera that much further back to stay in view.
				const depth = corner.dot(dir);
				distance = Math.max(
					distance,
					Math.abs(corner.dot(right)) / tanH + depth,
					Math.abs(corner.dot(viewUp)) / tanV + depth
				);
			}
	return (distance || 1) * margin;
}
