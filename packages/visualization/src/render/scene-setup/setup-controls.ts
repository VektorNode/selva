import type * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { ResolvedOptions } from './defaults.js';

export function setupControls(
	camera: THREE.PerspectiveCamera,
	canvas: HTMLCanvasElement,
	config: ResolvedOptions
): OrbitControls {
	const controls = new OrbitControls(camera, canvas);

	const target = config.camera.target;
	if (target) {
		controls.target.set(target.x, target.y, target.z);
	}

	controls.enableDamping = config.controls.enableDamping || false;
	controls.dampingFactor = config.controls.dampingFactor || 0.05;

	controls.autoRotate = config.controls.autoRotate || false;
	controls.autoRotateSpeed = config.controls.autoRotateSpeed || 0.5;

	controls.enableZoom = config.controls.enableZoom ?? true;
	controls.enablePan = config.controls.enablePan ?? true;
	controls.minDistance = config.controls.minDistance || 0.001;
	controls.maxDistance = config.controls.maxDistance || Infinity;

	controls.screenSpacePanning = false;
	controls.maxPolarAngle = Math.PI;

	controls.update();
	return controls;
}
