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
 * Tries, in order: `userData.id` (display items arrive with a pre-built pick key), then
 * `sourceComponentId` + `originalIndex` (component GUID is stable across solves), then
 * `name` + `layer` as a weaker fallback — two unnamed meshes on one layer collide under it.
 */
export function getStableKey(object: THREE.Object3D): string | null {
	const data = object.userData;
	if (!data) return null;

	if (typeof data.id === 'string' && data.id) return data.id;

	if (typeof data.sourceComponentId === 'string' && data.sourceComponentId) {
		// A merged mesh covers several source meshes and its `originalIndex` is only the first
		// member's, which collides with every other merge starting at the same index. Key on the
		// whole (sorted, so material grouping order can't change it) member set when there is one.
		if (Array.isArray(data.mergedIndices) && data.mergedIndices.length > 0) {
			const members = [...data.mergedIndices].sort((a, b) => a - b).join(',');
			return `gh${SEP}${data.sourceComponentId}${SEP}m${SEP}${members}`;
		}
		// `originalIndex` is 0 for the first mesh of a component, so check presence, not truthiness.
		// A missing index must NOT default to 0: every indexless mesh of the component would then
		// share one key, and hiding any one of them would hide all of them. Fall through to the
		// weaker keys instead, which at worst degrade to a per-instance uuid.
		if (typeof data.originalIndex === 'number') {
			return `gh${SEP}${data.sourceComponentId}${SEP}${data.originalIndex}`;
		}
	}

	const name = typeof data.name === 'string' ? data.name : object.name;
	const layer = typeof data.layer === 'string' ? data.layer : '';
	if (name) return `name${SEP}${layer}${SEP}${name}`;

	return null;
}

/** Falls back to the instance uuid when the object has no stable identity, unlike `getStableKey`. */
export function getTrackingKey(object: THREE.Object3D): string {
	return getStableKey(object) ?? object.uuid;
}
