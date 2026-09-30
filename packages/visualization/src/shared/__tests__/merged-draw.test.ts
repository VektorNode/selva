import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { mergedBoxes } from '@tests/helpers/merged-mesh';

import {
	clearMemberHighlight,
	getBaseMaterial,
	getHiddenMembers,
	onMemberDrawChange,
	setHiddenMembers,
	setMemberHighlight
} from '../merged-draw';

const ranges = (mesh: THREE.Mesh) =>
	mesh.geometry.groups.map((g) => [g.start, g.count, g.materialIndex]);

/** Member indices a ray along -z hits, one ray per box. */
function hitMembers(mesh: THREE.Mesh, count = 3): number[] {
	const raycaster = new THREE.Raycaster();
	const hits: number[] = [];
	for (let m = 0; m < count; m++) {
		raycaster.set(new THREE.Vector3(m * 10, 0, 5), new THREE.Vector3(0, 0, -1));
		if (raycaster.intersectObject(mesh).length > 0) hits.push(m);
	}
	return hits;
}

describe('merged draw state', () => {
	it('skips a hidden member, which a single material would ignore', () => {
		const mesh = mergedBoxes();
		const base = mesh.material as THREE.Material;

		setHiddenMembers(mesh, new Set([1]));

		// Three only honours groups with an array material.
		expect(mesh.material).toEqual([base]);
		expect(ranges(mesh)).toEqual([
			[0, 36, 0],
			[72, 36, 0]
		]);
		expect(hitMembers(mesh)).toEqual([0, 2]);
	});

	it('restores the plain mesh once nothing is hidden', () => {
		const mesh = mergedBoxes();
		const base = mesh.material;

		setHiddenMembers(mesh, new Set([0]));
		setHiddenMembers(mesh, new Set());

		expect(mesh.material).toBe(base);
		expect(mesh.geometry.groups).toHaveLength(0);
		expect(hitMembers(mesh)).toEqual([0, 1, 2]);
	});

	it('draws nothing when every member is hidden', () => {
		const mesh = mergedBoxes();
		setHiddenMembers(mesh, new Set([0, 1, 2]));
		expect(mesh.geometry.groups).toHaveLength(0);
		expect(hitMembers(mesh)).toEqual([]);
	});

	it('keeps hidden members hidden while another member is highlighted', () => {
		const mesh = mergedBoxes();
		const base = mesh.material as THREE.Material;
		const highlight = new THREE.MeshStandardMaterial();

		setHiddenMembers(mesh, new Set([0]));
		setMemberHighlight(mesh, 2, highlight);

		expect(mesh.material).toEqual([base, highlight]);
		expect(ranges(mesh)).toEqual([
			[36, 36, 0],
			[72, 36, 1]
		]);

		clearMemberHighlight(mesh);

		expect(mesh.material).toEqual([base]);
		// Adjacent members with one material coalesce into one draw.
		expect(ranges(mesh)).toEqual([[36, 72, 0]]);
		expect(getHiddenMembers(mesh)).toEqual(new Set([0]));
	});

	it('reports the base material while the mesh holds an array', () => {
		const mesh = mergedBoxes();
		const base = mesh.material as THREE.Material;
		setHiddenMembers(mesh, new Set([1]));
		expect(getBaseMaterial(mesh)).toBe(base);
	});

	it('notifies listeners on change, not on a repeat of the same set', () => {
		const mesh = mergedBoxes();
		let calls = 0;
		const unsubscribe = onMemberDrawChange(mesh, () => calls++);

		setHiddenMembers(mesh, new Set([1]));
		setHiddenMembers(mesh, new Set([1]));
		unsubscribe();
		setHiddenMembers(mesh, new Set());

		expect(calls).toBe(1);
	});

	it('leaves a mesh without member windows alone', () => {
		const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
		const base = mesh.material;
		const groups = ranges(mesh);
		setHiddenMembers(mesh, new Set([0]));
		expect(mesh.material).toBe(base);
		expect(ranges(mesh)).toEqual(groups);
	});
});
