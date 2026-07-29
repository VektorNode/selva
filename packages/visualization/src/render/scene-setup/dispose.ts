import * as THREE from 'three';

/**
 * Dispose a material together with any textures it references (`map`, `roughnessMap`, …), matching
 * `clearScene`'s texture sweep (three-helpers) so no teardown path leaks GPU textures across viewer
 * mount/unmount cycles. Walks own enumerable properties only — `for...in` would needlessly iterate
 * the prototype chain.
 */
export function disposeMaterialWithTextures(material: THREE.Material): void {
	for (const value of Object.values(material)) {
		if (value instanceof THREE.Texture) {
			value.dispose();
		}
	}
	material.dispose();
}

/**
 * Dispose one object's renderable resources (geometry + materials + their textures), recursing into
 * children so Groups of lines/points clean up fully.
 */
export function disposeObjectTree(root: THREE.Object3D): void {
	root.traverse((object) => {
		const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
		if (!renderable.geometry && !renderable.material) return;
		renderable.geometry?.dispose();
		if (Array.isArray(renderable.material)) {
			renderable.material.forEach(disposeMaterialWithTextures);
		} else if (renderable.material) {
			disposeMaterialWithTextures(renderable.material);
		}
	});
}

/**
 * Sweep every renderable in the scene plus the scene-level textures the traversal can't reach
 * (`environment`, a texture `background`). The teardown half of {@link initThree}'s dispose.
 */
export function disposeSceneResources(scene: THREE.Scene): void {
	disposeObjectTree(scene);

	// Scene-level textures the traversal above can't reach.
	scene.environment?.dispose();
	if (scene.background instanceof THREE.Texture) {
		scene.background.dispose();
	}
}
