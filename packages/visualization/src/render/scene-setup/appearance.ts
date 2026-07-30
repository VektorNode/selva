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

// Split out of `initThree`: every setter here mutates the resolved config, touches the renderer or
// lights, and requests a repaint. `setLook` is built from the same setters a host would call, so the
// construction-time defaults path (`applyDefaults` seeding from `LOOK_PRESETS`) can't drift from
// the runtime path.
export function createAppearanceController(params: {
	scene: THREE.Scene;
	renderer: THREE.WebGLRenderer;
	lights: SceneLights;
	config: ResolvedOptions;
	pipeline: PipelineController;
	requestRender: () => void;
}): AppearanceController {
	const { scene, renderer, lights, config, pipeline, requestRender } = params;

	// Drives getMaterialAppearance(); seeded from the same resolved value as construction defaults.
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
			// Create the light lazily on first positive intensity so hosts can enable fill at runtime
			// even if the scene was built without one.
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
		// Composer path applies tone mapping via its OutputPass — rebuild so it picks up the new exposure.
		if (pipeline.get()) pipeline.rebuild();
	};

	const setAoIntensity = (intensity: number) => {
		config.render.aoIntensity = intensity;
		if (pipeline.get()) pipeline.rebuild();
	};

	const setLook = (look: Look) => {
		const preset = LOOK_PRESETS[look];
		activeLook = look;

		// Mirror tone mapping into the composer's OutputPass when AO is active; rebuild to apply it.
		renderer.toneMapping = preset.toneMapping;
		renderer.toneMappingExposure = preset.toneMappingExposure;
		config.render.toneMapping = preset.toneMapping;
		config.render.toneMappingExposure = preset.toneMappingExposure;

		// studio/showcase add hemisphere fill + lift the environment so shadowed surfaces read well
		// regardless of the HDR; technical zeroes the fill back to a flat CAD look.
		setFillLights({
			hemisphereIntensity: preset.hemisphereIntensity,
			ambientIntensity: preset.ambientIntensity
		});
		setEnvironmentIntensity(preset.environmentIntensity);

		// setAmbientOcclusion builds/tears down the composer as needed; rebuild on top when one was
		// already live so its OutputPass adopts the new tone mapping.
		const hadPipeline = pipeline.get() !== null;
		pipeline.setAmbientOcclusion(preset.ambientOcclusion);
		if (hadPipeline) pipeline.rebuild();

		// Retune IBL reflection strength on every compute mesh material.
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
