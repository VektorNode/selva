/** Rhino and Three use the same Z-up coordinate frame (identity transform). */

/** A point in either frame (the frames are now identical). */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/** Identity transform (both frames Z-up). Deprecated; use coordinates directly. */
export function rhinoToThree(x: number, y: number, z: number, _apply = true): Vec3 {
	return { x, y, z };
}
