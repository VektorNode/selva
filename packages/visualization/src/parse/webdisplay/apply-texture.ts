import * as THREE from 'three';

import { getLogger, observeMaxAnisotropy } from '../../shared/index.js';

/**
 * Anisotropic-filtering samples applied to color maps, keeping textures sharp at grazing angles
 * instead of blurring. Ceiling is hardware-defined (`renderer.capabilities.getMaxAnisotropy()`,
 * typically 16). Defaults to three's default (1 — no anisotropy) until a renderer reports in.
 */
let maxAnisotropy = 1;

/**
 * Subscribed to the renderer's own report below, so no host wiring is needed; still exported for a
 * host embedding a foreign renderer that wants to set it directly. Applies to textures loaded from
 * here on — textures already decoded keep the value they were given.
 */
export function setTextureAnisotropy(value: number): void {
	maxAnisotropy = Math.max(1, value);
}

// Take the value straight from whichever renderer initializes, rather than depending on the host to
// forward it. `render/` publishes, this layer subscribes — neither imports the other.
observeMaxAnisotropy(setTextureAnisotropy);

/**
 * Assigns a texture to `material.map` once fetched and decoded — the mesh renders untextured for
 * the first frames. Load failures log a warning and leave the material untextured rather than
 * breaking the batch.
 *
 * Each call loads independently: no caching, no cross-material sharing. The texture is owned by the
 * material it is assigned to, so the scene's normal dispose walk frees it like any other resource.
 */
export function applyTextureMap(material: THREE.MeshPhysicalMaterial, url: string): void {
	// No DOM (SSR / tests): textures can't decode without an image element; skip quietly.
	if (typeof document === 'undefined') {
		return;
	}

	new THREE.TextureLoader().load(
		url,
		(texture) => {
			// Color maps are sRGB; without this the render is washed out.
			texture.colorSpace = THREE.SRGBColorSpace;
			// Keep textures crisp at grazing angles (see maxAnisotropy).
			texture.anisotropy = maxAnisotropy;
			material.map = texture;
			material.needsUpdate = true;
		},
		undefined,
		(error) => {
			getLogger().warn(`Failed to load material texture ${url}:`, error);
		}
	);
}
