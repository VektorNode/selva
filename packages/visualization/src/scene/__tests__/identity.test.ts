import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getMemberKeys, getStableKey } from '../identity.js';

/** Mirrors the unit separator the fallback keys are built with. */
const S = String.fromCharCode(31);
const nameKey = (layer: string, name: string) => ['name', layer, name].join(S);

const obj = (data: Record<string, unknown>, threeName = '') => {
	const mesh = new THREE.Mesh();
	mesh.userData = data;
	mesh.name = threeName;
	return mesh;
};

describe('getStableKey', () => {
	it('reads the minted tracking key verbatim', () => {
		expect(getStableKey(obj({ trackingKey: 'gh-1/{0;1}/3', name: 'x', layer: 'L' }))).toBe(
			'gh-1/{0;1}/3'
		);
	});

	it('reads a display item id', () => {
		expect(getStableKey(obj({ id: 'item-4', name: 'x' }))).toBe('item-4');
	});

	it('prefers the tracking key over the item id', () => {
		expect(getStableKey(obj({ trackingKey: 'k', id: 'item-4' }))).toBe('k');
	});

	it('is stable across rebuilt instances of the same geometry', () => {
		// What a solve does: same Grasshopper source, brand-new THREE object (and uuid).
		const before = obj({ trackingKey: 'gh-1/{0}/3' });
		const after = obj({ trackingKey: 'gh-1/{0}/3' });

		expect(after.uuid).not.toBe(before.uuid);
		expect(getStableKey(after)).toBe(getStableKey(before));
	});

	it('falls back to name and layer when the writer minted no id', () => {
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

	it('ignores empty-string keys rather than keying on them', () => {
		expect(getStableKey(obj({ trackingKey: '', id: '', name: 'wall', layer: 'A' }))).toBe(
			nameKey('A', 'wall')
		);
	});
});

describe('getMemberKeys', () => {
	it('returns each member key of a merged mesh', () => {
		const merged = obj({
			members: [
				{ trackingKey: 'gh-1/{0}/0', name: 'a', layer: 'L', metadata: {} },
				{ trackingKey: 'gh-1/{0}/2', name: 'b', layer: 'L', metadata: {} }
			]
		});
		expect(getMemberKeys(merged)).toEqual(['gh-1/{0}/0', 'gh-1/{0}/2']);
	});

	it('falls back to a member name+layer key when a member has no minted id', () => {
		const merged = obj({
			members: [{ name: 'wall', layer: 'Walls', metadata: {} }]
		});
		expect(getMemberKeys(merged)).toEqual([nameKey('Walls', 'wall')]);
	});

	it('degrades an unidentifiable member to a per-instance key', () => {
		const merged = obj({
			members: [{ name: '', layer: '', metadata: {} }]
		});
		expect(getMemberKeys(merged)).toEqual([`${merged.uuid}${S}0`]);
	});

	it('returns the object own key when there are no members', () => {
		expect(getMemberKeys(obj({ trackingKey: 'gh-1/{0}/7' }))).toEqual(['gh-1/{0}/7']);
	});

	it('falls back to the uuid for an identity-less unmerged object', () => {
		const plain = obj({});
		expect(getMemberKeys(plain)).toEqual([plain.uuid]);
	});
});
