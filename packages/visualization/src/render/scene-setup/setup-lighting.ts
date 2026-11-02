import * as THREE from 'three';

import { defaultUp, type ResolvedOptions } from './defaults.js';

export type SceneLights = {
	ambient: THREE.AmbientLight;
	/** Null unless `lighting.enableHemisphereLight`. */
	hemisphere: THREE.HemisphereLight | null;
	/** Null when sunlight or shadows are disabled. */
	sun: THREE.DirectionalLight | null;
};

const SHADOW_NORMAL_BIAS = 0.02;

/**
 * In shadow-map texels, and the map always spans the model, so the penumbra stays about 1.5% of the
 * model at any scale. A sharp edge reads as a sticker; a real sky never gives one.
 */
const SUN_SHADOW_BLUR = 6;

/** Sky and bounce always fill a shadow in, so a fully dark one looks painted on. */
const SUN_SHADOW_DENSITY = 0.62;

/** Survives a solve with the sun, which would otherwise aim at a target outside the scene. */
export const SUN_TARGET_ID = 'sun-target';

export function setupLighting(scene: THREE.Scene, config: ResolvedOptions): SceneLights {
	const ambient = new THREE.AmbientLight(
		config.lighting.ambientLightColor,
		config.lighting.ambientLightIntensity
	);
	scene.add(ambient);

	// HemisphereLight defaults to +Y up, which is wrong for a Z-up scene — align to scene up instead.
	let hemisphere: THREE.HemisphereLight | null = null;
	if (config.lighting.enableHemisphereLight) {
		hemisphere = new THREE.HemisphereLight(
			config.lighting.hemisphereSkyColor,
			config.lighting.hemisphereGroundColor,
			config.lighting.hemisphereIntensity
		);
		const up = config.environment.sceneUp ?? defaultUp;
		hemisphere.position.copy(up);
		scene.add(hemisphere);
	}

	if (!config.lighting.enableSunlight) return { ambient, hemisphere, sun: null };

	const sunlight = new THREE.DirectionalLight(
		config.lighting.sunlightColor ?? 0xffffff,
		config.lighting.sunlightIntensity
	);
	const pos = config.lighting.sunlightPosition;
	if (pos) {
		sunlight.position.set(pos.x, pos.y, pos.z);
	}

	if (!config.render.enableShadows) {
		scene.add(sunlight);
		return { ambient, hemisphere, sun: null };
	}

	sunlight.castShadow = true;

	// Frustum bounds are not set here — fitShadowToContent sizes them to scene content instead.
	sunlight.shadow.mapSize.width = config.render.shadowMapSize!;
	sunlight.shadow.mapSize.height = config.render.shadowMapSize!;

	sunlight.shadow.bias = -0.0001;
	sunlight.shadow.normalBias = SHADOW_NORMAL_BIAS;
	sunlight.shadow.radius = SUN_SHADOW_BLUR;
	sunlight.shadow.blurSamples = 12;
	sunlight.shadow.intensity = SUN_SHADOW_DENSITY;

	scene.add(sunlight);
	// A DirectionalLight aims at its target's world position, so the target must be in the scene
	// graph for its matrix to update.
	sunlight.target.userData.id = SUN_TARGET_ID;
	scene.add(sunlight.target);
	return { ambient, hemisphere, sun: sunlight };
}

/**
 * Sizes a directional light's orthographic shadow frustum to the scene content's bounding sphere —
 * the dominant lever on shadow crispness. No-op on an empty or zero-size box: the frustum would
 * collapse to a point, and the sun would land on its target and lose its direction for good.
 */
export function fitShadowToContent(light: THREE.DirectionalLight, bounds: THREE.Box3): void {
	if (bounds.isEmpty()) return;

	const center = bounds.getCenter(new THREE.Vector3());
	// Bounding-sphere radius keeps the frustum rotation-invariant; padded so grazing-angle casters
	// and VSM blur near the edges don't clip.
	const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5 * 1.2;
	if (radius === 0) return;

	// Scenes are in metres, so a fixed offset that suits a building erases a desk lamp's whole shadow.
	light.shadow.normalBias = Math.min(SHADOW_NORMAL_BIAS, radius * 0.0015);

	const cam = light.shadow.camera;
	cam.left = -radius;
	cam.right = radius;
	cam.top = radius;
	cam.bottom = -radius;

	// The configured position is a direction, not a place: left where it is, the sun ends up inside a
	// building-sized scene and everything behind it stops casting. Sits outside the sphere instead.
	const direction = light.position.clone().sub(light.target.position).normalize();
	light.target.position.copy(center);
	light.target.updateMatrixWorld();
	const lightDistance = radius * 2;
	light.position.copy(center).addScaledVector(direction, lightDistance);
	light.updateMatrixWorld();

	cam.near = lightDistance - radius;
	cam.far = lightDistance + radius;
	cam.updateProjectionMatrix();
}
