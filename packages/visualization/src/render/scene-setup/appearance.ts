import * as THREE from 'three';

import { LOOK_PRESETS, materialAppearanceForLook } from '../../shared/index.js';
import type { Look, MaterialAppearanceOptions } from '../types.js';
import { defaultUp, type ResolvedOptions } from './defaults.js';
import type { PipelineController } from './pipeline-controller.js';
import type { SceneLights } from './setup-lighting.js';

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

/**
 * The runtime appearance setters, split out of `initThree` because they form one coherent group:
 * every one of them mutates the resolved config (so a later `setLook` composes with what the host
 * set), touches the renderer or the lights, and asks for a repaint.
 *
 * `setLook` is a straight preset apply built from the same setters a host would call — that's what
 * keeps the construction-time path (`applyDefaults` seeding from `LOOK_PRESETS`) and the runtime
 * path from drifting.
 */
export function createAppearanceController(params: {
	scene: THREE.Scene;
	renderer: THREE.WebGLRenderer;
	lights: SceneLights;
	config: ResolvedOptions;
	pipeline: PipelineController;
	requestRender: () => void;
}): AppearanceController {
	const { scene, renderer, lights, config, pipeline, requestRender } = params;

	// The look currently applied. Always a real look (the default is 'technical'), seeded from the
	// same resolved value as the construction defaults. Drives `getMaterialAppearance()`.
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
			// Built without a hemisphere light — create one on first positive intensity so hosts can
			// enable the fill purely at runtime.
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
		// When the composer path is active, tone mapping is applied by its OutputPass — rebuild so it
		// adopts the new exposure.
		if (pipeline.get()) pipeline.rebuild();
	};

	const setAoIntensity = (intensity: number) => {
		config.render.aoIntensity = intensity;
		if (pipeline.get()) pipeline.rebuild();
	};

	const setLook = (look: Look) => {
		const preset = LOOK_PRESETS[look];
		activeLook = look;

		// Tone mapping lives on the renderer (plain path) and is mirrored into the composer's OutputPass
		// when AO is active. Rebuild the pipeline so the composer picks up the new tone mapping.
		renderer.toneMapping = preset.toneMapping;
		renderer.toneMappingExposure = preset.toneMappingExposure;
		config.render.toneMapping = preset.toneMapping;
		config.render.toneMappingExposure = preset.toneMappingExposure;

		// Fill lighting + HDR normalization: studio/showcase add hemisphere fill and lift the environment
		// so shadowed surfaces read well regardless of the HDR; technical zeroes the fill back to a flat
		// CAD look. Applied through the same setters a host would call.
		setFillLights({
			hemisphereIntensity: preset.hemisphereIntensity,
			ambientIntensity: preset.ambientIntensity
		});
		setEnvironmentIntensity(preset.environmentIntensity);

		// Honour the look's AO choice. `setAmbientOcclusion` syncs, which builds or tears down the
		// composer as needed; rebuild on top of that when one is already live so its OutputPass adopts
		// the new tone mapping.
		const hadPipeline = pipeline.get() !== null;
		pipeline.setAmbientOcclusion(preset.ambientOcclusion);
		if (hadPipeline) pipeline.rebuild();

		// Retune IBL reflection strength on every compute mesh material in the scene.
		scene.traverse((object) => {
			if (object.userData.source !== 'compute') return;
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
