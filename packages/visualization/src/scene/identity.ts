// ============================================================================
// Stable object identity across solves
// ============================================================================
//
// A solve discards all content and rebuilds it, so `THREE.Object3D.uuid` (assigned per instance)
// cannot answer "is this the same wall I hid a minute ago". Anything that must outlive a solve —
// hidden state, selection, per-object overrides — has to key on what the geometry *is*.
//
// Grasshopper gives no object GUIDs, so identity is synthesized from `userData`, in descending
// order of trustworthiness.

import type * as THREE from 'three';

// Unit separator, not a printable character: layer/object names may contain anything a user can
// type, and 'a' + ':' + 'b:c' must not collide with 'a:b' + ':' + 'c'.
const SEP = String.fromCharCode(31);

/**
 * Resolution order:
 * 1. `userData.id` — display items (curves, points) arrive with a pre-built pick key.
 * 2. `sourceComponentId` + `originalIndex` — meshes. Component GUID is stable across solves.
 * 3. `name` + `layer` — fallback for content predating `sourceComponentId`. Weaker: two unnamed
 *    meshes on one layer collide, but it lets hiding survive a solve on older definitions.
 */
export function getStableKey(object: THREE.Object3D): string | null {
	const data = object.userData;
	if (!data) return null;

	if (typeof data.id === 'string' && data.id) return data.id;

	if (typeof data.sourceComponentId === 'string' && data.sourceComponentId) {
		// `originalIndex` is 0 for the first mesh of a component, so check presence, not truthiness.
		const index = typeof data.originalIndex === 'number' ? data.originalIndex : 0;
		return `gh${SEP}${data.sourceComponentId}${SEP}${index}`;
	}

	const name = typeof data.name === 'string' ? data.name : object.name;
	const layer = typeof data.layer === 'string' ? data.layer : '';
	if (name) return `name${SEP}${layer}${SEP}${name}`;

	return null;
}

/**
 * The key an object is tracked under: its stable identity, or its instance uuid when it has none.
 * Use this, not `getStableKey`, when reading the backing set directly (e.g. for a reactive lookup
 * that bypasses `VisibilityState.isHidden`) — `getStableKey` alone misses unidentified objects.
 */
export function getTrackingKey(object: THREE.Object3D): string {
	return getStableKey(object) ?? object.uuid;
}
