import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_LAYER, filterLayerGroups, groupByLayer } from '../layers.js';

const obj = (data: Record<string, unknown>) => {
	const mesh = new THREE.Mesh();
	mesh.userData = data;
	return mesh;
};

describe('groupByLayer', () => {
	it('groups by userData.layer', () => {
		const a = obj({ layer: 'Walls' });
		const b = obj({ layer: 'Roof' });
		const c = obj({ layer: 'Walls' });

		const groups = groupByLayer([a, b, c]);

		expect([...groups.keys()]).toEqual(['Walls', 'Roof']);
		expect(groups.get('Walls')).toEqual([a, c]);
	});

	it('falls back to category, then to the default layer', () => {
		const groups = groupByLayer([obj({ category: 'Furniture' }), obj({})]);

		expect(groups.get('Furniture')).toHaveLength(1);
		expect(groups.get(DEFAULT_LAYER)).toHaveLength(1);
	});

	it('prefers layer over category when both are present', () => {
		const groups = groupByLayer([obj({ layer: 'Walls', category: 'Furniture' })]);
		expect([...groups.keys()]).toEqual(['Walls']);
	});

	it('preserves scene-graph order rather than sorting', () => {
		const groups = groupByLayer([obj({ layer: 'Z' }), obj({ layer: 'A' })]);
		expect([...groups.keys()]).toEqual(['Z', 'A']);
	});
});

describe('filterLayerGroups', () => {
	const groups = () =>
		groupByLayer([
			obj({ layer: 'Walls', name: 'north' }),
			obj({ layer: 'Walls', name: 'south' }),
			obj({ layer: 'Roof', name: 'ridge' })
		]);

	it('returns the input untouched for an empty or whitespace query', () => {
		const input = groups();
		expect(filterLayerGroups(input, '')).toBe(input);
		expect(filterLayerGroups(input, '   ')).toBe(input);
	});

	it('keeps every object of a layer whose name matches', () => {
		const filtered = filterLayerGroups(groups(), 'walls');
		expect(filtered.get('Walls')).toHaveLength(2);
		expect(filtered.has('Roof')).toBe(false);
	});

	it('keeps only the matching objects of a non-matching layer', () => {
		const filtered = filterLayerGroups(groups(), 'north');
		expect(filtered.get('Walls')).toHaveLength(1);
	});

	it('drops layers with no match at all', () => {
		expect(filterLayerGroups(groups(), 'nothing').size).toBe(0);
	});

	it('is case-insensitive on both layer and object names', () => {
		expect(filterLayerGroups(groups(), 'RIDGE').get('Roof')).toHaveLength(1);
		expect(filterLayerGroups(groups(), 'ROOF').get('Roof')).toHaveLength(1);
	});
});
