import * as THREE from 'three';

import {
	OWN_EMISSIVE,
	OWN_ENV_MAP_INTENSITY,
	lookEnvMapIntensity,
	lookPreset,
	materialAppearanceForLook
} from '../../shared/index.js';
import { SOURCE_COMPUTE } from '../scene-ownership.js';
import { createEmissiveLights } from './emissive-lights.js';
import { applyReflectionEnvironment } from './reflection-environment.js';
import type {
	Look,
	LookMaterialOverride,
	LookPreset,
	MaterialAppearanceOptions
} from '../types.js';
import { defaultUp, type ResolvedOptions } from './defaults.js';
import type { PipelineController } from './pipeline-controller.js';
import type { SceneLights } from './setup-lighting.js';

/**
 * What a look overwrote, stashed on the material itself so it survives a look switch without a
 * side table keyed on materials the scene may dispose. Written once, on the first override.
 */
type MaterialBaseline = {
	color: number;
	metalness: number;
	roughness: number;
	emissiveIntensity: number;
	opacity: number;
	transparent: boolean;
	depthWrite: boolean;
	wireframe: boolean;
	side: THREE.Side;
};

const BASELINE_KEY = '__selvaLookBaseline';

type OverridableMaterial = THREE.Material & {
	color?: THREE.Color;
	metalness?: number;
	roughness?: number;
	emissiveIntensity?: number;
	wireframe?: boolean;
	[BASELINE_KEY]?: MaterialBaseline;
};

function applyBaseline(target: OverridableMaterial, baseline: MaterialBaseline): void {
	target.color?.setHex(baseline.color);
	if (target.metalness !== undefined) target.metalness = baseline.metalness;
	if (target.roughness !== undefined) target.roughness = baseline.roughness;
	if (target.emissiveIntensity !== undefined) target.emissiveIntensity = baseline.emissiveIntensity;
	target.opacity = baseline.opacity;
	target.transparent = baseline.transparent;
	target.depthWrite = baseline.depthWrite;
	if (target.wireframe !== undefined) target.wireframe = baseline.wireframe;
	target.side = baseline.side;
}

/** Restores the parsed values and forgets the baseline. No-op when nothing was overridden. */
function restoreBaseline(target: OverridableMaterial): void {
	const baseline = target[BASELINE_KEY];
	if (!baseline) return;
	applyBaseline(target, baseline);
	delete target[BASELINE_KEY];
}

/**
 * Applies a look's material overrides, or restores the parsed values when the look has none.
 * `needsUpdate` is set because switching `transparent` changes the shader program, not just a
 * uniform.
 *
 * Exported for tests: the leak this guards against is invisible until two overriding looks are
 * applied in sequence, which no single-look check catches.
 *
 * Every apply restores the baseline first, so an override only has to describe what *it* wants.
 * Without that reset, switching between two looks that both override leaves behind whatever the
 * previous one set and the new one is silent about — `wireframe` surviving out of the wireframe
 * look, or `opacity`/`depthWrite` surviving out of xray, since no other look mentions them.
 */
export function applyMaterialOverride(
	material: THREE.Material,
	override: LookMaterialOverride | undefined
): void {
	const target = material as OverridableMaterial;

	if (!override) {
		restoreBaseline(target);
		target.needsUpdate = true;
		return;
	}

	if (!target[BASELINE_KEY]) {
		target[BASELINE_KEY] = {
			color: target.color?.getHex() ?? 0xffffff,
			metalness: target.metalness ?? 0,
			roughness: target.roughness ?? 1,
			emissiveIntensity: target.emissiveIntensity ?? 0,
			opacity: target.opacity,
			transparent: target.transparent,
			depthWrite: target.depthWrite,
			wireframe: target.wireframe ?? false,
			side: target.side
		};
	} else {
		// Baseline captured by an earlier look — reset onto it so this override starts clean.
		applyBaseline(target, target[BASELINE_KEY]);
	}

	if (override.color !== undefined) target.color?.setHex(override.color);
	if (override.metalness !== undefined && target.metalness !== undefined) {
		target.metalness = override.metalness;
	}
	if (override.roughness !== undefined && target.roughness !== undefined) {
		target.roughness = override.roughness;
	}
	// Only the wire's glow: a selection tint uses the same channel and has to stay readable.
	if (override.emissiveIntensity !== undefined && target.userData[OWN_EMISSIVE]) {
		target.emissiveIntensity = override.emissiveIntensity;
	}
	if (override.opacity !== undefined) {
		target.opacity = override.opacity;
		target.transparent = override.opacity < 1;
	}
	if (override.depthWrite !== undefined) target.depthWrite = override.depthWrite;
	if (override.wireframe !== undefined && target.wireframe !== undefined) {
		target.wireframe = override.wireframe;
	}
	if (override.side !== undefined) target.side = override.side;
	target.needsUpdate = true;
}

/** A material's own value (see `OWN_ENV_MAP_INTENSITY`) unless the look restyles every material. */
export function envMapIntensityForLook(material: THREE.Material, preset: LookPreset): number {
	if (preset.materialOverride) return preset.envMapIntensity;
	const own = material.userData[OWN_ENV_MAP_INTENSITY] as number | undefined;
	if (own != null) return own;
	// Runs before the previous look's override is lifted, so read the parsed metalness.
	const target = material as OverridableMaterial;
	const metalness = target[BASELINE_KEY]?.metalness ?? target.metalness ?? 0;
	return lookEnvMapIntensity(preset.envMapIntensity, metalness, preset.metalReflection);
}

export type SetLookOptions = {
	/**
	 * Skips the sync, which walks every glowing part. The caller runs `syncEmissiveLights()` itself
	 * once visibility settles.
	 */
	deferEmissiveLights?: boolean;
};

export function lookPixelRatio(fullPixelRatio: number, preset: LookPreset): number {
	return Math.min(fullPixelRatio, preset.maxPixelRatio ?? fullPixelRatio);
}

/** The runtime lighting/material dials — everything a host can retune without rebuilding the scene. */
export interface AppearanceController {
	setFillLights(opts: {
		hemisphereIntensity?: number;
		hemisphereSkyColor?: THREE.Color | number;
		hemisphereGroundColor?: THREE.Color | number;
		ambientIntensity?: number;
	}): void;
	setEnvironmentIntensity(intensity: number): void;
	setToneMappingExposure(exposure: number): void;
	setAoIntensity(intensity: number): void;
	setLook(look: Look, options?: SetLookOptions): void;
	syncEmissiveLights(): void;
	jitterEmissiveLights(index: number): void;
	settleEmissiveLights(): void;
	getMaterialAppearance(): MaterialAppearanceOptions;
}

// setLook is built from the same setters a host would call directly, so construction-time defaults
// (applyDefaults seeding from LOOK_PRESETS) can't drift from the runtime path.
export function createAppearanceController(params: {
	scene: THREE.Scene;
	renderer: THREE.WebGLRenderer;
	lights: SceneLights;
	config: ResolvedOptions;
	pipeline: PipelineController;
	/** Before any look's cap. */
	fullPixelRatio: number;
	requestRender: () => void;
}): AppearanceController {
	const { scene, renderer, lights, config, pipeline, fullPixelRatio, requestRender } = params;

	const presetOf = (look: Look) => lookPreset(look, config.render.lowPower);
	let activeLook: Look = config.look;
	const emissiveLights = createEmissiveLights(scene);
	// VSM can't shadow a point light, and three then drops the shadow with only a console warning.
	const ownShadowType = renderer.shadowMap.type;
	const applyShadowType = (preset: LookPreset) => {
		const type = preset.emissiveLights ? THREE.PCFShadowMap : ownShadowType;
		if (renderer.shadowMap.type === type) return;
		renderer.shadowMap.type = type;
		renderer.shadowMap.needsUpdate = true;
	};

	// The scene's own background, held while a look replaces it.
	let ownBackground: THREE.Scene['background'] | undefined;

	const applyBackground = (preset: LookPreset) => {
		if (preset.background === undefined) {
			if (ownBackground !== undefined) scene.background = ownBackground;
			ownBackground = undefined;
			return;
		}
		ownBackground ??= scene.background;
		scene.background = new THREE.Color(preset.background);
	};
	applyBackground(presetOf(activeLook));
	applyShadowType(presetOf(activeLook));

	const setFillLights: AppearanceController['setFillLights'] = (opts) => {
		if (opts.ambientIntensity !== undefined) {
			lights.ambient.intensity = opts.ambientIntensity;
		}
		if (
			opts.hemisphereIntensity !== undefined &&
			!lights.hemisphere &&
			opts.hemisphereIntensity > 0
		) {
			// Lazily created so hosts can enable fill at runtime even if the scene was built without one.
			lights.hemisphere = new THREE.HemisphereLight(
				opts.hemisphereSkyColor ?? config.lighting.hemisphereSkyColor,
				opts.hemisphereGroundColor ?? config.lighting.hemisphereGroundColor,
				opts.hemisphereIntensity
			);
			lights.hemisphere.position.copy(config.environment.sceneUp ?? defaultUp);
			scene.add(lights.hemisphere);
		}
		if (lights.hemisphere) {
			if (opts.hemisphereIntensity !== undefined)
				lights.hemisphere.intensity = opts.hemisphereIntensity;
			if (opts.hemisphereSkyColor !== undefined)
				lights.hemisphere.color.set(opts.hemisphereSkyColor);
			if (opts.hemisphereGroundColor !== undefined)
				lights.hemisphere.groundColor.set(opts.hemisphereGroundColor);
		}
		requestRender();
	};

	const setEnvironmentIntensity = (intensity: number) => {
		config.environment.environmentIntensity = intensity;
		scene.environmentIntensity = intensity;
		requestRender();
	};

	const setToneMappingExposure = (exposure: number) => {
		config.render.toneMappingExposure = exposure;
		renderer.toneMappingExposure = exposure;
		// Composer applies tone mapping via its own OutputPass, so it must rebuild to pick this up.
		if (pipeline.get()) pipeline.rebuild();
	};

	const setAoIntensity = (intensity: number) => {
		config.render.aoIntensity = intensity;
		if (pipeline.get()) pipeline.rebuild();
	};

	const syncEmissiveLights = () => {
		const { emissiveLights: enabled, maxEmissiveLights, emissiveLightScale } = presetOf(activeLook);
		emissiveLights.sync(!!enabled, maxEmissiveLights, emissiveLightScale);
		requestRender();
	};

	const setLook: AppearanceController['setLook'] = (look, options) => {
		const preset = presetOf(look);
		activeLook = look;

		renderer.toneMapping = preset.toneMapping;
		renderer.toneMappingExposure = preset.toneMappingExposure;
		config.render.toneMapping = preset.toneMapping;
		config.render.toneMappingExposure = preset.toneMappingExposure;

		setFillLights({
			hemisphereIntensity: preset.hemisphereIntensity,
			ambientIntensity: preset.ambientIntensity
		});
		setEnvironmentIntensity(preset.environmentIntensity);

		// Null when the viewer was built with sunlight off; such a host has opted out of key lighting
		// entirely, and a look switch is not the place to opt it back in.
		if (lights.sun) {
			lights.sun.intensity = preset.sunlightIntensity;
			config.lighting.sunlightIntensity = preset.sunlightIntensity;
		}

		applyBackground(preset);
		applyShadowType(preset);
		config.render.bloom = preset.bloom;
		// The render loop's resize check applies it; set before the rebuild so the composer starts right.
		config.render.pixelRatio = lookPixelRatio(fullPixelRatio, preset);

		// Also rebuilds a live composer whose tone mapping or bloom just changed.
		pipeline.setAmbientOcclusion(preset.ambientOcclusion);

		// Solve output only. Host-added geometry (`user`/`app:` scopes) owns its own materials —
		// a point cloud or draft line has a deliberate look that a render-style switch must not
		// overwrite. Hosts that do want to follow the look read `getMaterialAppearance()`.
		scene.traverse((object) => {
			if (object.userData.source !== SOURCE_COMPUTE) return;
			const mesh = object as Partial<THREE.Mesh> & THREE.Object3D;
			const materials = Array.isArray(mesh.material)
				? mesh.material
				: mesh.material
					? [mesh.material]
					: [];
			for (const material of materials) {
				if ('envMapIntensity' in material) {
					(material as THREE.MeshStandardMaterial).envMapIntensity = envMapIntensityForLook(
						material,
						preset
					);
				}
				applyMaterialOverride(material as THREE.Material, preset.materialOverride);
			}
		});
		// An override can zero metalness, and lifting it restores it.
		applyReflectionEnvironment(scene, scene);
		if (!options?.deferEmissiveLights) syncEmissiveLights();
	};

	return {
		setFillLights,
		setEnvironmentIntensity,
		setToneMappingExposure,
		setAoIntensity,
		setLook,
		syncEmissiveLights,
		jitterEmissiveLights: emissiveLights.jitter,
		settleEmissiveLights: emissiveLights.settle,
		getMaterialAppearance: () => materialAppearanceForLook(activeLook)
	};
}
