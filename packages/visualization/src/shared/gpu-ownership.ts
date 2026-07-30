import type * as THREE from 'three';

// ============================================================================
// GPU resource ownership — the single rule every disposal path obeys
// ============================================================================

/**
 * Who may free a GPU resource, in one place. Exists because ownership used to be prose scattered
 * across each cache's docblock, enforced by four separate disposal traversals that each had to
 * rediscover the rules — which is how two leaks happened in one week: F1 (edge line-geometry:
 * `clearScene` detached overlays without decrementing refcounts once the geometry cache kept source
 * geometries reachable) and C1 (memo clone: `BufferGeometry.clone()` copies `userData` by reference,
 * so clones carried the cache-owned flag and were never freed). A third case, cache-owned textures
 * assigned straight onto materials and freed by every material sweep regardless, turned up auditing
 * the first two.
 *
 * **The rule.** A GPU resource has exactly one owner: a **cache** (frees on eviction, nobody else
 * ever), a **module singleton** (nobody ever frees it), or else the **scene** (freed on teardown).
 * Every disposal path is the same: ask {@link canDisposeGeometry} / {@link canDisposeMaterial} /
 * {@link canDisposeTexture} and dispose only if true. A new cache adds a claim here, not an audit of
 * every walker.
 */

/**
 * `geometry.userData` tag for a geometry owned by the cross-solve geometry cache
 * (`parse/webdisplay/geometry-cache.ts`), which keeps it (GPU buffers included) for reuse and frees
 * it itself on eviction. Prefer {@link canDisposeGeometry}; exported only so the cache can set/clear it.
 */
export const CACHED_GEOMETRY_USERDATA_FLAG = 'selvaGeometryCache';

/**
 * `texture.userData` tag for a texture owned by the cross-solve texture cache
 * (`parse/webdisplay/texture-cache.ts`). A cached texture is assigned directly onto materials
 * (`material.map = cached`) and shared across every material using that URL — without this flag the
 * first material sweep to reach one would free a texture the cache still holds and serves elsewhere.
 */
export const CACHED_TEXTURE_USERDATA_FLAG = 'selvaTextureCache';

/**
 * Materials that must never be disposed: the module-scope singletons in `render/three-materials.ts`,
 * shared across meshes and solves (disposing one would free textures still in use and force a
 * recompile). Registered by that module at init, avoiding an import cycle here.
 */
const protectedMaterials = new Set<THREE.Material>();

/** Register materials as never-disposable. Called once by `render/three-materials.ts`. */
export function protectMaterials(materials: Iterable<THREE.Material>): void {
	for (const material of materials) protectedMaterials.add(material);
}

/** True when `geometry` is scene-owned, i.e. the caller tearing down a scene may free it. */
export function canDisposeGeometry(geometry: THREE.BufferGeometry | undefined): boolean {
	if (!geometry) return false;
	return !geometry.userData?.[CACHED_GEOMETRY_USERDATA_FLAG];
}

/** True when `texture` is scene-owned, i.e. not held by the cross-solve texture cache. */
export function canDisposeTexture(texture: THREE.Texture | undefined): boolean {
	if (!texture) return false;
	return !texture.userData?.[CACHED_TEXTURE_USERDATA_FLAG];
}

/** True when `material` is scene-owned, i.e. not one of the shared singletons. */
export function canDisposeMaterial(material: THREE.Material | undefined): boolean {
	if (!material) return false;
	return !protectedMaterials.has(material);
}

/**
 * Whether a resource is currently claimed by a cache or singleton — the inverse of the `canDispose*`
 * family, for diagnostics and tests. Not needed on any disposal path.
 */
export function isProtectedMaterial(material: THREE.Material): boolean {
	return protectedMaterials.has(material);
}

// ============================================================================
// Cache registry — so teardown frees every cache without knowing they exist
// ============================================================================

const cacheReleases = new Set<() => void>();

/**
 * Register a cache's "free everything you hold" function. Caches outlive any single scene but not
 * the WebGL context, so teardown must free them without needing to know which caches exist — a cache
 * pushes its release function here at module init, and `initThree`'s `dispose()` drains the registry.
 * This is how `render/` frees `parse/`'s caches without importing `parse/`.
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

/** Live viewers holding the caches open. The caches are module-level, so they are shared. */
let cacheRetainCount = 0;

/**
 * Claim the shared caches for the lifetime of one viewer. Returns a release function; the caches are
 * actually freed only once the last viewer has released them — refcounted because two viewers on one
 * page (e.g. a main view and a thumbnail) share the same cache entries, and the first to unmount must
 * not wipe the second's working set.
 */
export function retainCaches(): () => void {
	cacheRetainCount++;
	let released = false;

	return () => {
		// Idempotent: hosts double-invoke teardown (React StrictMode, double unmount), and a second
		// call must not decrement the count on another viewer's behalf.
		if (released) return;
		released = true;
		cacheRetainCount--;
		if (cacheRetainCount <= 0) {
			cacheRetainCount = 0;
			releaseAllCaches();
		}
	};
}
