// ============================================================================
// Scene entries: one listable thing per source object
// ============================================================================
//
// The outliner used to list `THREE.Object3D`s directly, which held while one source object was one
// THREE object. Merging by material breaks that: an imported building model renders as a few dozen
// merged meshes, so listing objects would show a few dozen rows named after whichever member
// happened to be first, and the building elements the user actually works with would be
// unreachable.
//
// An entry is one *listable* thing — a plain object, or one member inside a merged mesh. Rendering
// stays merged (that is what keeps the model fast); only the listing is expanded. Entries carry the
// identity key visibility already uses, so hiding a row works the same either way.

import type * as THREE from 'three';

import { getMemberKeys, getTrackingKey, type MergedMember } from './identity.js';
import { getObjectLabel, getSceneObjects, prettyType } from './objects.js';

export interface SceneEntry {
	/** The THREE object that renders this entry — the merged mesh when `member` is set. */
	object: THREE.Object3D;
	/** The member's index within `object.userData.members`, or null for a whole object. */
	memberIndex: number | null;
	/**
	 * Stable identity, and the row key. Matches the key visibility stores, so a row's eye toggles
	 * exactly the thing the row names.
	 */
	key: string;
	label: string;
	layer: string;
}

/** Members of a merged mesh, or null for an ordinary object. */
function membersOf(object: THREE.Object3D): MergedMember[] | null {
	const members = object.userData?.members as MergedMember[] | undefined;
	return Array.isArray(members) && members.length > 0 ? members : null;
}

const layerOf = (object: THREE.Object3D, fallback: string): string =>
	object.userData?.layer || object.userData?.category || fallback;

/**
 * One entry per source object: merged meshes expand into their members, everything else stays
 * itself. Member keys come from {@link getMemberKeys}, which is the same order as `members`, so a
 * row and the hidden-set agree on identity.
 */
export function getSceneEntries(scene: THREE.Scene, defaultLayer: string): SceneEntry[] {
	const entries: SceneEntry[] = [];

	for (const object of getSceneObjects(scene)) {
		const members = membersOf(object);
		if (!members) {
			entries.push({
				object,
				memberIndex: null,
				key: getTrackingKey(object),
				label: getObjectLabel(object),
				layer: layerOf(object, defaultLayer)
			});
			continue;
		}

		const keys = getMemberKeys(object);
		members.forEach((member, i) => {
			entries.push({
				object,
				memberIndex: i,
				key: keys[i] ?? `${object.uuid}:${i}`,
				label: member.name || prettyType(object.type),
				// A merge never spans layers (`splitGroupByLayer`), so the member's layer and its
				// mesh's agree; the member's is used anyway, since it is the one being listed.
				layer: member.layer || layerOf(object, defaultLayer)
			});
		});
	}

	return entries;
}
