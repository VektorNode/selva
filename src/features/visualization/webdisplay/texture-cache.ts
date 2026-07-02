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
