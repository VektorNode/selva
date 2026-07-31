import * as THREE from 'three';

export const DEFAULT_COLOR = '#ffffff';

/** Opacity < 1 flips `transparent` on. */
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
