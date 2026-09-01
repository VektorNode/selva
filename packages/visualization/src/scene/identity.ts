// ============================================================================
// Stable object identity across solves
// ============================================================================
//
// A solve discards all content and rebuilds it, so `THREE.Object3D.uuid` (assigned per instance)
// cannot answer "is this the same wall I hid a minute ago". Anything that must outlive a solve
// (hidden state, selection, per-object overrides) keys on the writer-minted object id instead,
// stamped by the parse layer as `userData.trackingKey` (Selva mints
// `{componentGuid}/{branchPath}/{slotIndex}`; the viewer never parses it).
//
// A merged mesh is several source objects in one THREE object, so its identity is per member:
// `userData.members` carries each member's key, and the hidden-set stores member keys.

import type * as THREE from 'three';

// Unit separator, not a printable character: layer/object names may contain anything a user can
// type, and 'a' + ':' + 'b:c' must not collide with 'a:b' + ':' + 'c'.
const SEP = String.fromCharCode(31);

/** One source object inside a merged mesh, see `finalizeMergedMesh`. */
export interface MergedMember {
	trackingKey?: string;
	name: string;
	layer: string;
	metadata: Record<string, string>;
	/** Start of this member's window into the merged index buffer; absent on older merges. */
	indexStart?: number;
	/** Length of that window, in indices. */
	indexCount?: number;
}

/**
 * The minted `userData.trackingKey` when the writer supplied one; `userData.id` for display
 * items (their pre-baked pick key); `name` + `layer` as a weaker fallback for foreign writers
 * that mint no ids (two unnamed meshes on one layer collide under it).
 */
export function getStableKey(object: THREE.Object3D): string | null {
	const data = object.userData;
	if (!data) return null;

	if (typeof data.trackingKey === 'string' && data.trackingKey) return data.trackingKey;

	// Display items carry their minted id under `id` (which doubles as the pick key).
	if (typeof data.id === 'string' && data.id) return data.id;

	const name = typeof data.name === 'string' ? data.name : object.name;
	const layer = typeof data.layer === 'string' ? data.layer : '';
	if (name) return `name${SEP}${layer}${SEP}${name}`;

	return null;
}

/** Falls back to the instance uuid when the object has no stable identity, unlike `getStableKey`. */
export function getTrackingKey(object: THREE.Object3D): string {
	return getStableKey(object) ?? object.uuid;
}

/**
 * The identity keys hidden state hangs off: each member's key for a merged mesh, the object's own
 * for everything else. A member without a minted key falls back to its name + layer, then to the
 * merged object's uuid (per-instance, like any other identity-less object).
 */
export function getMemberKeys(object: THREE.Object3D): string[] {
	const members = object.userData?.members as MergedMember[] | undefined;
	if (!Array.isArray(members) || members.length === 0) {
		return [getTrackingKey(object)];
	}

	return members.map((member, i) => {
		if (typeof member.trackingKey === 'string' && member.trackingKey) return member.trackingKey;
		if (member.name) return `name${SEP}${member.layer}${SEP}${member.name}`;
		return `${object.uuid}${SEP}${i}`;
	});
}
