import type * as THREE from 'three';

// ============================================================================
// GPU resource ownership — the single rule every disposal path obeys
// ============================================================================

/**
 * Who may free a GPU resource, in one place. A resource has exactly one owner: a **cache** (frees
 * on eviction, nobody else ever), a **module singleton** (nobody ever frees it), or else the
 * **scene** (freed on teardown). Every disposal path asks {@link canDisposeGeometry} /
 * {@link canDisposeMaterial} / {@link canDisposeTexture} and disposes only if true — a new cache
 * adds a claim here, not an audit of every walker.
 */

/**
 * `geometry.userData` tag set by the cross-solve geometry cache (`parse/webdisplay/geometry-cache.ts`).
 * Exported only so the cache can set/clear it; disposal paths should use {@link canDisposeGeometry}.
 */
export const CACHED_GEOMETRY_USERDATA_FLAG = 'selvaGeometryCache';

/**
 * `texture.userData` tag for a texture owned by the cross-solve texture cache
 * (`parse/webdisplay/texture-cache.ts`). A cached texture is assigned directly onto materials
 * (`material.map = cached`) and shared across every material using that URL — without this flag the
 * first material sweep to reach one would free a texture the cache still holds and serves elsewhere.
 */
export const CACHED_TEXTURE_USERDATA_FLAG = 'selvaTextureCache';

// Module-scope singletons from `render/three-materials.ts`, shared across meshes and solves —
// disposing one would free textures still in use and force a recompile. Held here (not imported
// there) to avoid an import cycle.
const protectedMaterials = new Set<THREE.Material>();

/** Register materials as never-disposable. Called once by `render/three-materials.ts`. */
export function protectMaterials(materials: Iterable<THREE.Material>): void {
	for (const material of materials) protectedMaterials.add(material);
}

/** True when `geometry` is scene-owned (not held by the geometry cache). */
export function canDisposeGeometry(geometry: THREE.BufferGeometry | undefined): boolean {
	if (!geometry) return false;
	return !geometry.userData?.[CACHED_GEOMETRY_USERDATA_FLAG];
}

/** True when `texture` is scene-owned (not held by the texture cache). */
export function canDisposeTexture(texture: THREE.Texture | undefined): boolean {
	if (!texture) return false;
	return !texture.userData?.[CACHED_TEXTURE_USERDATA_FLAG];
}

/** True when `material` is scene-owned (not one of the protected singletons). */
export function canDisposeMaterial(material: THREE.Material | undefined): boolean {
	if (!material) return false;
	return !protectedMaterials.has(material);
}

// ============================================================================
// Cache registry — so teardown frees every cache without knowing they exist
// ============================================================================

const cacheReleases = new Set<() => void>();

/**
 * Register a cache's "free everything you hold" function, called once at the cache's module init.
 * This is how `render/`'s teardown frees `parse/`'s caches without importing `parse/`.
 */
export function registerCacheRelease(release: () => void): void {
	cacheReleases.add(release);
}

/**
 * Free every registered cache. One throwing cache does not stop the rest.
 *
 * Prefer {@link retainCaches} in a viewer — caches are shared across viewers, so calling this while
 * another viewer is live discards entries it's still using (they repopulate, but it's wasteful).
 */
export function releaseAllCaches(): void {
	for (const release of cacheReleases) {
		try {
			release();
		} catch {
			// Teardown has no sink to report to — the context is already gone.
		}
	}
}

let cacheRetainCount = 0;

/**
 * Claim the shared caches for the lifetime of one viewer. Returns a release function; refcounted
 * because two viewers on one page (e.g. main view + thumbnail) share the same cache entries, and
 * the first to unmount must not wipe the second's working set — caches only actually free once the
 * last viewer releases them.
 */
export function retainCaches(): () => void {
	cacheRetainCount++;
	let released = false;

	return () => {
		// Idempotent: hosts double-invoke teardown (React StrictMode, double unmount); a second call
		// must not decrement the count on another viewer's behalf.
		if (released) return;
		released = true;
		cacheRetainCount--;
		if (cacheRetainCount <= 0) {
			cacheRetainCount = 0;
			releaseAllCaches();
		}
	};
}
