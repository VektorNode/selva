import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';

/**
 * Maximum number of decoded textures retained by the module-level cache. When a fresh load pushes
 * the cache past this bound, the least-recently-used entry is evicted and its GPU texture disposed.
 * Sized generously above any realistic per-scene texture count (a solve's materials re-touch their
 * textures on every re-parse, keeping live entries recent), so eviction only ever trims textures
 * that no current scene references — e.g. a workflow regenerating a data-URI texture per solve.
 */
export const TEXTURE_CACHE_MAX_ENTRIES = 64;

/**
 * Cache keys longer than this are replaced by a compact hash. Content-hashed asset URLs and normal
 * http(s) URLs stay comfortably below it; multi-KB/MB data URIs (whose full string would otherwise
 * be retained as the Map key for as long as the texture lives) exceed it and get hashed.
 */
const MAX_KEY_LENGTH = 256;

/**
 * Module-level texture cache keyed by URL (or a hash of it — see {@link cacheKeyFor}).
 *
 * Material texture references are immutable by construction — the plugin serves bitmap/file
 * textures at content-hashed URLs (`/assets/{hash}`) and http(s)/data URIs identify their own
 * content — so each URL is fetched and GPU-decoded exactly once per session no matter how many
 * solves or materials reference it. Selva's hot loop re-parses batches on every slider nudge;
 * without this cache every solve would re-decode every texture.
 *
 * The Map doubles as the LRU order: hits re-insert their entry, so iteration order is
 * least-recently-used first and eviction pops the first key.
 */
const textureCache = new Map<string, THREE.Texture>();
const inFlight = new Map<string, Promise<THREE.Texture>>();

/**
 * Bumped by {@link clearTextureCache}. A load that started before a clear compares its captured
 * generation on resolve: if the cache was cleared meanwhile, the freshly decoded texture is
 * disposed instead of repopulating the just-emptied cache (which would leak it past viewer
 * teardown and silently serve it to future materials despite the intended full reset).
 */
let cacheGeneration = 0;

/**
 * Rejection used when a load resolves after {@link clearTextureCache} wiped the cache. Expected
 * during viewer teardown, so {@link applyTextureMap} swallows it silently instead of warning.
 */
class StaleTextureLoadError extends Error {
	constructor(url: string) {
		super(`Texture load for ${url} resolved after clearTextureCache(); texture disposed.`);
		this.name = 'StaleTextureLoadError';
	}
}

/**
 * Max anisotropic-filtering samples applied to color maps, keeping textures sharp at grazing angles
 * (floors, long walls receding to the horizon) instead of blurring. The ceiling is hardware-defined
 * (`renderer.capabilities.getMaxAnisotropy()`, typically 16); the viewer reports it once at init via
 * {@link setTextureAnisotropy}. Defaults to 1 (three's default — no anisotropy) so the module is
 * correct even if the viewer never calls in.
 */
let maxAnisotropy = 1;

/**
 * Set the anisotropy applied to all color-map textures. Call once from the viewer with
 * `renderer.capabilities.getMaxAnisotropy()`. Retroactively updates already-cached textures so
 * textures decoded before this call still benefit.
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

/**
 * Assigns a texture to `material.map`, synchronously when cached, otherwise asynchronously once
 * the image is fetched and decoded (flagging `needsUpdate` — the mesh renders untextured for at
 * most the first frames). Load failures log a warning and leave the material untextured rather
 * than breaking the batch. A load that resolves after {@link clearTextureCache} is discarded
 * silently (its texture disposed) — the clear signals the viewer no longer wants it.
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

/**
 * Disposes all cached textures and empties the cache (e.g. on viewer teardown). Loads still in
 * flight are orphaned: when they resolve they see the bumped generation, dispose their texture,
 * and do not repopulate the cache.
 */
export function clearTextureCache(): void {
	cacheGeneration++;
	for (const texture of textureCache.values()) {
		texture.dispose();
	}
	textureCache.clear();
	inFlight.clear();
}

/**
 * Maps a texture URL to its cache key. Short URLs key by themselves; oversized ones (data URIs)
 * key by a 32-bit FNV-1a hash plus length so the multi-KB/MB URI string isn't retained as a Map
 * key. The `data-uri:` prefix keeps hashed keys disjoint from literal URL keys.
 */
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

/** Inserts a texture, evicting (and disposing) least-recently-used entries past the bound. */
function storeTexture(key: string, texture: THREE.Texture): void {
	textureCache.set(key, texture);
	while (textureCache.size > TEXTURE_CACHE_MAX_ENTRIES) {
		const oldestKey = textureCache.keys().next().value as string;
		const evicted = textureCache.get(oldestKey)!;
		textureCache.delete(oldestKey);
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
					// Guarded so a failure resolving after a clear can't delete a *newer* in-flight
					// entry for the same key (the clear already wiped this one).
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
