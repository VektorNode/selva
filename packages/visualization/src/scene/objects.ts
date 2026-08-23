// ============================================================================
// Scene content: which objects are user content, and how they are labelled
// ============================================================================
//
// A live THREE.Scene holds more than the solve's output — the renderer also adds a camera, lights,
// and viewer aids (grid, floor, measurement overlay, CSS2D label layer). Anything presenting the
// scene to a user has to filter those out the same way.

import * as THREE from 'three';

// Viewer aids tagged by `userData.id` in `render/`; live in the scene graph but are not solve output.
export const HELPER_IDS: ReadonlySet<string> = new Set(['grid', 'floor', 'label-layer', 'measure']);

export function isSceneContent(object: THREE.Object3D): boolean {
	return (
		!(object instanceof THREE.Camera) &&
		!(object instanceof THREE.Light) &&
		!HELPER_IDS.has(object.userData?.id)
	);
}

// Only top-level children: a mesh's own sub-objects (edge overlays, labels) are governed by it,
// not listed alongside it.
export function getSceneObjects(scene: THREE.Scene): THREE.Object3D[] {
	return scene.children.filter(isSceneContent);
}

// `Line2`/`LineSegments2` are how curves are rendered — an implementation detail no user should
// have to decode.
export function prettyType(type: string): string {
	return (
		type
			.replace(/^Line(Segments)?2$/, 'Curve')
			.replace('Mesh', '')
			.replace('Object3D', 'Obj') || type
	);
}

export function getObjectLabel(object: THREE.Object3D): string {
	return (
		object.userData?.name || object.userData?.fileName || object.name || prettyType(object.type)
	);
}

export function getTypeLabel(object: THREE.Object3D): string {
	return prettyType(object.type);
}
