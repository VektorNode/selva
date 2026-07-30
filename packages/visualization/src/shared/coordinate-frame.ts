/** Rhino and Three use the same Z-up frame, so this is the identity transform. */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** @deprecated Identity transform — use coordinates directly. */
export function rhinoToThree(x: number, y: number, z: number, _apply = true): Vec3 {
	return { x, y, z };
}
