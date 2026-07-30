import * as THREE from 'three';

import { canDisposeGeometry, canDisposeMaterial, canDisposeTexture } from './gpu-ownership.js';

// ============================================================================
// The disposal walkers — every teardown path in the package goes through these
// ============================================================================

/**
 * Free a material and the textures it references, respecting ownership
 * ([gpu-ownership](./gpu-ownership.ts)).
 *
 * Walks own enumerable properties only — `for...in` would iterate the prototype chain for nothing.
 * A cache-owned texture (or a shared singleton material) is left alone; everything else is freed.
 */
export function disposeMaterial(material: THREE.Material): void {
	if (!canDisposeMaterial(material)) return;

	for (const value of Object.values(material)) {
		if (value instanceof THREE.Texture && canDisposeTexture(value)) {
			value.dispose();
		}
	}
	material.dispose();
}

/** Free every material on a renderable (they come singly or as an array). */
function disposeMaterials(material: THREE.Material | THREE.Material[] | undefined): void {
	if (!material) return;
	if (Array.isArray(material)) material.forEach(disposeMaterial);
	else disposeMaterial(material);
}

/** What a caller wants freed. Geometry and materials are separable because the memo owns only geometry. */
export interface DisposeOptions {
	/** Free materials and their textures too. Default true; the solve memo passes false. */
	materials?: boolean;
	/**
	 * Called for each renderable's geometry before it is considered for disposal, so a subsystem can
	 * release its own derived resources keyed on that geometry. The edge caches use this — their
	 * line geometries are keyed on the source geometry, and a scene clear is the only signal that
	 * the overlays are gone.
	 */
	onGeometry?: (geometry: THREE.BufferGeometry) => void;
}

/**
 * Free the GPU resources of an object subtree, respecting ownership.
 *
 * **This is the only traversal that should dispose scene content.** Before it existed there were
 * three, each with a different subset of the ownership guards, and the gaps between them were
 * exactly where the F1 and texture leaks lived. If you need a new teardown path, call this — do not
 * write a fourth `traverse` that disposes.
 */
export function disposeObjectTree(root: THREE.Object3D, options: DisposeOptions = {}): void {
	const { materials = true, onGeometry } = options;

	root.traverse((object) => {
		const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
		if (!renderable.geometry && !renderable.material) return;

		if (renderable.geometry) {
			onGeometry?.(renderable.geometry);
			if (canDisposeGeometry(renderable.geometry)) renderable.geometry.dispose();
		}

		if (materials) disposeMaterials(renderable.material);
	});
}
