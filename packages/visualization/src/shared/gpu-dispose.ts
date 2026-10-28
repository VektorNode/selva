import * as THREE from 'three';

import { cachedSourceOf, canDisposeMaterial } from './gpu-ownership.js';

// ============================================================================
// The disposal walkers — every teardown path in the package goes through these
// ============================================================================

/** Frees a material and its textures, respecting ownership (`./gpu-ownership.ts`). */
export function disposeMaterial(material: THREE.Material): void {
	if (!canDisposeMaterial(material)) return;

	for (const [key, value] of Object.entries(material)) {
		// An envMap is the scene's, shared by every metal: freeing it here would blank them all.
		if (key === 'envMap') continue;
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
	/**
	 * Cached geometries whose GPU copy survives. When given, every other cached geometry this walk
	 * reaches loses its GPU copy.
	 */
	keepUploaded?: ReadonlySet<THREE.BufferGeometry>;
}

/**
 * Frees the GPU resources of an object subtree, respecting ownership. **The only traversal that
 * should dispose scene content** — a second disposing `traverse` risks missing an ownership guard.
 */
export function disposeObjectTree(root: THREE.Object3D, options: DisposeOptions = {}): void {
	const { materials = true, keepUploaded } = options;

	root.traverse((object) => {
		const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
		if (!renderable.geometry && !renderable.material) return;

		if (renderable.geometry) disposeGeometry(renderable.geometry, keepUploaded);

		if (materials) disposeMaterials(renderable.material);
	});
}

function disposeGeometry(
	geometry: THREE.BufferGeometry,
	keepUploaded: ReadonlySet<THREE.BufferGeometry> | undefined
): void {
	const source = cachedSourceOf(geometry);
	if (source !== geometry) {
		// three's dispose frees the GPU buffers of whatever attributes are attached, so a borrower
		// lets go of the cache's attributes first.
		if (source) {
			geometry.setIndex(null);
			for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
		}
		geometry.dispose();
	}
	if (source && keepUploaded && !keepUploaded.has(source)) source.dispose();
}
