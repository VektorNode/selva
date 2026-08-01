import * as THREE from 'three';

import { canDisposeMaterial } from './gpu-ownership.js';

// ============================================================================
// The disposal walkers — every teardown path in the package goes through these
// ============================================================================

/**
 * Free a material and its textures, respecting ownership (`./gpu-ownership.ts`). Walks own
 * enumerable properties only (`for...in` would also walk the prototype chain).
 */
export function disposeMaterial(material: THREE.Material): void {
	if (!canDisposeMaterial(material)) return;

	for (const value of Object.values(material)) {
		if (value instanceof THREE.Texture) {
			value.dispose();
		}
	}
	material.dispose();
}

function disposeMaterials(material: THREE.Material | THREE.Material[] | undefined): void {
	if (!material) return;
	if (Array.isArray(material)) material.forEach(disposeMaterial);
	else disposeMaterial(material);
}

export interface DisposeOptions {
	/** Free materials and their textures too. Default true; the solve memo passes false. */
	materials?: boolean;
	/** Called for each geometry before disposal, so a subsystem can free derived resources keyed on it (e.g. edge caches). */
	onGeometry?: (geometry: THREE.BufferGeometry) => void;
}

/**
 * Free the GPU resources of an object subtree, respecting ownership. **The only traversal that
 * should dispose scene content** — a second disposing `traverse` risks missing an ownership guard.
 */
export function disposeObjectTree(root: THREE.Object3D, options: DisposeOptions = {}): void {
	const { materials = true } = options;

	root.traverse((object) => {
		const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
		if (!renderable.geometry && !renderable.material) return;

		if (renderable.geometry) {
			renderable.geometry?.dispose();
		}

		if (materials) disposeMaterials(renderable.material);
	});
}
