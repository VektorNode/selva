import * as THREE from 'three';

import { defaultUp, type ResolvedOptions } from './defaults.js';

/** Lights created by {@link setupLighting}, handed back so callers can retune or refit them. */
export type SceneLights = {
	ambient: THREE.AmbientLight;
	/** Null unless `lighting.enableHemisphereLight`. */
	hemisphere: THREE.HemisphereLight | null;
	/** Null when sunlight or shadows are disabled — nothing to refit via `fitShadowToContent`. */
	sun: THREE.DirectionalLight | null;
};

export function setupLighting(scene: THREE.Scene, config: ResolvedOptions): SceneLights {
	const ambient = new THREE.AmbientLight(
		config.lighting.ambientLightColor,
		config.lighting.ambientLightIntensity
	);
	scene.add(ambient);

	// Lifts occluded/downward-facing surfaces the HDR may leave dark. Aligned to scene up — a
	// HemisphereLight defaults to +Y up, which is wrong for a Z-up scene.
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

	// Frustum bounds are not set here — fitShadowToContent sizes them to scene content (called at
	// init and on every geometry change), which is the dominant lever on shadow crispness.
	sunlight.shadow.mapSize.width = config.render.shadowMapSize || 2048;
	sunlight.shadow.mapSize.height = config.render.shadowMapSize || 2048;

	sunlight.shadow.bias = -0.0001;
	sunlight.shadow.normalBias = 0.02;
	// Softens VSM edges; only meaningful once the frustum is tight via fitShadowToContent.
	sunlight.shadow.radius = 4;

	scene.add(sunlight);
	// A DirectionalLight aims at its target's world position, so the target must be in the scene
	// graph for its matrix to update — fitShadowToContent moves it to the content centre.
	scene.add(sunlight.target);
	return { ambient, hemisphere, sun: sunlight };
}

/**
 * Sizes a directional light's orthographic shadow frustum to the scene content's bounding sphere
 * (padded) instead of a fixed constant area — the dominant lever on shadow crispness. No-op when
 * there is no content (an empty box would collapse the frustum to a point).
 */
export function fitShadowToContent(light: THREE.DirectionalLight, bounds: THREE.Box3): void {
	if (bounds.isEmpty()) return;

	const center = bounds.getCenter(new THREE.Vector3());
	// Bounding-sphere radius keeps the frustum rotation-invariant (fits from any light angle, no
	// per-angle recompute). Padded so grazing-angle casters and VSM blur near the edges don't clip.
	const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5 * 1.2;

	const cam = light.shadow.camera;
	cam.left = -radius;
	cam.right = radius;
	cam.top = radius;
	cam.bottom = -radius;

	// Only the target moves to the content centre; the light keeps its configured position, so
	// direction is preserved while the frustum recentres.
	light.target.position.copy(center);
	light.target.updateMatrixWorld();

	// Clamp near above 0 so a light sitting inside the bounds can't invert the frustum.
	const lightDistance = light.position.distanceTo(center);
	cam.near = Math.max(radius * 0.01, lightDistance - radius);
	cam.far = lightDistance + radius;
	cam.updateProjectionMatrix();
}
