export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

/**
 * @deprecated Identity transform — Rhino and Three are both Z-up, so `x`/`y`/`z` pass through
 * unchanged regardless of the `apply` flag. Use the coordinates directly.
 */
export function rhinoToThree(x: number, y: number, z: number, _apply = true): Vec3 {
	return { x, y, z };
}
