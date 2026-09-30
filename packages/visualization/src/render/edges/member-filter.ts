import type * as THREE from 'three';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { getHiddenMembers, onMemberDrawChange } from '../../shared/index.js';
import { membersOf } from '../scene-setup/merged-picking.js';
import type { ExtractedEdges } from './extraction.js';
import { buildLineGeometry } from './line-geometry.js';

// ============================================================================
// Edge overlay of a merged mesh follows its hidden members
// ============================================================================
//
// Hiding a member stops its triangles drawing, but the overlay is one line soup for the whole
// merged mesh, so its edges would stay behind as a floating outline. Each segment carries its
// source triangle, so the overlay rebuilds its line geometry from the segments of drawn members.

/** Per segment, the index of the member whose index window holds its source triangle. */
function memberOfSegments(mesh: THREE.Mesh, faces: Uint32Array): Uint32Array | null {
	const members = membersOf(mesh);
	if (!members) return null;
	const starts: number[] = [];
	for (const member of members) {
		if (member.indexStart == null) return null;
		starts.push(member.indexStart);
	}

	const result = new Uint32Array(faces.length);
	for (let s = 0; s < faces.length; s++) {
		const indexPosition = faces[s]! * 3;
		// Last window starting at or before this triangle; windows are ascending and contiguous.
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (starts[mid]! <= indexPosition) low = mid;
			else high = mid - 1;
		}
		result[s] = low;
	}
	return result;
}

function visibleSegments(
	segments: Float32Array,
	memberOf: Uint32Array,
	hidden: ReadonlySet<number>
): Float32Array {
	let count = 0;
	for (let s = 0; s < memberOf.length; s++) if (!hidden.has(memberOf[s]!)) count++;

	const out = new Float32Array(count * 6);
	let offset = 0;
	for (let s = 0; s < memberOf.length; s++) {
		if (hidden.has(memberOf[s]!)) continue;
		out.set(segments.subarray(s * 6, s * 6 + 6), offset);
		offset += 6;
	}
	return out;
}

/** Keeps `overlay` in step with the hidden members of `mesh`, its parent. */
export function followHiddenMembers(
	overlay: LineSegments2,
	mesh: THREE.Mesh,
	edges: ExtractedEdges
): void {
	const { segments, faces } = edges;
	if (!faces || !membersOf(mesh)) return;

	let memberOf: Uint32Array | null | undefined;
	let filtered = false;

	const apply = () => {
		const hidden = getHiddenMembers(mesh);
		if (hidden.size === 0 && !filtered) return;

		memberOf ??= memberOfSegments(mesh, faces);
		if (!memberOf) return;

		const next = hidden.size === 0 ? segments : visibleSegments(segments, memberOf, hidden);
		overlay.geometry.dispose();
		overlay.geometry = buildLineGeometry(next).geometry;
		filtered = hidden.size > 0;
	};

	apply();
	const unsubscribe = onMemberDrawChange(mesh, apply);
	overlay.addEventListener('removed', unsubscribe);
}
