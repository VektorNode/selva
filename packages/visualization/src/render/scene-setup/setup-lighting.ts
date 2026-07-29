import * as THREE from 'three';

import { defaultUp, type ResolvedOptions } from './defaults.js';

/** The lights created by {@link setupLighting}, handed back so runtime setters can retune them. */
export type SceneLights = {
	ambient: THREE.AmbientLight;
	/** Hemisphere fill light — null unless `lighting.enableHemisphereLight`. */
	hemisphere: THREE.HemisphereLight | null;
	/**
	 * Shadow-casting sun. Null when sunlight is disabled or shadows are off — the caller uses it only
	 * to refit the shadow frustum on geometry change (see `fitShadowToContent`), so null means nothing
	 * to refit.
	 */
	sun: THREE.DirectionalLight | null;
};

/**
 * Set up scene lighting. Returns handles to the created lights so the caller can refit the sun's
 * shadow frustum on geometry change and retune fill lights at runtime.
 */
export function setupLighting(scene: THREE.Scene, config: ResolvedOptions): SceneLights {
	const ambient = new THREE.AmbientLight(
		config.lighting.ambientLightColor,
		config.lighting.ambientLightIntensity
	);
	scene.add(ambient);

	// Hemisphere fill: soft sky-from-above / ground-from-below light that lifts occluded and
	// downward-facing surfaces the HDR may leave dark. Aligned to the scene up so "sky" is genuinely
	// up in a Z-up scene (a HemisphereLight defaults to +Y up).
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

	// The frustum bounds (left/right/top/bottom/near/far) are not set here — they are fitted to the
	// scene content by fitShadowToContent, called at init and on every geometry change. Sizing them
	// to the model instead of a fixed constant is the dominant lever on shadow crispness.
	sunlight.shadow.mapSize.width = config.render.shadowMapSize || 2048;
	sunlight.shadow.mapSize.height = config.render.shadowMapSize || 2048;

	sunlight.shadow.bias = -0.0001;
	sunlight.shadow.normalBias = 0.02;
	// Soften VSM edges; cheap and only meaningful once the frustum is tight (see fitShadowToContent).
	sunlight.shadow.radius = 4;

	scene.add(sunlight);
	// A DirectionalLight aims at its target's world position; the target must be in the scene graph
	// for its matrix to update. fitShadowToContent moves this target to the content centre.
	scene.add(sunlight.target);
	return { ambient, hemisphere, sun: sunlight };
}

/**
 * Fit a directional light's shadow camera to the scene content. The orthographic shadow frustum is
 * sized to the content's bounding sphere (padded), so the fixed shadow-map texels cover only the
 * model rather than a generous constant area — the dominant lever on shadow crispness. Near/far are
 * derived from how far the light sits from the content centre, keeping depth precision tight.
 *
 * No-op when there is no content (an empty box would collapse the frustum to a point).
 */
export function fitShadowToContent(light: THREE.DirectionalLight, bounds: THREE.Box3): void {
	if (bounds.isEmpty()) return;

	const center = bounds.getCenter(new THREE.Vector3());
	// Bounding-sphere radius makes the frustum rotation-invariant: the light can shine from any
	// angle and the model still fits, with no per-angle recompute. Pad so grazing-angle casters and
	// soft-shadow (VSM) blur near the edges don't clip.
	const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5 * 1.2;

	const cam = light.shadow.camera;
	cam.left = -radius;
	cam.right = radius;
	cam.top = radius;
	cam.bottom = -radius;

	// Aim the shadow camera at the content centre. The light keeps its configured *position*; only
	// its target moves, so the lighting direction is preserved while the shadow frustum recentres.
	light.target.position.copy(center);
	light.target.updateMatrixWorld();

	// Near/far bracket the content along the light→centre axis. Clamp near to a small positive value
	// so a light sitting inside the bounds can't push near ≤ 0.
	const lightDistance = light.position.distanceTo(center);
	cam.near = Math.max(radius * 0.01, lightDistance - radius);
	cam.far = lightDistance + radius;
	cam.updateProjectionMatrix();
}
