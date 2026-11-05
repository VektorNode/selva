import type * as THREE from 'three';

/**
 * `userData` key marking a material the parser built as glass. AO, the edge pass and shadow maps
 * skip it: each treats a surface as opaque, so glass would darken, outline and shade what it shows.
 */
export const GLASS = 'selvaGlass';

export function isGlass(material: THREE.Material | THREE.Material[] | undefined): boolean {
	if (!material) return false;
	return Array.isArray(material)
		? material.some((m) => m.userData[GLASS] === true)
		: material.userData[GLASS] === true;
}

/**
 * Hides every visible mesh drawn in glass under `root` and returns the call that shows them again.
 * For passes that redraw the scene with an override material, which would otherwise draw glass as
 * a solid surface.
 */
export function hideGlass(root: THREE.Object3D): () => void {
	const hidden: THREE.Object3D[] = [];
	root.traverse((object) => {
		if (object.visible && isGlass((object as THREE.Mesh).material)) {
			object.visible = false;
			hidden.push(object);
		}
	});
	return () => {
		for (const object of hidden) object.visible = true;
	};
}
