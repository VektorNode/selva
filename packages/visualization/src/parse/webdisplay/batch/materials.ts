import * as THREE from 'three';

import { OWN_ENV_MAP_INTENSITY, parseColor } from '../../../shared/index.js';

import { applyTexture } from '../apply-texture.js';

import type { MaterialAppearanceOptions, SerializableMaterial } from '../types.js';

// A near-pure metal has no diffuse response, so under the low-IBL 'technical' look it goes flat and
// reads as painted card. Real architectural sheet metal is coated, not a bare mirror, so meaningfully
// metallic materials get a thin satin clearcoat — a glossy dielectric layer independent of base
// metalness/envMap, so folds catch light even when the IBL is dialed down. A wire material that sets
// `clearcoat` (0 for bare copper or zinc) replaces this default.
const METAL_CLEARCOAT_THRESHOLD = 0.5;
const METAL_CLEARCOAT = 0.5;
const METAL_CLEARCOAT_ROUGHNESS = 0.3;

// Pushes surfaces back by a fraction of their own depth slope so crease edges keep their full width:
// an edge line is a screen-space quad at the edge's depth, and without this the face on its near
// side covers half of it. The same push lets anything just behind a grazing surface show through,
// and that gap grows with distance. Measured on a 1 mm sheet with parts 1 mm behind it: 0.5 bled
// from ~2 m, 0.25 from ~5 m with crease lines barely thinner, 0 only past ~10 m but halved lines.
const SURFACE_OFFSET_FACTOR = 0.25;

interface MaterialOptions {
	vertexColors?: boolean;
	hasUvs?: boolean;
	appearance?: MaterialAppearanceOptions;
	/** Every mesh drawn with this material is a closed solid: see `isClosedSolid`. */
	closed?: boolean;
}

// Transparent solids keep both sides: their far wall is meant to show through the near one.
function cullsBackFaces(matData: SerializableMaterial, options?: MaterialOptions): boolean {
	if (options?.appearance?.cullBackfaces) return true;
	return (options?.closed ?? false) && !matData.transparent && matData.opacity >= 1;
}

/**
 * Builds each wire material on first use, once per side it's needed on. `side` is per material, so
 * one material shared by closed solids and open surfaces becomes two instances.
 */
export type MaterialPicker = (materialId: number, closed: boolean) => THREE.Material;

export function createMaterialPicker(
	materialsSrc: SerializableMaterial[],
	options: Omit<MaterialOptions, 'closed'>
): MaterialPicker {
	const built = new Map<string, THREE.Material>();
	return (materialId, closed) => {
		const matData = materialsSrc[materialId]!;
		const culled = cullsBackFaces(matData, { ...options, closed });
		const key = `${materialId}:${culled}`;
		let material = built.get(key);
		if (!material) {
			material = createMaterial(matData, { ...options, closed: culled });
			built.set(key, material);
		}
		return material;
	};
}

export function createMaterial(
	matData: SerializableMaterial,
	options?: MaterialOptions
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
		// Open surfaces need both sides; a closed solid's back faces are never visible and only
		// z-fight with its front ones.
		side: cullsBackFaces(matData, options) ? THREE.FrontSide : THREE.DoubleSide,
		polygonOffset: true,
		polygonOffsetFactor: SURFACE_OFFSET_FACTOR,
		polygonOffsetUnits: 0,
		depthWrite: true,
		depthTest: true
	});

	// HDR image-based-lighting reflection strength. The material's own value beats the look's, so a
	// metal stays reflective in a dim look; otherwise three's default (1) unless the look dials it.
	if (matData.envMapIntensity != null) {
		material.envMapIntensity = matData.envMapIntensity;
		material.userData[OWN_ENV_MAP_INTENSITY] = matData.envMapIntensity;
	} else if (appearance?.envMapIntensity != null) {
		material.envMapIntensity = appearance.envMapIntensity;
	}

	const isMetal = matData.metalness > METAL_CLEARCOAT_THRESHOLD;
	const clearcoat = matData.clearcoat ?? (isMetal ? METAL_CLEARCOAT : undefined);
	if (clearcoat != null) {
		material.clearcoat = clearcoat;
		material.clearcoatRoughness =
			matData.clearcoatRoughness ?? (isMetal ? METAL_CLEARCOAT_ROUGHNESS : 0);
	}

	// three builds the anisotropy tangent from UV derivatives; without a `uv` attribute it normalizes
	// a zero vector and the mesh renders NaN-black.
	if (matData.anisotropy != null && matData.anisotropy > 0 && options?.hasUvs) {
		material.anisotropy = matData.anisotropy;
		material.anisotropyRotation = matData.anisotropyRotation ?? 0;
	}

	if (vertexColors) {
		applyVertexColorSRGBDecode(material);
	}

	// Async; the mesh renders without them until each image decodes.
	if (matData.map) applyTexture(material, matData.map, 'map');
	if (matData.roughnessMap) applyTexture(material, matData.roughnessMap, 'roughnessMap');
	if (matData.normalMap) applyTexture(material, matData.normalMap, 'normalMap');

	return material;
}

/**
 * three.js uploads vertex colors verbatim and multiplies them straight into linear working space
 * (unlike textures, which carry a `colorSpace` and get decoded) — so sRGB-authored vertex colors
 * render too bright without this shader patch. Done on the GPU rather than a CPU pass over the
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
