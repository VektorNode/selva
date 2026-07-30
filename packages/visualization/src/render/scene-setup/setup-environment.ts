import * as THREE from 'three';

import { getLogger } from '../../shared/index.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import { environmentRotationFor } from '../up-axis.js';
import { defaultUp, type ResolvedOptions } from './defaults.js';

export function setupEnvironment(
	scene: THREE.Scene,
	renderer: THREE.WebGLRenderer,
	config: ResolvedOptions,
	isDisposed: () => boolean
) {
	if (config.environment.enableEnvironmentLighting) {
		new HDRLoader().load(
			config.environment.hdrPath || '/baseHDR.hdr',
			function (envMap) {
				// Viewer may be torn down mid-fetch (fast mount/unmount); dispose() already swept the
				// scene, so adopting the texture now would leak it, and onReady must not fire.
				if (isDisposed()) {
					envMap.dispose();
					return;
				}
				if (!envMap?.image) {
					getLogger().warn('HDR loaded without image data; skipping environment map.');
					// Still holds GPU/CPU resources even without usable image data; will never attach.
					envMap?.dispose();
					config.events.onReady?.();
					return;
				}
				envMap.mapping = THREE.EquirectangularReflectionMapping;

				// PMREM builds the roughness-aware mip chain MeshStandardMaterial samples for IBL.
				// Without it, three samples the raw equirect directly and rough surfaces read a
				// near-mirror level — reflections stay unnaturally sharp and highlights sparkle.
				// The raw equirect is kept only if it's also shown as the background.
				const pmrem = new THREE.PMREMGenerator(renderer);
				pmrem.compileEquirectangularShader();
				const prefiltered = pmrem.fromEquirectangular(envMap).texture;
				pmrem.dispose();

				scene.environment = prefiltered;
				// Normalizes IBL contribution so brightness is consistent across HDRs of differing
				// exposure, instead of dim-HDR-looks-dim / bright-HDR-blows-out.
				scene.environmentIntensity = config.environment.environmentIntensity ?? 1;
				// Equirect mapping assumes the horizon lies in the XZ plane (Y-up). This scene is
				// Z-up, so without rotation the sky lights the model from +Y instead of from above —
				// invisible on a neutral studio HDR, obvious with a sky/ground split.
				const envRotation = environmentRotationFor(config.environment.sceneUp ?? defaultUp);
				scene.environmentRotation.copy(envRotation);
				if (config.environment.showEnvironment) {
					// Background wants the full-res equirect, not the low-res prefiltered probe; it
					// disposes with the scene background sweep.
					scene.background = envMap;
					// Background and IBL rotation are separate properties and drift apart if only one
					// is set.
					scene.backgroundRotation.copy(envRotation);
				} else {
					// Raw equirect was only PMREM input; the prefiltered probe has superseded it and
					// nothing else references it.
					envMap.dispose();
				}
				config.events.onReady?.();
			},
			undefined,
			function (error) {
				if (isDisposed()) return;
				getLogger().warn('HDR texture could not be loaded, falling back to basic lighting:', error);
				config.events.onReady?.();
			}
		);
	} else {
		config.events.onReady?.();
	}
}

export function addFloor(scene: THREE.Scene, config: ResolvedOptions) {
	const floorSize = config.floor.size;
	const floorGeometry = new THREE.PlaneGeometry(floorSize, floorSize);

	const floorColor =
		typeof config.floor.color === 'string'
			? new THREE.Color(config.floor.color)
			: config.floor.color;

	const floorMaterial = new THREE.MeshStandardMaterial({
		color: floorColor,
		roughness: config.floor.roughness,
		metalness: config.floor.metalness,
		side: THREE.DoubleSide
	});

	const floor = new THREE.Mesh(floorGeometry, floorMaterial);
	floor.userData.id = 'floor';
	floor.name = 'floor';
	// PlaneGeometry's default +Z normal is already the ground for Z-up; orient to scene up so the
	// floor is correct under any up convention.
	const up = (config.environment?.sceneUp || defaultUp).clone().normalize();
	floor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
	floor.position.set(0, 0, 0);

	if (config.floor.receiveShadow && config.render.enableShadows) {
		floor.receiveShadow = true;
	}

	scene.add(floor);
}
