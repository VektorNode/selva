import { describe, expect, it } from 'vitest';

import { mergeGroupsOf } from '../batch/merge.js';
import type { MeshMetadata } from '../types.js';

const mesh = (name: string, layer = ''): MeshMetadata => ({
	name,
	layer,
	vertexCount: 3,
	indexCount: 3,
	vertexStart: 0,
	indexStart: 0
});

describe('mergeGroupsOf', () => {
	it('gathers interleaved runs of one material into one group, in input order', () => {
		const merged = mergeGroupsOf([
			{ materialId: 0, meshes: [mesh('a')] },
			{ materialId: 1, meshes: [mesh('b')] },
			{ materialId: 0, meshes: [mesh('c'), mesh('d')] }
		]);

		expect(merged.map((g) => [g.materialId, g.meshes.map((m) => m.name)])).toEqual([
			[0, ['a', 'c', 'd']],
			[1, ['b']]
		]);
	});

	it('still never merges across layers', () => {
		const merged = mergeGroupsOf([
			{ materialId: 0, meshes: [mesh('a', 'Walls')] },
			{ materialId: 1, meshes: [mesh('b', 'Walls')] },
			{ materialId: 0, meshes: [mesh('c', 'Roof')] }
		]);

		expect(merged.map((g) => g.meshes.map((m) => m.name))).toEqual([['a'], ['c'], ['b']]);
	});

	it('gathers 200k meshes of one material without overflowing the stack', () => {
		// Regression: push(...group.meshes) passed every mesh as an argument.
		const many = Array.from({ length: 200_000 }, (_, i) => mesh(String(i)));
		const merged = mergeGroupsOf([
			{ materialId: 0, meshes: [mesh('first')] },
			{ materialId: 0, meshes: many }
		]);

		expect(merged).toHaveLength(1);
		expect(merged[0]!.meshes).toHaveLength(200_001);
	});
});
