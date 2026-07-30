import type * as THREE from 'three';

// ============================================================================
// GPU resource ownership — the single rule every disposal path obeys
// ============================================================================

/**
 * Who may free a GPU resource, in one place.
 *
 * **Why this module exists.** Two leaks in one week, both the same shape: a cache claimed ownership
 * of a GPU resource, and a disposal walker that had never heard of that claim freed it anyway (or
 * failed to free what nobody owned). The claims were real and documented — in the cache's own
 * docblock, which the walker's author had no reason to read.
 *
 * - **F1** (edge line-geometry): `clearScene` detached overlays without decrementing refcounts, so
 *   nothing ever freed them once the geometry cache started keeping source geometries reachable.
 * - **C1** (memo clone): `BufferGeometry.clone()` copies `userData` by reference, so clones carried
 *   the cache-owned flag and were never freed.
 * - **The texture case** (found 2026-07-30 auditing the above): cache-owned textures are assigned
 *   straight onto materials (`material.map = cached`), and *every* material sweep disposed them
 *   unconditionally — freeing a texture the cache still held and served to other materials.
 *
 * The pattern is not "someone wrote a bug". It is that **ownership was expressed as prose in three
 * separate caches and enforced by four separate traversals**, so each new walker had to rediscover
 * three rules. This module inverts that: ownership is declared here, and walkers ask rather than
 * remember.
 *
 * **The rule, stated once.** A GPU resource has exactly one owner:
 * - a **cache** owns it → the cache frees it on eviction, nobody else ever;
 * - a **module singleton** owns it → nobody frees it, ever;
 * - otherwise the **scene** owns it → whoever tears the scene down frees it.
 *
 * So every disposal path is the same two lines: ask {@link canDisposeGeometry} /
 * {@link canDisposeMaterial} / {@link canDisposeTexture}, and dispose only if the answer is yes.
 * Adding a fifth cache means adding a claim here, not auditing every walker again.
 */

/**
 * `geometry.userData` tag marking a geometry owned by the cross-solve geometry cache
 * (`parse/webdisplay/geometry-cache.ts`). The cache keeps these alive — GPU buffers included — so
 * the next solve can reuse them, and disposes them itself on eviction.
 *
 * Prefer {@link canDisposeGeometry} over reading this flag directly; the flag is exported because
 * the cache must set and clear it, not so callers can re-implement the check.
 */
export const CACHED_GEOMETRY_USERDATA_FLAG = 'selvaGeometryCache';

/**
 * `texture.userData` tag marking a texture owned by the cross-solve texture cache
 * (`parse/webdisplay/texture-cache.ts`).
 *
 * Needed because a cached texture is assigned directly onto materials (`material.map = cached`) and
 * is shared by every material using that URL. Without this, the first material sweep to reach one
 * frees a texture the cache still holds — and the cache then serves a disposed texture to the next
 * mesh that wants it.
 */
export const CACHED_TEXTURE_USERDATA_FLAG = 'selvaTextureCache';

/**
 * Materials that must never be disposed: the module-scope singletons in `render/three-materials.ts`,
 * shared across meshes and across solves. Disposing one frees textures still referenced by surviving
 * objects and forces a shader recompile on its next use.
 *
 * Registered at module init by the material module itself, so this module needs no import of it (and
 * no cycle). Consult it via {@link canDisposeMaterial}.
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
 * Register a cache's "free everything you hold" function.
 *
 * Caches that hold GPU resources outlive any single scene — that is the point of them — but they do
 * **not** outlive the WebGL context, and nothing else is permitted to free them (that is what the
 * ownership claims above guarantee). So teardown has to free them, and teardown must not need a list
 * of which caches exist.
 *
 * This is why registration is a push, not a pull: a cache declares itself here at module init, and
 * `initThree`'s `dispose()` drains the registry. `render/` therefore frees `parse/`'s caches without
 * importing `parse/` — the layer rule holds, and adding a fifth cache requires no edit to teardown
 * and no host wiring.
 */
export function registerCacheRelease(release: () => void): void {
	cacheReleases.add(release);
}

/**
 * Free every registered cache. Failures are contained: one throwing cache must not strand the rest.
 *
 * Prefer {@link retainCaches} in a viewer — these caches are shared across viewers, so a bare call
 * here while another viewer is live throws away entries it is still using (correct, since they
 * repopulate, but wasteful).
 */
export function releaseAllCaches(): void {
	for (const release of cacheReleases) {
		try {
			release();
		} catch {
			// A cache that fails to clear must not prevent the rest from clearing, and teardown has
			// no sink to report to — the context is already gone.
		}
	}
}

/** Live viewers holding the caches open. The caches are module-level, so they are shared. */
let cacheRetainCount = 0;

/**
 * Claim the shared caches for the lifetime of one viewer. Returns the release function, which frees
 * every registered cache **only once the last viewer has released** them.
 *
 * Refcounted because the caches are module-level and therefore shared: two viewers on one page
 * (a main view and a thumbnail, say) use the same geometry and texture entries, and the first to
 * unmount must not wipe the second's working set. The last one out frees everything, which is what
 * keeps buffers from outliving the GL contexts they belong to.
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
