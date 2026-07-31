import * as THREE from 'three';

import { getLogger } from './logger.js';

// Object/color utilities shared by `parse/` and `render/`. Live here (not in render's
// three-helpers) because `parse/` needs them and must never import upward from `render/`.

export function parseColor(colorString: string): THREE.Color {
	if (!colorString || typeof colorString !== 'string') {
		getLogger().warn(`Invalid color input: ${colorString}, using white`);
		return new THREE.Color(0xffffff);
	}

	const trimmed = colorString.trim();

	if (/^#?[0-9A-Fa-f]{6}$/.test(trimmed)) {
		try {
			const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
			return new THREE.Color(hex);
		} catch {
			getLogger().warn(`Invalid hex color: ${colorString}, using white`);
			return new THREE.Color(0xffffff);
		}
	}

	if (trimmed.includes(',')) {
		const rgb = trimmed.split(',').map((c) => parseInt(c.trim(), 10));
		if (rgb.length === 3 && rgb.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
			return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
		}
	}

	// `new THREE.Color(name)` never throws on unknown names (it logs its own warning and leaves the
	// color white), so validate against three's CSS name table instead.
	const named = trimmed.toLowerCase();
	if (named in THREE.Color.NAMES) {
		return new THREE.Color(THREE.Color.NAMES[named as keyof typeof THREE.Color.NAMES]);
	}

	getLogger().warn(`Invalid color string: ${colorString}, using white`);
	return new THREE.Color(0xffffff);
}

/** Defaults to `z` (Rhino's up axis); pass an explicit axis when the scene uses a different `sceneUp`. */
export function applyOffset(
	meshes: THREE.Object3D[],
	offset: number,
	axis: 'x' | 'y' | 'z' = 'z'
): void {
	meshes.forEach((mesh) => {
		mesh.position[axis] -= offset;
	});
}

export function computeCombinedBoundingBox(meshes: THREE.Object3D[]): THREE.Box3 {
	const combinedBoundingBox = new THREE.Box3();
	if (meshes.length === 0) return combinedBoundingBox;
	meshes.forEach((mesh) => {
		mesh.updateMatrixWorld(true);
		const bbox = new THREE.Box3().setFromObject(mesh);
		combinedBoundingBox.union(bbox);
	});
	return combinedBoundingBox;
}
