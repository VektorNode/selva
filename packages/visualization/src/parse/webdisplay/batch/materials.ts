import * as THREE from 'three';

import { parseColor } from '../../../shared/index.js';

import { applyTextureMap } from '../texture-cache.js';

import type { MaterialAppearanceOptions, SerializableMaterial } from '../types.js';

// A near-pure metal has no diffuse response, so under the low-IBL 'technical' look it goes flat and
// reads as painted card. Real architectural sheet metal is coated, not a bare mirror — so materials
// that are meaningfully metallic get a thin satin clearcoat: a glossy dielectric layer whose
// highlight and environment response are independent of the base metalness/envMap, so folds catch
// light even when the IBL is dialed down. Below this metalness the material is treated as
// plastic/matte and left untouched.
const METAL_CLEARCOAT_THRESHOLD = 0.5;
const METAL_CLEARCOAT = 0.5;
const METAL_CLEARCOAT_ROUGHNESS = 0.3;

export function createMaterial(
	matData: SerializableMaterial,
	options?: { vertexColors?: boolean; appearance?: MaterialAppearanceOptions }
): THREE.MeshPhysicalMaterial {
	const color = parseColor(matData.color);
	const vertexColors = options?.vertexColors ?? false;
	const appearance = options?.appearance;

	const material = new THREE.MeshPhysicalMaterial({
		color,
		metalness: matData.metalness,
		roughness: matData.roughness,
		opacity: matData.opacity,
		transparent: matData.transparent,
		vertexColors,
		// Cull back faces for closed solids (crisper silhouette, less overdraw); keep both sides for
		// open surfaces. Caller-controlled since Rhino emits both — default DoubleSide is the safe read.
		side: appearance?.cullBackfaces ? THREE.FrontSide : THREE.DoubleSide,
		// Reduced polygon offset to minimize artifacts
		// Only use minimal offset to prevent z-fighting on coplanar faces
		polygonOffset: true,
		polygonOffsetFactor: 0.5,
		polygonOffsetUnits: 0.5,
		// Improve depth rendering
		depthWrite: true,
		depthTest: true
	});

	// HDR image-based-lighting reflection strength. Left at three's default (1) unless the caller
	// dials it: <1 flattens reflections toward a matte/technical read, >1 pushes a glossier look.
	if (appearance?.envMapIntensity != null) {
		material.envMapIntensity = appearance.envMapIntensity;
	}

	// Metals get a satin clearcoat so coated sheet metal reads as coated, not flat, under low IBL
	// (see the constants above). Plastics/matte fall below the threshold and stay bare.
	if (matData.metalness > METAL_CLEARCOAT_THRESHOLD) {
		material.clearcoat = METAL_CLEARCOAT;
		material.clearcoatRoughness = METAL_CLEARCOAT_ROUGHNESS;
	}

	// Vertex colors arrive as raw sRGB bytes, but three's vertex-color path multiplies them into the
	// (linear) working space with no decode — so they render washed out. Patch the vertex shader to
	// sRGB→linear decode `color` before use. Only meshes with real vertex colors take this path.
	if (vertexColors) {
		applyVertexColorSRGBDecode(material);
	}

	// Texture loading is async (image decode); the cache assigns `material.map` when ready and
	// flags needsUpdate, so the mesh renders untextured for at most the first frames. Hash-keyed
	// asset URLs are immutable, so each texture is fetched and decoded once per session.
	if (matData.map) {
		applyTextureMap(material, matData.map);
	}

	return material;
}

/**
 * Patch a material's vertex shader to decode its per-vertex `color` attribute from sRGB to linear.
 * three.js uploads vertex colors verbatim and its `color_vertex` chunk multiplies them straight into
 * the linear working color space (unlike textures, which carry a `colorSpace` and get decoded) — so
 * sRGB-authored vertex colors render too bright without this. Done in the shader (not a CPU pass over
 * the buffer) to keep the hot per-solve parse cheap; the decode is a handful of GPU ops per vertex.
 */
export function applyVertexColorSRGBDecode(material: THREE.Material): void {
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			'#include <color_vertex>',
			`#include <color_vertex>
			#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
				vColor.rgb = mix(
					vColor.rgb / 12.92,
					pow( ( vColor.rgb + 0.055 ) / 1.055, vec3( 2.4 ) ),
					step( vec3( 0.04045 ), vColor.rgb )
				);
			#endif`
		);
	};
}
