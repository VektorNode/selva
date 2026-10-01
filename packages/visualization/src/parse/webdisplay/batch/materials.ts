import * as THREE from 'three';

import { OWN_ENV_MAP_INTENSITY, lookEnvMapIntensity, parseColor } from '../../../shared/index.js';

import { applyTexture } from '../apply-texture.js';

import type { MaterialAppearanceOptions, SerializableMaterial } from '../types.js';

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

	// The material's own value beats the look's; otherwise three's default (1) unless the look dials it.
	if (matData.envMapIntensity != null) {
		material.envMapIntensity = matData.envMapIntensity;
		material.userData[OWN_ENV_MAP_INTENSITY] = matData.envMapIntensity;
	} else if (appearance?.envMapIntensity != null) {
		material.envMapIntensity = lookEnvMapIntensity(appearance.envMapIntensity, matData.metalness);
	}

	if (matData.clearcoat != null) {
		material.clearcoat = matData.clearcoat;
		material.clearcoatRoughness = matData.clearcoatRoughness ?? 0;
	}

	// The anisotropy tangent comes from the UVs; without them three normalizes a zero vector and the
	// mesh renders NaN-black.
	if (matData.anisotropy != null && matData.anisotropy > 0 && options?.hasUvs) {
		material.anisotropy = matData.anisotropy;
		material.anisotropyRotation = matData.anisotropyRotation ?? 0;
	}

	if (matData.transmission != null) {
		material.transmission = matData.transmission;
		// A pane, not a lens: no thickness, so nothing behind it refracts sideways.
		material.thickness = 0;
	}
	if (matData.ior != null) material.ior = matData.ior;

	if (vertexColors) {
		applyVertexColorSRGBDecode(material);
	}

	if (matData.finish && options?.hasUvs) {
		applyFinish(material, matData.finish);
	}

	// Async; the mesh renders without them until each image decodes.
	const { mapSize } = matData;
	if (matData.map) applyTexture(material, matData.map, 'map', mapSize);
	if (matData.roughnessMap) applyTexture(material, matData.roughnessMap, 'roughnessMap', mapSize);
	if (matData.normalMap) applyTexture(material, matData.normalMap, 'normalMap', mapSize);

	return material;
}

type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/**
 * Chains `patch` after any earlier one. three caches compiled programs by `customProgramCacheKey`,
 * which defaults to the `onBeforeCompile` source; a chained wrapper's source is the same whatever
 * it wraps, so every patch must extend the key or two materials would share one program.
 */
function addShaderPatch(material: THREE.Material, key: string, patch: ShaderPatch): void {
	const previous = material.onBeforeCompile;
	const previousKey = material.customProgramCacheKey.bind(material);
	material.onBeforeCompile = (shader, renderer) => {
		previous.call(material, shader, renderer);
		patch(shader);
	};
	material.customProgramCacheKey = () => `${previousKey()}|${key}`;
}

/**
 * three.js uploads vertex colors verbatim and multiplies them straight into linear working space
 * (unlike textures, which carry a `colorSpace` and get decoded) — so sRGB-authored vertex colors
 * render too bright without this shader patch. Done on the GPU rather than a CPU pass over the
 * buffer, to keep the hot per-solve parse cheap.
 */
export function applyVertexColorSRGBDecode(material: THREE.Material): void {
	addShaderPatch(material, 'srgb-vertex-colors', (shader) => {
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
	});
}

// Two octaves of streaks per finish: spacing across the grain in mm, and how far each scales
// roughness either way. Starting points, to be tuned against photos of real sheet.
const FINISH_OCTAVES: Record<NonNullable<SerializableMaterial['finish']>, [number, number][]> = {
	brushed: [
		[0.05, 0.3],
		[0.5, 0.2]
	],
	rolled: [
		[4, 0.1],
		[30, 0.08]
	]
};

/**
 * Roughness streaks along the grain, generated from V (across it, in mm), so they need no texture
 * and never tile. Each octave fades out once a pixel spans a streak: finer than that it only
 * shimmers while the camera moves.
 */
function applyFinish(
	material: THREE.MeshPhysicalMaterial,
	finish: NonNullable<SerializableMaterial['finish']>
): void {
	const octaves = FINISH_OCTAVES[finish];
	if (!octaves) return;
	// `vUv` exists only with a map or anisotropy; a finish needs it either way.
	material.defines = { ...material.defines, USE_UV: '' };
	const sum = octaves
		.map(
			([spacing, amplitude]) =>
				`selvaOctave( v, footprint, ${spacing.toFixed(4)}, ${amplitude.toFixed(4)} )`
		)
		.join(' + ');
	addShaderPatch(material, `finish:${finish}`, (shader) => {
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				float selvaHash( float n ) {
					n = fract( n * 0.1031 );
					n *= n + 33.33;
					n *= n + n;
					return fract( n );
				}
				float selvaNoise( float x ) {
					float i = floor( x );
					float f = fract( x );
					return mix( selvaHash( i ), selvaHash( i + 1.0 ), f * f * ( 3.0 - 2.0 * f ) );
				}
				float selvaOctave( float v, float footprint, float spacing, float amplitude ) {
					float fade = 1.0 - smoothstep( 0.25, 1.0, footprint / spacing );
					return amplitude * fade * ( selvaNoise( v / spacing ) * 2.0 - 1.0 );
				}`
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
				{
					float v = vUv.y;
					float footprint = fwidth( v );
					roughnessFactor = clamp( roughnessFactor * ( 1.0 + ${sum} ), 0.0, 1.0 );
				}`
			);
	});
}
