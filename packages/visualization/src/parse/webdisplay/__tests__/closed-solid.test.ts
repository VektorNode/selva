import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';

import { isClosedSolid } from '../closed-solid';

/** Positions and a Uint32 index, as the assembly stage hands them over. */
function buffersOf(geometry: THREE.BufferGeometry) {
	return {
		positions: new Float32Array(geometry.getAttribute('position').array),
		indices: new Uint32Array(geometry.getIndex()!.array)
	};
}

const check = (geometry: THREE.BufferGeometry, counts?: number[]) => {
	const { positions, indices } = buffersOf(geometry);
	return isClosedSolid(positions, indices, counts ?? [indices.length]);
};

describe('isClosedSolid', () => {
	it('welds a box whose faces carry their own vertices', () => {
		// BoxGeometry duplicates every corner per face, as Rhino does per Brep face.
		expect(check(new THREE.BoxGeometry(1, 0.0005, 1))).toBe(true);
	});

	it('accepts a sphere', () => {
		// three's UV seam isn't bit-exact (sin 2π ≠ 0), so weld it first; this case is about topology.
		const sphere = new THREE.SphereGeometry(1, 16, 12);
		sphere.deleteAttribute('uv');
		sphere.deleteAttribute('normal');
		expect(check(mergeVertices(sphere))).toBe(true);
	});

	it('welds -0 and +0 as one position', () => {
		const box = new THREE.BoxGeometry(2, 2, 2);
		const position = box.getAttribute('position');
		for (let i = 0; i < position.count; i++) {
			if (position.getX(i) > 0) position.setX(i, 0); // collapse the +X half onto x = 0 ...
		}
		for (let i = 0; i < position.count; i += 2) {
			if (position.getX(i) === 0) position.setX(i, -0); // ... spelled both ways
		}
		expect(check(box)).toBe(true);
	});

	it('rejects an open box', () => {
		const box = new THREE.BoxGeometry(1, 1, 1);
		box.setIndex(Array.from(box.getIndex()!.array).slice(6)); // drop one face
		expect(check(box)).toBe(false);
	});

	it('rejects an inward-wound box', () => {
		const box = new THREE.BoxGeometry(1, 1, 1);
		const index = Array.from(box.getIndex()!.array);
		for (let i = 0; i < index.length; i += 3)
			[index[i + 1], index[i + 2]] = [index[i + 2]!, index[i + 1]!];
		box.setIndex(index);
		expect(check(box)).toBe(false);
	});

	it('rejects inconsistent winding', () => {
		const box = new THREE.BoxGeometry(1, 1, 1);
		const index = Array.from(box.getIndex()!.array);
		[index[1], index[2]] = [index[2]!, index[1]!];
		box.setIndex(index);
		expect(check(box)).toBe(false);
	});

	it('rejects a flat plane', () => {
		expect(check(new THREE.PlaneGeometry(1, 1, 4, 4))).toBe(false);
	});

	it('tests merged members apart, so two touching solids still count as closed', () => {
		// Sharing a face would make the pair non-manifold if welded together.
		const a = new THREE.BoxGeometry(1, 1, 1);
		const b = new THREE.BoxGeometry(1, 1, 1).translate(1, 0, 0);
		const merged = mergeGeometries([a, b]);
		const count = a.getIndex()!.count;

		expect(check(merged, [count, count])).toBe(true);
		expect(check(merged)).toBe(false);
	});

	it('is false when any member is open', () => {
		const open = new THREE.PlaneGeometry(1, 1);
		const merged = mergeGeometries([new THREE.BoxGeometry(1, 1, 1), open]);
		const boxCount = 36;

		expect(check(merged, [boxCount, open.getIndex()!.count])).toBe(false);
	});
});
