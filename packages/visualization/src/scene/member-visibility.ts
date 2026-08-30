// ============================================================================
// Hiding one member of a merged mesh
// ============================================================================
//
// `.visible` is per THREE object, so it cannot hide one wall inside a merged mesh that draws a
// whole material group. Instead the mesh's geometry groups are rebuilt to cover only the index
// ranges whose members are still visible: three draws each group as its own range, so an omitted
// member simply isn't drawn.
//
// Adjacent visible members are coalesced into one group, so the common cases cost nothing — an
// untouched mesh is a single group, and hiding one member leaves two.

import type * as THREE from 'three';

import type { MergedMember } from './identity.js';
import { getMemberKeys } from './identity.js';

/** Set on a merged mesh while some of its members are hidden, so the state can be undone. */
const PARTIAL_KEY = 'membersPartiallyHidden';

/**
 * Rebuilds `object`'s drawn ranges from the hidden-set. No-op unless it is a merged mesh whose
 * members carry index windows.
 */
export function applyEntryVisibility(object: THREE.Object3D, hidden: Set<string>): void {
	const members = object.userData?.members as MergedMember[] | undefined;
	if (!Array.isArray(members) || members.length === 0) return;

	const mesh = object as THREE.Mesh;
	if (!mesh.geometry) return;

	const keys = getMemberKeys(object);
	const anyHidden = keys.some((key) => hidden.has(key));

	// Nothing hidden and nothing was: leave the geometry exactly as the parser built it, so an
	// ordinary scene never carries groups it didn't ask for.
	if (!anyHidden && !object.userData[PARTIAL_KEY]) return;

	mesh.geometry.clearGroups();

	if (!anyHidden) {
		delete object.userData[PARTIAL_KEY];
		return;
	}

	object.userData[PARTIAL_KEY] = true;

	let runStart: number | null = null;
	let runEnd = 0;
	for (let i = 0; i < members.length; i++) {
		const member = members[i]!;
		if (member.indexStart == null || member.indexCount == null) continue;

		if (hidden.has(keys[i] ?? '')) {
			if (runStart !== null) {
				mesh.geometry.addGroup(runStart, runEnd - runStart, 0);
				runStart = null;
			}
			continue;
		}

		if (runStart === null) runStart = member.indexStart;
		runEnd = member.indexStart + member.indexCount;
	}
	if (runStart !== null) mesh.geometry.addGroup(runStart, runEnd - runStart, 0);
}
