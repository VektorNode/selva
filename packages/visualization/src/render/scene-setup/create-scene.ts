import * as THREE from 'three';

import type { ResolvedOptions } from './defaults.js';

export function createScene(config: ResolvedOptions): THREE.Scene {
	const scene = new THREE.Scene();

	const bgColor =
		typeof config.environment.backgroundColor === 'string'
			? new THREE.Color(config.environment.backgroundColor)
			: config.environment.backgroundColor;
	scene.background = bgColor || null;

	return scene;
}
