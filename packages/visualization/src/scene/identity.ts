// ============================================================================
// Stable object identity across solves
// ============================================================================
//
// `THREE.Object3D.uuid` is assigned per instance, and a solve discards all content and rebuilds it.
// So a uuid answers "which object is this right now" but never "is this the same wall I hid a
// minute ago". Anything that must outlive a solve — hidden state, selection, per-object overrides —
// has to key on what the geometry *is*, not on the instance currently representing it.
//
// Grasshopper gives us no object GUIDs, so identity is synthesized from what the parse layer
// records in `userData`, in descending order of trustworthiness.

import type * as THREE from 'three';

/**
 * Separator for composite keys. A unit separator rather than a printable character: layer and
 * object names may contain anything a user can type, and `'a' + ':' + 'b:c'` must not collide with
 * `'a:b' + ':' + 'c'`.
 */
const SEP = String.fromCharCode(31);

/**
 * A stable key for an object across solves, or `null` when it carries nothing identifying.
 *
 * Resolution order:
 * 1. `userData.id` — display items (curves, points) arrive with a pre-built pick key.
 * 2. `sourceComponentId` + `originalIndex` — meshes. Component GUID is stable across solves;
 *    index is the geometry's position in that component's output.
 * 3. `name` + `layer` — fallback for content from plugin versions predating `sourceComponentId`.
 *    Weaker: two unnamed meshes on one layer collide. Accepted so hiding still survives a solve
 *    on older definitions.
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
 *
 * This is what visibility state is recorded against. A host that needs to look the state up in the
 * backing set directly — rather than through `VisibilityState.isHidden`, e.g. to make the lookup a
 * reactive read — must use this, not `getStableKey`, or unidentified objects will miss.
 */
export function getTrackingKey(object: THREE.Object3D): string {
	return getStableKey(object) ?? object.uuid;
}
