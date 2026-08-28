import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getStableKey } from '../identity.js';

/** Mirrors the unit separator the keys are built with. */
const S = String.fromCharCode(31);
const meshKey = (componentId: string, index: number) => ['gh', componentId, index].join(S);
const nameKey = (layer: string, name: string) => ['name', layer, name].join(S);

const obj = (data: Record<string, unknown>, threeName = '') => {
	const mesh = new THREE.Mesh();
	mesh.userData = data;
	mesh.name = threeName;
	return mesh;
};

describe('getStableKey', () => {
	it('prefers a display item id', () => {
		expect(getStableKey(obj({ id: 'item-4', sourceComponentId: 'other', name: 'x' }))).toBe(
			'item-4'
		);
	});

	it('builds a mesh key from source component and original index', () => {
		expect(getStableKey(obj({ sourceComponentId: 'gh-1', originalIndex: 7 }))).toBe(
			meshKey('gh-1', 7)
		);
	});

	it('keeps index 0 rather than treating it as missing', () => {
		expect(getStableKey(obj({ sourceComponentId: 'gh-1', originalIndex: 0 }))).toBe(
			meshKey('gh-1', 0)
		);
	});

	// Defaulting a missing index to 0 gave every indexless mesh of a component one key, so hiding
	// any one of them hid all of them — across layers included.
	it('does not collapse indexless meshes of one component onto a shared key', () => {
		const a = getStableKey(obj({ sourceComponentId: 'gh-1', name: 'wall', layer: 'IfcWall' }));
		const b = getStableKey(obj({ sourceComponentId: 'gh-1', name: 'slab', layer: 'IfcSlab' }));
		expect(a).not.toBe(b);
	});

	it('falls back to the weaker name+layer key when the index is missing', () => {
		expect(getStableKey(obj({ sourceComponentId: 'gh-1', name: 'wall', layer: 'IfcWall' }))).toBe(
			`name${S}IfcWall${S}wall`
		);
	});

	it('distinguishes objects from the same component', () => {
		const a = getStableKey(obj({ sourceComponentId: 'gh-1', originalIndex: 0 }));
		const b = getStableKey(obj({ sourceComponentId: 'gh-1', originalIndex: 1 }));
		expect(a).not.toBe(b);
	});

	describe('merged meshes', () => {
		// Both merges report member 0 as their `originalIndex`, so keying on that alone made hiding
		// one hide the other.
		it('distinguishes two merges that start at the same index', () => {
			const a = getStableKey(
				obj({ sourceComponentId: 'gh-1', originalIndex: 0, mergedIndices: [0, 1] })
			);
			const b = getStableKey(
				obj({ sourceComponentId: 'gh-1', originalIndex: 0, mergedIndices: [0, 2] })
			);
			expect(a).not.toBe(b);
		});

		it('does not collide with an unmerged mesh at the same index', () => {
			const merged = getStableKey(
				obj({ sourceComponentId: 'gh-1', originalIndex: 4, mergedIndices: [4, 5] })
			);
			expect(merged).not.toBe(meshKey('gh-1', 4));
		});

		// Material grouping decides member order, and it is not stable across solves.
		it('is independent of member order', () => {
			const a = getStableKey(obj({ sourceComponentId: 'gh-1', mergedIndices: [2, 0, 1] }));
			const b = getStableKey(obj({ sourceComponentId: 'gh-1', mergedIndices: [0, 1, 2] }));
			expect(a).toBe(b);
		});

		it('ignores an empty member list rather than keying on it', () => {
			expect(
				getStableKey(obj({ sourceComponentId: 'gh-1', originalIndex: 3, mergedIndices: [] }))
			).toBe(meshKey('gh-1', 3));
		});
	});

	it('falls back to name and layer when there is no component id', () => {
		expect(getStableKey(obj({ name: 'north wall', layer: 'Walls' }))).toBe(
			nameKey('Walls', 'north wall')
		);
	});

	it('separates same-named objects on different layers', () => {
		const a = getStableKey(obj({ name: 'wall', layer: 'A' }));
		const b = getStableKey(obj({ name: 'wall', layer: 'B' }));
		expect(a).not.toBe(b);
	});

	it('does not let a layer/name split ambiguity collide', () => {
		// With a printable separator, 'A' + 'B:C' and 'A:B' + 'C' would produce the same key.
		const a = getStableKey(obj({ layer: 'A', name: 'B:C' }));
		const b = getStableKey(obj({ layer: 'A:B', name: 'C' }));
		expect(a).not.toBe(b);
	});

	it('uses the three name when userData carries none', () => {
		expect(getStableKey(obj({ layer: 'Walls' }, 'from-three'))).toBe(
			nameKey('Walls', 'from-three')
		);
	});

	it('returns null when nothing identifies the object', () => {
		expect(getStableKey(obj({}))).toBeNull();
		expect(getStableKey(obj({ layer: 'Walls' }))).toBeNull();
	});

	it('returns null when userData is absent', () => {
		const mesh = new THREE.Mesh();
		// three defaults userData to {}, so clear it explicitly to cover the guard.
		(mesh as { userData: unknown }).userData = undefined;
		expect(getStableKey(mesh)).toBeNull();
	});

	it('ignores empty-string ids rather than keying on them', () => {
		expect(getStableKey(obj({ id: '', sourceComponentId: 'gh-1', originalIndex: 2 }))).toBe(
			meshKey('gh-1', 2)
		);
	});

	it('is stable across rebuilt instances of the same geometry', () => {
		// What a solve does: same Grasshopper source, brand-new THREE object (and uuid).
		const before = obj({ sourceComponentId: 'gh-1', originalIndex: 3 });
		const after = obj({ sourceComponentId: 'gh-1', originalIndex: 3 });

		expect(after.uuid).not.toBe(before.uuid);
		expect(getStableKey(after)).toBe(getStableKey(before));
	});
});
