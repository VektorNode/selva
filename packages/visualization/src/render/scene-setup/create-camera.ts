import * as THREE from 'three';

import type { ResolvedOptions } from './defaults.js';

export function createCamera(
	config: ResolvedOptions,
	canvas: HTMLCanvasElement
): THREE.PerspectiveCamera {
	const parent = canvas.parentElement;
	const width = parent ? parent.clientWidth : window.innerWidth;
	const height = parent ? parent.clientHeight : window.innerHeight;

	const camera = new THREE.PerspectiveCamera(
		config.camera.fov,
		width / height,
		config.camera.near,
		config.camera.far
	);

	const pos = config.camera.position;
	if (pos) {
		camera.position.set(pos.x, pos.y, pos.z);
	}

	return camera;
}
