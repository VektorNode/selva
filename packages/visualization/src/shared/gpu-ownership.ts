import type * as THREE from 'three';

// ============================================================================
// GPU resource ownership: the single rule every disposal path obeys
// ============================================================================

/**
 * A GPU resource has exactly one owner: a **module singleton** (nobody ever frees it) or the
 * **scene** (freed on teardown). Every disposal path asks {@link canDisposeMaterial} and disposes
 * only if true. Geometries and textures are always scene-owned, so they have no claim to check.
 */

// Module-scope singletons from `render/three-materials.ts`, shared across meshes and solves:
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
