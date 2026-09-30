import * as THREE from 'three';

import { clearMemberHighlight, setMemberHighlight } from '../../shared/index.js';

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
 * Draws one member of a merged mesh with `highlight`. Returns a restore function; call it before
 * applying a different highlight. Members hidden by the outliner stay hidden either way.
 */
export function highlightMemberRange(
	mesh: THREE.Mesh,
	member: PickableMember,
	highlight: THREE.Material
): () => void {
	const index = membersOf(mesh)?.indexOf(member) ?? -1;
	if (index < 0 || member.indexStart == null || member.indexCount == null) return () => {};

	setMemberHighlight(mesh, index, highlight);
	return () => clearMemberHighlight(mesh);
}
