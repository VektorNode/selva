import * as THREE from 'three';

import {
	clearMemberHighlight,
	setMemberHighlight,
	type HighlightKind
} from '../../shared/index.js';
import type { SelectionTarget } from './viewer.js';

// ============================================================================
// Picking inside a merged mesh
// ============================================================================
//
// Merging by material collapses thousands of source objects into a handful of THREE.Mesh objects,
// which is what keeps an IFC-scale model renderable. The cost is that a raycast can only name the
// merged mesh, not the wall the user actually clicked — so selection and the metadata panel would
// both address the whole group.
//
// `userData.members` carries each source object's window into the merged index buffer
// (`finalizeMergedMesh`), and the raycast reports which face it hit. Face → index range → member
// recovers the original object, so highlight and metadata stay per-object even though rendering is
// per-group.

/** Mirror of the record `parse/webdisplay/batch/merge.ts` stamps into `userData.members`. */
export interface PickableMember {
	trackingKey?: string;
	name: string;
	layer: string;
	metadata: Record<string, string>;
	indexStart?: number;
	indexCount?: number;
}

export interface ResolvedMember {
	member: PickableMember;
	index: number;
}

/** Members of a merged mesh, or null for an ordinary one. */
export function membersOf(object: THREE.Object3D): PickableMember[] | null {
	const members = object.userData?.members as PickableMember[] | undefined;
	return Array.isArray(members) && members.length > 0 ? members : null;
}

/**
 * The source object a raycast hit landed on, or null when this isn't a merged mesh or the hit
 * carries no face (points/lines, or a member written without an index window).
 *
 * Members are laid out in ascending, contiguous index order, so this is a binary search rather
 * than a scan — a merged group can hold thousands of members and picking runs per click.
 */
export function resolveHitMember(hit: THREE.Intersection): ResolvedMember | null {
	const members = membersOf(hit.object);
	if (!members || hit.faceIndex == null) return null;

	// Three reports the face ordinal; each face is 3 indices into the merged index buffer.
	const hitIndex = hit.faceIndex * 3;

	let low = 0;
	let high = members.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const member = members[mid]!;
		if (member.indexStart == null || member.indexCount == null) return null;
		if (hitIndex < member.indexStart) high = mid - 1;
		else if (hitIndex >= member.indexStart + member.indexCount) low = mid + 1;
		else return { member, index: mid };
	}
	return null;
}

/**
 * Every rendering of the source object minted `key` on `layer`. A material is per mesh, so a writer
 * that draws one object in two materials sends two meshes under one id; they pick as one.
 */
export function partsWithKey(scene: THREE.Scene, key: string, layer: string): SelectionTarget[] {
	const parts: SelectionTarget[] = [];
	scene.traverse((object) => {
		const members = membersOf(object);
		if (!members) {
			const data = object.userData;
			if (data?.trackingKey === key && (data.layer ?? '') === layer) {
				parts.push({ object, memberIndex: null });
			}
			return;
		}
		members.forEach((member, memberIndex) => {
			if (member.trackingKey === key && (member.layer ?? '') === layer) {
				parts.push({ object, memberIndex });
			}
		});
	});
	return parts;
}

/** {@link partsWithKey} for a raycast hit; just the hit itself when it carries no minted id. */
export function partsOfHit(scene: THREE.Scene, hit: THREE.Intersection): SelectionTarget[] {
	const resolved = resolveHitMember(hit);
	const data = resolved ? resolved.member : hit.object.userData;
	const own = { object: hit.object, memberIndex: resolved?.index ?? null };
	if (typeof data?.trackingKey !== 'string' || !data.trackingKey) return [own];
	const parts = partsWithKey(scene, data.trackingKey, data.layer ?? '');
	return parts.length > 1 ? parts : [own];
}

/**
 * World-space bounds of one member inside a merged mesh, walking only that member's index window.
 * `Box3.setFromObject` would return the whole merged group's bounds.
 */
export function memberBounds(mesh: THREE.Mesh, member: PickableMember): THREE.Box3 {
	const box = new THREE.Box3();
	const index = mesh.geometry.getIndex();
	const position = mesh.geometry.getAttribute('position');
	if (!index || !position || member.indexStart == null || member.indexCount == null) return box;

	mesh.updateMatrixWorld();
	const vertex = new THREE.Vector3();
	const end = Math.min(member.indexStart + member.indexCount, index.count);
	for (let i = member.indexStart; i < end; i++) {
		vertex.fromBufferAttribute(position, index.getX(i)).applyMatrix4(mesh.matrixWorld);
		box.expandByPoint(vertex);
	}
	return box;
}

/**
 * Draws members of a merged mesh with `highlight`. Returns a restore function; call it before
 * applying a different highlight. Members hidden by the outliner stay hidden either way.
 */
export function highlightMembers(
	mesh: THREE.Mesh,
	members: ReadonlySet<number>,
	highlight: THREE.Material,
	kind?: HighlightKind
): () => void {
	setMemberHighlight(mesh, members, highlight, kind);
	return () => clearMemberHighlight(mesh, kind);
}
