import * as THREE from 'three';

import { parseColor } from '../../../shared/index.js';

import { applyTextureMap } from '../apply-texture.js';

import type { MaterialAppearanceOptions, SerializableMaterial } from '../types.js';

// A near-pure metal has no diffuse response, so under the low-IBL 'technical' look it goes flat and
// reads as painted card. Real architectural sheet metal is coated, not a bare mirror, so materials
// meaningfully metallic get a thin satin clearcoat — a glossy dielectric layer independent of the
// base metalness/envMap, so folds catch light even when the IBL is dialed down.
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
		// Minimal offset to avoid z-fighting on coplanar faces
		polygonOffset: true,
		polygonOffsetFactor: 0.5,
		polygonOffsetUnits: 0.5,
		depthWrite: true,
		depthTest: true
	});

	// HDR image-based-lighting reflection strength. Left at three's default (1) unless the caller
	// dials it: <1 flattens reflections toward a matte/technical read, >1 pushes a glossier look.
	if (appearance?.envMapIntensity != null) {
		material.envMapIntensity = appearance.envMapIntensity;
	}

	// See the constants above. Plastics/matte fall below the threshold and stay bare.
	if (matData.metalness > METAL_CLEARCOAT_THRESHOLD) {
		material.clearcoat = METAL_CLEARCOAT;
		material.clearcoatRoughness = METAL_CLEARCOAT_ROUGHNESS;
	}

	// See applyVertexColorSRGBDecode for why this is needed.
	if (vertexColors) {
		applyVertexColorSRGBDecode(material);
	}

	// Async; the mesh renders untextured until the image decodes.
	if (matData.map) {
		applyTextureMap(material, matData.map);
	}

	return material;
}

/**
 * three.js uploads vertex colors verbatim and multiplies them straight into the linear working
 * space (unlike textures, which carry a `colorSpace` and get decoded) — so sRGB-authored vertex
 * colors render too bright without this shader patch. Done on the GPU, not a CPU pass over the
 * buffer, to keep the hot per-solve parse cheap.
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
