import * as THREE from 'three';

import type { ResolvedOptions } from './defaults.js';

export function setupRenderer(
	canvas: HTMLCanvasElement,
	config: ResolvedOptions,
	pixelRatio: number
): THREE.WebGLRenderer {
	const renderer = new THREE.WebGLRenderer({
		antialias: config.render.antialias,
		canvas,
		alpha: true,
		powerPreference: 'high-performance',
		preserveDrawingBuffer: config.render.preserveDrawingBuffer,
		// Deliberately NOT logarithmic: the GTAO pipeline reconstructs view-space positions assuming
		// standard perspective depth and doesn't support log-encoded depth (haloing, wrong-scale
		// occlusion if enabled). If log depth is ever needed, AO must be disabled alongside it.
		logarithmicDepthBuffer: false
	});

	const parent = canvas.parentElement;
	const width = parent ? parent.clientWidth : window.innerWidth;
	const height = parent ? parent.clientHeight : window.innerHeight;

	if (parent) {
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.style.display = 'block';
	}

	renderer.setSize(width, height, false);
	renderer.setPixelRatio(pixelRatio);

	if (config.render.enableShadows) {
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.VSMShadowMap;
	}

	renderer.toneMapping = config.render.toneMapping!;
	renderer.toneMappingExposure = config.render.toneMappingExposure ?? 1.0;
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	renderer.sortObjects = true;

	return renderer;
}
