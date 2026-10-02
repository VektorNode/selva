import * as THREE from 'three';

import { getLogger, observeMaxAnisotropy } from '../../shared/index.js';

/**
 * Anisotropic-filtering samples applied to material textures, keeping them sharp at grazing angles
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

export type TextureSlot = 'map' | 'roughnessMap' | 'normalMap';

/**
 * Assigns a texture to `material[slot]` once fetched and decoded — the mesh renders without it for
 * the first frames. Load failures log a warning and leave the slot empty rather than breaking the
 * batch.
 *
 * Each call loads independently: no caching, no cross-material sharing. The texture is owned by the
 * material it is assigned to, so the scene's normal dispose walk frees it like any other resource.
 */
export function applyTexture(
	material: THREE.MeshPhysicalMaterial,
	url: string,
	slot: TextureSlot,
	mapSize?: number
): void {
	// No DOM (SSR / tests): textures can't decode without an image element; skip quietly.
	if (typeof document === 'undefined') {
		return;
	}

	new THREE.TextureLoader().load(
		url,
		(texture) => {
			// Color maps are sRGB (without this the render is washed out); roughness and normal maps
			// are data and must stay linear.
			texture.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
			texture.anisotropy = maxAnisotropy;
			if (mapSize) {
				// UVs are in mm: one repeat per mapSize across, the image's aspect down.
				const image = texture.image as { width?: number; height?: number } | undefined;
				const aspect = image?.width && image.height ? image.height / image.width : 1;
				texture.wrapS = THREE.RepeatWrapping;
				texture.wrapT = THREE.RepeatWrapping;
				texture.repeat.set(1 / mapSize, 1 / (mapSize * aspect));
			}
			material[slot] = texture;
			material.needsUpdate = true;
		},
		undefined,
		(error) => {
			getLogger().warn(`Failed to load material ${slot} ${url}:`, error);
		}
	);
}
