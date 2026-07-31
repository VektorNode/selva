import * as THREE from 'three';

import { canDisposeTexture, disposeObjectTree, type DisposeOptions } from '../../shared/index.js';

export { disposeObjectTree };
export type { DisposeOptions };

/** Sweeps every renderable plus the scene-level textures the object traversal can't reach. */
export function disposeSceneResources(scene: THREE.Scene, options?: DisposeOptions): void {
	disposeObjectTree(scene, options);

	if (canDisposeTexture(scene.environment ?? undefined)) scene.environment?.dispose();
	if (scene.background instanceof THREE.Texture && canDisposeTexture(scene.background)) {
		scene.background.dispose();
	}
}
