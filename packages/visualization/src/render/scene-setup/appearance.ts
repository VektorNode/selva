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
	wireframe: boolean;
};

const BASELINE_KEY = '__selvaLookBaseline';

type OverridableMaterial = THREE.Material & {
	color?: THREE.Color;
	metalness?: number;
	roughness?: number;
	wireframe?: boolean;
	[BASELINE_KEY]?: MaterialBaseline;
};

function applyBaseline(target: OverridableMaterial, baseline: MaterialBaseline): void {
	target.color?.setHex(baseline.color);
	if (target.metalness !== undefined) target.metalness = baseline.metalness;
	if (target.roughness !== undefined) target.roughness = baseline.roughness;
	target.opacity = baseline.opacity;
	target.transparent = baseline.transparent;
	target.depthWrite = baseline.depthWrite;
	if (target.wireframe !== undefined) target.wireframe = baseline.wireframe;
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
 * `needsUpdate` is set because switching `transparent` changes the shader program, not just a uniform.
 *
 * Exported for tests: the leak this guards against only shows up after two overriding looks are
 * applied in sequence, which no single-look check catches.
 *
 * Every apply restores the baseline first, so an override only has to describe what it wants.
 * Without that reset, switching between two looks that both override leaves behind whatever the
 * previous one set: `wireframe` surviving out of the wireframe look, or `opacity`/`depthWrite`
 * surviving out of xray, since no other look mentions them.
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
			opacity: target.opacity,
			transparent: target.transparent,
			depthWrite: target.depthWrite,
			wireframe: target.wireframe ?? false
		};
	} else {
		// Baseline captured by an earlier look: reset onto it so this override starts clean.
		applyBaseline(target, target[BASELINE_KEY]);
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
	if (override.wireframe !== undefined && target.wireframe !== undefined) {
		target.wireframe = override.wireframe;
	}
	target.needsUpdate = true;
}

/** The runtime lighting/material dials: everything a host can retune without rebuilding the scene. */
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
			// Lazily created so hosts can enable fill at runtime even if the scene started without one.
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

		// Null when the viewer was built with sunlight off. That host opted out of key lighting
		// entirely; a look switch is not the place to opt it back in.
		if (lights.sun) {
			lights.sun.intensity = preset.sunlightIntensity;
			config.lighting.sunlightIntensity = preset.sunlightIntensity;
		}

		// Rebuild on top of setAmbientOcclusion so an already-live composer's OutputPass adopts the
		// new tone mapping too.
		const hadPipeline = pipeline.get() !== null;
		pipeline.setAmbientOcclusion(preset.ambientOcclusion);
		if (hadPipeline) pipeline.rebuild();

		// Solve output only. Host-added geometry (`user`/`app:` scopes) owns its own materials:
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
