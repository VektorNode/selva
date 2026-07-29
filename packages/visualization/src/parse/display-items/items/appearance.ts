import * as THREE from 'three';

/** The color display items fall back to when the payload carries none. */
export const DEFAULT_COLOR = '#ffffff';

/** Shared color/opacity → THREE material params. Opacity < 1 flips `transparent` on. */
export function materialParams(
	color: string | undefined,
	opacity: number | undefined
): { color: THREE.Color; transparent: boolean; opacity: number } {
	const resolved = opacity ?? 1;
	return {
		color: new THREE.Color(color ?? DEFAULT_COLOR),
		transparent: resolved < 1,
		opacity: resolved
	};
}
