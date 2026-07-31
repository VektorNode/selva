import * as THREE from 'three';

import {
	CACHED_TEXTURE_USERDATA_FLAG,
	getLogger,
	observeMaxAnisotropy,
	registerCacheRelease
} from '../../shared/index.js';

/**
 * Bound on the module-level texture cache; a fresh load past this evicts the least-recently-used
 * entry and disposes its GPU texture. Sized generously above any realistic per-scene texture count,
 * so eviction only ever trims textures no current scene references.
 */
export const TEXTURE_CACHE_MAX_ENTRIES = 64;

/**
 * Cache keys longer than this are replaced by a compact hash — multi-KB/MB data URIs would
 * otherwise be retained as the Map key for as long as the texture lives.
 */
const MAX_KEY_LENGTH = 256;

/**
 * Material texture references are immutable by construction (content-hashed asset URLs, self-
 * identifying http(s)/data URIs), so each URL is fetched and GPU-decoded exactly once per session
 * no matter how many solves or materials reference it — without this, every solve would re-decode
 * every texture on every slider nudge.
 *
 * The Map doubles as the LRU order: hits re-insert their entry, so iteration order is
 * least-recently-used first and eviction pops the first key.
 */
const textureCache = new Map<string, THREE.Texture>();
const inFlight = new Map<string, Promise<THREE.Texture>>();

/**
 * Bumped by {@link clearTextureCache}. A load that started before a clear compares its captured
 * generation on resolve: if stale, the freshly decoded texture is disposed instead of repopulating
 * the just-emptied cache (which would leak it past viewer teardown).
 */
let cacheGeneration = 0;

/** Expected during viewer teardown, so {@link applyTextureMap} swallows it silently instead of warning. */
class StaleTextureLoadError extends Error {
	constructor(url: string) {
		super(`Texture load for ${url} resolved after clearTextureCache(); texture disposed.`);
		this.name = 'StaleTextureLoadError';
	}
}

/**
 * Anisotropic-filtering samples applied to color maps, keeping textures sharp at grazing angles
 * instead of blurring. Ceiling is hardware-defined (`renderer.capabilities.getMaxAnisotropy()`,
 * typically 16). Defaults to three's default (1 — no anisotropy) until a renderer reports in.
 */
let maxAnisotropy = 1;

/**
 * Subscribed to the renderer's own report below, so no host wiring is needed; still exported for a
 * host embedding a foreign renderer that wants to set it directly.
 */
export function setTextureAnisotropy(value: number): void {
	maxAnisotropy = Math.max(1, value);
	for (const texture of textureCache.values()) {
		if (texture.anisotropy !== maxAnisotropy) {
			texture.anisotropy = maxAnisotropy;
			texture.needsUpdate = true;
		}
	}
}

// Take the value straight from whichever renderer initializes, rather than depending on the host to
// forward it. `render/` publishes, this layer subscribes — neither imports the other.
observeMaxAnisotropy(setTextureAnisotropy);

/**
 * Assigns a texture to `material.map`, synchronously when cached, otherwise asynchronously once
 * fetched and decoded — the mesh renders untextured for at most the first frames. Load failures
 * log a warning and leave the material untextured rather than breaking the batch.
 */
export function applyTextureMap(material: THREE.MeshPhysicalMaterial, url: string): void {
	const key = cacheKeyFor(url);
	const cached = textureCache.get(key);
	if (cached) {
		// Refresh LRU recency: re-insert so this entry moves to the back of the eviction order.
		textureCache.delete(key);
		textureCache.set(key, cached);
		material.map = cached;
		material.needsUpdate = true;
		return;
	}

	// No DOM (SSR / tests): textures can't decode without an image element; skip quietly.
	if (typeof document === 'undefined') {
		return;
	}

	loadTexture(url, key)
		.then((texture) => {
			material.map = texture;
			material.needsUpdate = true;
		})
		.catch((error) => {
			if (error instanceof StaleTextureLoadError) {
				return; // Cache cleared mid-load (teardown/reset) — untextured is the intended state.
			}
			getLogger().warn(`Failed to load material texture ${url}:`, error);
		});
}

// Declare this cache to the teardown registry, so the viewer's dispose() frees it without the
// render layer importing this one and without any host wiring. See shared/gpu-ownership.ts.
registerCacheRelease(() => clearTextureCache());

/**
 * Disposes all cached textures and empties the cache (e.g. on viewer teardown). Loads still in
 * flight are orphaned: when they resolve they see the bumped generation, dispose their texture,
 * and do not repopulate the cache.
 */
export function clearTextureCache(): void {
	cacheGeneration++;
	for (const texture of textureCache.values()) {
		delete texture.userData[CACHED_TEXTURE_USERDATA_FLAG];
		texture.dispose();
	}
	textureCache.clear();
	inFlight.clear();
}

/** Short URLs key by themselves; oversized ones hash (see MAX_KEY_LENGTH). The `data-uri:` prefix
 *  keeps hashed keys disjoint from literal URL keys. */
function cacheKeyFor(url: string): string {
	if (url.length <= MAX_KEY_LENGTH) {
		return url;
	}
	return `data-uri:${fnv1aString(url).toString(16)}:${url.length}`;
}

/** 32-bit FNV-1a over the string's UTF-16 code units. */
function fnv1aString(s: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		hash ^= s.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function storeTexture(key: string, texture: THREE.Texture): void {
	// Claim ownership before the texture can reach a material. A cached texture is assigned straight
	// onto `material.map` and shared by every material using that URL, so without this flag the first
	// material sweep to reach one would dispose a texture the cache still holds — and then serve the
	// disposed texture to the next mesh that asks for it. Cleared on eviction, below.
	texture.userData[CACHED_TEXTURE_USERDATA_FLAG] = true;

	textureCache.set(key, texture);
	while (textureCache.size > TEXTURE_CACHE_MAX_ENTRIES) {
		const oldestKey = textureCache.keys().next().value as string;
		const evicted = textureCache.get(oldestKey)!;
		textureCache.delete(oldestKey);
		// Release the claim first: an evicted texture may still be attached to a live material, and
		// the scene that owns that material should be free to dispose it from here on.
		delete evicted.userData[CACHED_TEXTURE_USERDATA_FLAG];
		evicted.dispose();
	}
}

function loadTexture(url: string, key: string): Promise<THREE.Texture> {
	let pending = inFlight.get(key);
	if (!pending) {
		const generation = cacheGeneration;
		pending = new Promise<THREE.Texture>((resolve, reject) => {
			new THREE.TextureLoader().load(
				url,
				(texture) => {
					if (generation !== cacheGeneration) {
						// clearTextureCache() ran while this load was in flight: the cache (and the
						// viewer that wanted this texture) is gone. Repopulating would leak a live GPU
						// texture past teardown, so dispose it and reject as stale.
						texture.dispose();
						reject(new StaleTextureLoadError(url));
						return;
					}
					// Color maps are sRGB; without this the render is washed out.
					texture.colorSpace = THREE.SRGBColorSpace;
					// Keep textures crisp at grazing angles (see maxAnisotropy).
					texture.anisotropy = maxAnisotropy;
					storeTexture(key, texture);
					inFlight.delete(key);
					resolve(texture);
				},
				undefined,
				(error) => {
					// Guard: a failure resolving after a clear must not delete a *newer* in-flight entry.
					if (generation === cacheGeneration) {
						inFlight.delete(key);
					}
					reject(error);
				}
			);
		});
		inFlight.set(key, pending);
	}

	return pending;
}
