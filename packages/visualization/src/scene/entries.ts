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

/** One rendering of an entry: a whole object, or one member inside a merged mesh. */
export interface EntryPart {
	object: THREE.Object3D;
	/** The member's index within `object.userData.members`, or null for a whole object. */
	memberIndex: number | null;
}

export interface SceneEntry extends EntryPart {
	/**
	 * Every rendering of this entry, the entry's own `object`/`memberIndex` first. More than one when
	 * a writer split one source object across materials (a sheet coated on one face) and gave the
	 * pieces one id: a material is per mesh, so the object arrives as several.
	 */
	parts: EntryPart[];
	/**
	 * Stable identity. Matches the key visibility stores, so a row's eye toggles exactly the thing
	 * the row names. Deliberately not unique: two identity-less objects sharing a name and layer
	 * collide here, and that collision means "these hide together". Key a list on
	 * {@link rowKey} instead.
	 */
	key: string;
	/**
	 * {@link key}, made unique across the returned entries by suffixing repeats. Keying a list on
	 * `key` throws on the collisions identity deliberately tolerates.
	 */
	rowKey: string;
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
	// Occurrences of each identity key so far, so the nth repeat of one key becomes `key#n`.
	const seen = new Map<string, number>();
	const rowKeyFor = (key: string): string => {
		const n = seen.get(key) ?? 0;
		seen.set(key, n + 1);
		return n === 0 ? key : `${key}#${n}`;
	};

	// Entries by writer-minted id within a layer. Only minted ids fold into one row: a name + layer
	// fallback key repeats for objects that are merely named alike.
	const minted = new Map<string, SceneEntry>();
	const add = (part: EntryPart, key: string, isMinted: boolean, label: string, layer: string) => {
		const slot = `${layer}\u001f${key}`;
		const existing = isMinted ? minted.get(slot) : undefined;
		if (existing) {
			existing.parts.push(part);
			return;
		}
		const entry: SceneEntry = { ...part, parts: [part], key, rowKey: rowKeyFor(key), label, layer };
		if (isMinted) minted.set(slot, entry);
		entries.push(entry);
	};

	for (const object of getSceneObjects(scene)) {
		const members = membersOf(object);
		if (!members) {
			add(
				{ object, memberIndex: null },
				getTrackingKey(object),
				!!object.userData?.trackingKey,
				getObjectLabel(object),
				layerOf(object, defaultLayer)
			);
			continue;
		}

		const keys = getMemberKeys(object);
		members.forEach((member, i) => {
			add(
				{ object, memberIndex: i },
				keys[i] ?? `${object.uuid}:${i}`,
				!!member.trackingKey,
				member.name || prettyType(object.type),
				// A merge never spans layers (`splitGroupByLayer`), so the member's layer and its
				// mesh's agree; the member's is used anyway, since it is the one being listed.
				member.layer || layerOf(object, defaultLayer)
			);
		});
	}

	return entries;
}
