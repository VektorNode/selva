// ============================================================================
// Scene content: which objects are user content, and how they are labelled
// ============================================================================
//
// A live THREE.Scene holds more than the solve's output. The renderer adds a camera, lights, and
// viewer aids (grid, floor, measurement overlay, CSS2D label layer). None of those are scene
// *content*, so anything presenting the scene to a user — an outliner, a headless export, a
// screenshot cropper — has to filter them out the same way.

import * as THREE from 'three';

/**
 * Viewer aids tagged by `userData.id` in `render/`. They live in the scene graph but are not solve
 * output, so they never appear as content.
 */
export const HELPER_IDS: ReadonlySet<string> = new Set(['grid', 'floor', 'label-layer', 'measure']);

/**
 * True when the object is solve output rather than a camera, a light, or a viewer aid.
 */
export function isSceneContent(object: THREE.Object3D): boolean {
	return (
		!(object instanceof THREE.Camera) &&
		!(object instanceof THREE.Light) &&
		!HELPER_IDS.has(object.userData?.id)
	);
}

/**
 * The scene's content objects, in scene-graph order.
 *
 * Only top-level children are considered — a mesh's own sub-objects (edge overlays, labels) belong
 * to that mesh and are governed by it, not listed alongside it.
 */
export function getSceneObjects(scene: THREE.Scene): THREE.Object3D[] {
	return scene.children.filter(isSceneContent);
}

/**
 * Shorten three's class names for display. `Line2`/`LineSegments2` are how we render curves, which
 * is an implementation detail no user should have to decode.
 */
export function prettyType(type: string): string {
	return (
		type
			.replace(/^Line(Segments)?2$/, 'Curve')
			.replace('Mesh', '')
			.replace('Object3D', 'Obj') || type
	);
}

/**
 * Display name for an object, preferring what Grasshopper named it over what three called it.
 */
export function getObjectLabel(object: THREE.Object3D): string {
	return (
		object.userData?.name || object.userData?.fileName || object.name || prettyType(object.type)
	);
}

/**
 * Short type badge for an object (`Curve`, `Points`, …).
 */
export function getTypeLabel(object: THREE.Object3D): string {
	return prettyType(object.type);
}
