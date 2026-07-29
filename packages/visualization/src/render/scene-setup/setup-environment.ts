import { getLogger } from '@selvajs/compute';
import * as THREE from 'three';
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
				// The viewer can be torn down while the HDR is still fetching/decoding (fast
				// mount/unmount). dispose() has already swept the scene, so adopting the texture now
				// would leak it — and onReady must not fire on a dead viewer.
				if (isDisposed()) {
					envMap.dispose();
					return;
				}
				if (!envMap?.image) {
					getLogger().warn('HDR loaded without image data; skipping environment map.');
					// The texture object still holds GPU/CPU resources even without usable image data —
					// dispose it, since it will never be attached to the scene.
					envMap?.dispose();
					config.events.onReady?.();
					return;
				}
				envMap.mapping = THREE.EquirectangularReflectionMapping;

				// Prefilter the raw equirect HDR through PMREM: this builds the roughness-aware mip
				// chain a MeshStandardMaterial samples for image-based lighting. Without it, three
				// falls back to sampling the equirect map directly and a rough surface reads a near-
				// mirror level — reflections stay unnaturally sharp/busy and specular highlights
				// sparkle, which is a big part of the "not quite right" look. The prefiltered cube is
				// what drives IBL; the raw equirect is kept only if it's also shown as the background.
				const pmrem = new THREE.PMREMGenerator(renderer);
				pmrem.compileEquirectangularShader();
				const prefiltered = pmrem.fromEquirectangular(envMap).texture;
				pmrem.dispose();

				scene.environment = prefiltered;
				// Normalize the HDR's IBL contribution so brightness is consistent across HDRs of
				// differing exposure, instead of dim-HDR-looks-dim / bright-HDR-blows-out.
				scene.environmentIntensity = config.environment.environmentIntensity ?? 1;
				// Equirectangular mapping assumes the HDR's horizon lies in the XZ plane — i.e. Y-up.
				// This scene is Z-up, so without a rotation the environment sits on its side: the
				// horizon runs vertically and the sky lights the model from +Y instead of from above.
				// Invisible on a neutral studio HDR, obvious on any HDR with a sky/ground split.
				const envRotation = environmentRotationFor(config.environment.sceneUp ?? defaultUp);
				scene.environmentRotation.copy(envRotation);
				if (config.environment.showEnvironment) {
					// Background wants the full-resolution equirect, not the low-res prefiltered probe —
					// so keep the raw map for that and let it dispose with the scene background sweep.
					scene.background = envMap;
					// Keep the visible background locked to the same orientation as the IBL probe;
					// they are separate properties and drift apart if only one is set.
					scene.backgroundRotation.copy(envRotation);
				} else {
					// The raw equirect was only an input to PMREM; the prefiltered probe has superseded
					// it for IBL and nothing else references it, so release it now.
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
	// PlaneGeometry lies in XY with a +Z normal — already the ground for a Z-up scene. Orient its
	// normal to the scene up axis so the floor is the ground plane in any up convention.
	const up = (config.environment?.sceneUp || defaultUp).clone().normalize();
	floor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
	floor.position.set(0, 0, 0);

	if (config.floor.receiveShadow && config.render.enableShadows) {
		floor.receiveShadow = true;
	}

	scene.add(floor);
}
