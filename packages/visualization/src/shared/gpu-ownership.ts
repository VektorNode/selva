import type * as THREE from 'three';

// ============================================================================
// GPU resource ownership — the single rule every disposal path obeys
// ============================================================================

/**
 * A GPU resource has exactly one owner: a **module singleton** (nobody ever frees it), a **cache**
 * (frees it on eviction) or the **scene** (freed on teardown). Every disposal path asks
 * {@link canDisposeMaterial} before freeing a material. Textures are always scene-owned.
 *
 * A cached geometry's data belongs to the cache, but its GPU copy lives only while a scene draws it.
 * Scene teardown resolves each geometry with {@link cachedSourceOf} and frees the GPU copy of every
 * cached geometry the next scene does not draw; three uploads it again if it comes back. A cached
 * geometry can back several meshes at once, so nothing may write to its arrays.
 */

// Module-scope singletons from `render/three-materials.ts`, shared across meshes and solves —
// disposing one would free textures still in use and force a recompile. Held here (not imported
// there) to avoid an import cycle.
const protectedMaterials = new Set<THREE.Material>();

/** Register materials as never-disposable. Called once by `render/three-materials.ts`. */
export function protectMaterials(materials: Iterable<THREE.Material>): void {
	for (const material of materials) protectedMaterials.add(material);
}

/** True when `material` is scene-owned (not one of the protected singletons). */
export function canDisposeMaterial(material: THREE.Material | undefined): boolean {
	if (!material) return false;
	return !protectedMaterials.has(material);
}

// Geometries the parser's finished-geometry cache hands out across solves.
const sharedGeometries = new WeakSet<THREE.BufferGeometry>();

export function shareGeometry(geometry: THREE.BufferGeometry): void {
	sharedGeometries.add(geometry);
}

export function unshareGeometry(geometry: THREE.BufferGeometry): void {
	sharedGeometries.delete(geometry);
}

export function isCachedGeometry(geometry: THREE.BufferGeometry): boolean {
	return sharedGeometries.has(geometry);
}

// Scene-owned geometries drawing a cached geometry's attributes under their own groups. Disposing
// one as is would free those attributes' GPU buffers out from under the cache.
const borrowers = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

export function borrowGeometry(borrower: THREE.BufferGeometry, source: THREE.BufferGeometry): void {
	borrowers.set(borrower, source);
}

/** The cached geometry whose GPU buffers `geometry` draws, or null when it owns its own. */
export function cachedSourceOf(geometry: THREE.BufferGeometry): THREE.BufferGeometry | null {
	if (sharedGeometries.has(geometry)) return geometry;
	// Once evicted, the source is scene-owned like any other geometry, and the borrower frees it.
	const source = borrowers.get(geometry);
	return source && sharedGeometries.has(source) ? source : null;
}
