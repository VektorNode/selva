import * as THREE from 'three';

import { disposeObjectTree, type DisposeOptions } from '../../shared/index.js';

export { disposeObjectTree };
export type { DisposeOptions };

/** Sweeps every renderable plus the scene-level textures the object traversal can't reach. */
export function disposeSceneResources(scene: THREE.Scene, options?: DisposeOptions): void {
	disposeObjectTree(scene, options);

	scene.environment?.dispose();
	if (scene.background instanceof THREE.Texture) {
		scene.background.dispose();
	}
}
