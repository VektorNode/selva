import * as THREE from 'three';

import { getLogger } from '@/core';

// ============================================================================
// TEXTURE CACHE
// ============================================================================

/**
 * Module-level texture cache keyed by URL.
 *
 * Material texture references are immutable by construction — the plugin serves bitmap/file
 * textures at content-hashed URLs (`/assets/{hash}`) and http(s)/data URIs identify their own
 * content — so each URL is fetched and GPU-decoded exactly once per session no matter how many
 * solves or materials reference it. Selva's hot loop re-parses batches on every slider nudge;
 * without this cache every solve would re-decode every texture.
 */
const textureCache = new Map<string, THREE.Texture>();
const inFlight = new Map<string, Promise<THREE.Texture>>();

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
 * than breaking the batch.
 */
export function applyTextureMap(material: THREE.MeshPhysicalMaterial, url: string): void {
	const cached = textureCache.get(url);
	if (cached) {
		material.map = cached;
		material.needsUpdate = true;
		return;
	}

	// No DOM (SSR / tests): textures can't decode without an image element; skip quietly.
	if (typeof document === 'undefined') {
		return;
	}

	loadTexture(url)
		.then((texture) => {
			material.map = texture;
			material.needsUpdate = true;
		})
		.catch((error) => {
			getLogger().warn(`Failed to load material texture ${url}:`, error);
		});
}

/** Disposes all cached textures and empties the cache (e.g. on viewer teardown). */
export function clearTextureCache(): void {
	for (const texture of textureCache.values()) {
		texture.dispose();
	}
	textureCache.clear();
	inFlight.clear();
}

function loadTexture(url: string): Promise<THREE.Texture> {
	let pending = inFlight.get(url);
	if (!pending) {
		pending = new Promise<THREE.Texture>((resolve, reject) => {
			new THREE.TextureLoader().load(
				url,
				(texture) => {
					// Color maps are sRGB; without this the render is washed out.
					texture.colorSpace = THREE.SRGBColorSpace;
					// Keep textures crisp at grazing angles (see maxAnisotropy).
					texture.anisotropy = maxAnisotropy;
					textureCache.set(url, texture);
					inFlight.delete(url);
					resolve(texture);
				},
				undefined,
				(error) => {
					inFlight.delete(url);
					reject(error);
				}
			);
		});
		inFlight.set(url, pending);
	}

	return pending;
}
