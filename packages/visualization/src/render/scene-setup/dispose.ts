import * as THREE from 'three';

import {
	canDisposeTexture,
	disposeMaterial,
	disposeObjectTree,
	type DisposeOptions
} from '../../shared/index.js';

/**
 * Scene teardown. The traversal itself lives in `shared/gpu-dispose.ts` — the one walker every
 * disposal path in this package shares, so ownership rules can't drift between them.
 */
export { disposeObjectTree };
export type { DisposeOptions };

/** @deprecated Use {@link disposeMaterial} — same behaviour, ownership-aware. */
export const disposeMaterialWithTextures = disposeMaterial;

/**
 * Sweep every renderable in the scene plus the scene-level textures the traversal can't reach
 * (`environment`, a texture `background`). The teardown half of {@link initThree}'s dispose.
 */
export function disposeSceneResources(scene: THREE.Scene, options?: DisposeOptions): void {
	disposeObjectTree(scene, options);

	// Scene-level textures the traversal above can't reach. Ownership still applies: an environment
	// map is normally scene-owned, but the check costs nothing and keeps the rule in one place.
	if (canDisposeTexture(scene.environment ?? undefined)) scene.environment?.dispose();
	if (scene.background instanceof THREE.Texture && canDisposeTexture(scene.background)) {
		scene.background.dispose();
	}
}
