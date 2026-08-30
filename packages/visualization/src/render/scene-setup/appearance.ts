import * as THREE from 'three';

import { LOOK_PRESETS, materialAppearanceForLook } from '../../shared/index.js';
import { SOURCE_COMPUTE } from '../scene-ownership.js';
import type { Look, LookMaterialOverride, MaterialAppearanceOptions } from '../types.js';
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
	opacity: number;
	transparent: boolean;
	depthWrite: boolean;
};

const BASELINE_KEY = '__selvaLookBaseline';

type OverridableMaterial = THREE.Material & {
	color?: THREE.Color;
	metalness?: number;
	roughness?: number;
	[BASELINE_KEY]?: MaterialBaseline;
};

/**
 * Applies a look's material overrides, or restores the parsed values when the look has none.
 * `needsUpdate` is set because switching `transparent` changes the shader program, not just a
 * uniform.
 */
function applyMaterialOverride(
	material: THREE.Material,
	override: LookMaterialOverride | undefined
): void {
	const target = material as OverridableMaterial;
	const baseline = target[BASELINE_KEY];

	if (!override) {
		if (!baseline) return;
		target.color?.setHex(baseline.color);
		if (target.metalness !== undefined) target.metalness = baseline.metalness;
		if (target.roughness !== undefined) target.roughness = baseline.roughness;
		target.opacity = baseline.opacity;
		target.transparent = baseline.transparent;
		target.depthWrite = baseline.depthWrite;
		delete target[BASELINE_KEY];
		target.needsUpdate = true;
		return;
	}

	if (!baseline) {
		target[BASELINE_KEY] = {
			color: target.color?.getHex() ?? 0xffffff,
			metalness: target.metalness ?? 0,
			roughness: target.roughness ?? 1,
			opacity: target.opacity,
			transparent: target.transparent,
			depthWrite: target.depthWrite
		};
	}

	if (override.color !== undefined) target.color?.setHex(override.color);
	if (override.metalness !== undefined && target.metalness !== undefined) {
		target.metalness = override.metalness;
	}
	if (override.roughness !== undefined && target.roughness !== undefined) {
		target.roughness = override.roughness;
	}
	if (override.opacity !== undefined) {
		target.opacity = override.opacity;
		target.transparent = override.opacity < 1;
	}
	if (override.depthWrite !== undefined) target.depthWrite = override.depthWrite;
	target.needsUpdate = true;
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
	setLook(look: Look): void;
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
	requestRender: () => void;
}): AppearanceController {
	const { scene, renderer, lights, config, pipeline, requestRender } = params;

	let activeLook: Look = config.look;

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

	const setLook = (look: Look) => {
		const preset = LOOK_PRESETS[look];
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

		// Rebuild on top of setAmbientOcclusion so an already-live composer's OutputPass adopts the
		// new tone mapping too.
		const hadPipeline = pipeline.get() !== null;
		pipeline.setAmbientOcclusion(preset.ambientOcclusion);
		if (hadPipeline) pipeline.rebuild();

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
					(material as THREE.MeshStandardMaterial).envMapIntensity = preset.envMapIntensity;
				}
				applyMaterialOverride(material as THREE.Material, preset.materialOverride);
			}
		});
		requestRender();
	};

	return {
		setFillLights,
		setEnvironmentIntensity,
		setToneMappingExposure,
		setAoIntensity,
		setLook,
		getMaterialAppearance: () => materialAppearanceForLook(activeLook)
	};
}
