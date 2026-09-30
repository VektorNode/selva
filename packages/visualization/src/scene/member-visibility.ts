// ============================================================================
// Hiding one member of a merged mesh
// ============================================================================
//
// `.visible` is per THREE object, so it cannot hide one wall inside a merged mesh that draws a
// whole material group. The hidden-set is translated to member indices and handed to
// `shared/merged-draw.ts`, which rebuilds the drawn index ranges to skip them.

import type * as THREE from 'three';

import { setHiddenMembers } from '../shared/index.js';
import { getMemberKeys } from './identity.js';

/** Rebuilds `object`'s drawn ranges from the hidden-set. No-op unless it is a merged mesh. */
export function applyEntryVisibility(object: THREE.Object3D, hidden: Set<string>): void {
	const mesh = object as THREE.Mesh;
	if (!mesh.isMesh || !Array.isArray(mesh.userData?.members)) return;

	const indices = new Set<number>();
	getMemberKeys(mesh).forEach((key, i) => {
		if (hidden.has(key)) indices.add(i);
	});
	setHiddenMembers(mesh, indices);
}
