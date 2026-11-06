import * as THREE from 'three';

import {
	EMISSIVE_LIGHT,
	GLASS,
	OWN_EMISSIVE,
	OWN_ENV_MAP_INTENSITY,
	lookEnvMapIntensity,
	parseColor
} from '../../../shared/index.js';

import { applyTexture } from '../apply-texture.js';
import { finishPatch, type ShaderPatch } from './finish.js';

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

// Transparent solids keep both sides: their far wall is meant to show through the near one. A
// closed glass pane culls its far face anyway: drawn, the pane reflects twice and goes milky.
function cullsBackFaces(matData: SerializableMaterial, options?: MaterialOptions): boolean {
	if (options?.appearance?.cullBackfaces) return true;
	return (options?.closed ?? false) && !matData.transparent && matData.opacity >= 1;
}

// Above this roughness, glass and clear plastic read as frosted. Frosting blurs what is behind, and
// only transmission can do that; blending shows it sharp.
const FROSTED = 0.2;

function isPane(matData: SerializableMaterial): boolean {
	return (
		(matData.transmission ?? 0) > 0 &&
		!((matData.thickness ?? 0) > 0) &&
		matData.roughness < FROSTED
	);
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
		material.envMapIntensity = lookEnvMapIntensity(
			appearance.envMapIntensity,
			matData.metalness,
			appearance.metalReflection
		);
	}

	if (matData.emissive != null) {
		material.emissive.set(matData.emissive);
		material.emissiveIntensity = matData.emissiveIntensity ?? 1;
		material.userData[OWN_EMISSIVE] = true;
		if (matData.emissiveLight != null) material.userData[EMISSIVE_LIGHT] = matData.emissiveLight;
	}

	if (matData.clearcoat != null) {
		material.clearcoat = matData.clearcoat;
		material.clearcoatRoughness = matData.clearcoatRoughness ?? 0;
	}

	if (matData.sheen != null && matData.sheen > 0) {
		material.sheen = matData.sheen;
		material.sheenColor.set(matData.sheenColor ?? '#ffffff');
		material.sheenRoughness = matData.sheenRoughness ?? 0.5;
	}

	// The anisotropy tangent comes from the UVs; without them three normalizes a zero vector and the
	// mesh renders NaN-black.
	// three stretches highlights along its anisotropy direction. Grooves along the grain tilt the
	// normal only across it, so that is where reflections smear: a quarter turn off U.
	if (matData.anisotropy != null && matData.anisotropy > 0 && options?.hasUvs) {
		material.anisotropy = matData.anisotropy;
		material.anisotropyRotation = (matData.anisotropyRotation ?? 0) + Math.PI / 2;
	}

	if (matData.ior != null) material.ior = matData.ior;
	if (matData.transmission != null && matData.transmission > 0) applyGlass(material, matData);

	if (matData.metalness > 0) dimSunOnMetal(material);

	if (vertexColors) {
		applyVertexColorSRGBDecode(material);
	}

	const finish =
		matData.finish && options?.hasUvs
			? finishPatch(matData.finish, matData.finishStrength ?? 1)
			: null;
	if (finish) {
		// `vUv` exists only with a map or anisotropy; a finish needs it either way.
		material.defines = { ...material.defines, USE_UV: '' };
		addShaderPatch(material, finish.key, finish.patch);
	}

	// Async; the mesh renders without them until each image decodes.
	const { mapSize } = matData;
	if (matData.map) applyTexture(material, matData.map, 'map', mapSize);
	if (matData.roughnessMap) applyTexture(material, matData.roughnessMap, 'roughnessMap', mapSize);
	if (matData.normalMap) applyTexture(material, matData.normalMap, 'normalMap', mapSize);

	return material;
}

// The sun's highlight on fully metallic surfaces, as a share of its own. A metal shows the studio
// probe's softboxes as its highlights already; the sun's on top spreads over a whole flat sheet facing
// it and clips it to white, taking the metal's colour with it.
const SUN_ON_METAL = 0.1;

// Where the directional lights (the sun) start and stop in three's light loop.
const SUN_BEGIN = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const SUN_END = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';

/** Scales the directional lights' specular by metalness; point lights keep theirs. */
export function dimSunOnMetal(material: THREE.Material): void {
	addShaderPatch(material, 'sun-on-metal', (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <lights_fragment_begin>',
			THREE.ShaderChunk.lights_fragment_begin
				.replace(
					SUN_BEGIN,
					`vec3 specularBeforeSun = reflectedLight.directSpecular;
${SUN_BEGIN}`
				)
				.replace(
					SUN_END,
					`reflectedLight.directSpecular = specularBeforeSun + ( reflectedLight.directSpecular - specularBeforeSun ) * mix( 1.0, ${SUN_ON_METAL.toFixed(2)}, metalnessFactor );
${SUN_END}`
				)
		);
	});
}

// The share of light a fully transmissive pane holds back: its own colour and haze, not reflection.
const PANE_BODY = 0.04;

/**
 * three's transmission draws every opaque object a second time into its own buffer each frame, and
 * that buffer never holds other glass: one pane seen through another vanishes. So only glass that
 * needs it gets it: with a thickness, to refract and tint, or frosted, to blur. A pane blends
 * instead: cheap, and panes stack.
 */
function applyGlass(material: THREE.MeshPhysicalMaterial, matData: SerializableMaterial): void {
	const transmission = Math.min(1, matData.transmission!);
	material.userData[GLASS] = true;

	if (!isPane(matData)) {
		const thickness = matData.thickness ?? 0;
		material.transmission = transmission;
		material.thickness = thickness;
		// Frosted glass with no thickness has no depth to tint through.
		if (matData.attenuationColor && thickness > 0) {
			material.attenuationColor.set(matData.attenuationColor);
			// The colour is what light has become after crossing the whole thickness.
			material.attenuationDistance = thickness;
			// three scales the ray through the glass to world units but not this distance, so a
			// model in mm, scaled to metres, would never tint. Scale it the same way.
			addShaderPatch(material, 'glass-attenuation', (shader) => {
				shader.fragmentShader = shader.fragmentShader.replace(
					'#include <transmission_fragment>',
					THREE.ShaderChunk.transmission_fragment.replace(
						'material.attenuationDistance = attenuationDistance;',
						'material.attenuationDistance = attenuationDistance * length( modelMatrix[ 0 ].xyz );'
					)
				);
			});
		}
		return;
	}

	material.transparent = true;
	material.opacity = matData.opacity * (1 - transmission * (1 - PANE_BODY));
	// Panes sort back to front; writing depth would hide a pane behind another one.
	material.depthWrite = false;
	// Plain alpha blending scales reflections by opacity too, leaving a pane with none. Blending
	// premultiplied, with only the body scaled, keeps them at full strength.
	material.blending = THREE.CustomBlending;
	material.blendSrc = THREE.OneFactor;
	material.blendDst = THREE.OneMinusSrcAlphaFactor;
	addShaderPatch(material, 'glass-pane', (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <opaque_fragment>',
			`vec3 paneSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
			gl_FragColor = vec4( ( outgoingLight - paneSpecular ) * diffuseColor.a + paneSpecular, diffuseColor.a );`
		);
	});
}

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
