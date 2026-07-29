import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMeshBatch } from '@tests/helpers/mesh-batch-builder';

import { CACHED_GEOMETRY_USERDATA_FLAG } from '../../../shared/index.js';
import { parseMeshBatchObject } from '../batch-parser';
import { geometryCacheClear } from '../geometry-cache';

afterEach(() => {
	geometryCacheClear();
});

describe('cross-solve geometry cache (audit P1)', () => {
	it('re-parsing an identical batch reuses the same BufferGeometry objects', async () => {
		const batch = buildMeshBatch({ materialCount: 2, meshCount: 6, vertsPerMesh: 40, seed: 11 });

		const first = await parseMeshBatchObject(batch.batch, { mergeByMaterial: true });
		const second = await parseMeshBatchObject(batch.batch, { mergeByMaterial: true });

		expect(first.length).toBeGreaterThan(0);
		expect(second.length).toBe(first.length);
		for (let i = 0; i < first.length; i++) {
			expect(second[i]!.geometry).toBe(first[i]!.geometry);
		}
	});

	it('reuses per-mesh geometries on the individual (non-merged) path too', async () => {
		const batch = buildMeshBatch({ materialCount: 1, meshCount: 4, vertsPerMesh: 30, seed: 12 });

		const first = await parseMeshBatchObject(batch.batch, { mergeByMaterial: false });
		const second = await parseMeshBatchObject(batch.batch, { mergeByMaterial: false });

		expect(first.map((m) => m.geometry)).toEqual(second.map((m) => m.geometry));
	});

	it('different content builds different geometries', async () => {
		const a = buildMeshBatch({ materialCount: 1, meshCount: 3, vertsPerMesh: 30, seed: 13 });
		const b = buildMeshBatch({ materialCount: 1, meshCount: 3, vertsPerMesh: 30, seed: 14 });

		const first = await parseMeshBatchObject(a.batch, { mergeByMaterial: true });
		const second = await parseMeshBatchObject(b.batch, { mergeByMaterial: true });

		expect(first[0]!.geometry).not.toBe(second[0]!.geometry);
	});

	it('merged and individual parses of the same batch do not share cache entries', async () => {
		const batch = buildMeshBatch({ materialCount: 1, meshCount: 3, vertsPerMesh: 30, seed: 15 });

		const merged = await parseMeshBatchObject(batch.batch, { mergeByMaterial: true });
		const individual = await parseMeshBatchObject(batch.batch, { mergeByMaterial: false });

		expect(merged).toHaveLength(1);
		expect(individual).toHaveLength(3);
		for (const mesh of individual) {
			expect(mesh.geometry).not.toBe(merged[0]!.geometry);
		}
	});

	it('cached geometries carry normals (computeVertexNormals ran once at build)', async () => {
		const batch = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 30, seed: 16 });
		const [mesh] = await parseMeshBatchObject(batch.batch, { mergeByMaterial: true });
		expect(mesh!.geometry.getAttribute('normal')).toBeDefined();
	});

	// NOTE: the companion test — that `clearScene` skips disposing cache-owned geometries — now lives
	// in `@selvajs/compute` (`threejs/__tests__/three-helpers.test.ts`), because `clearScene` is a
	// render-layer function and `parse/` must not import upward from `render/`. This file keeps the
	// cache side of that contract: the flag is set, and `geometryCacheClear` disposes + clears it.

	it('geometryCacheClear disposes cached geometries and unlocks clearScene disposal', async () => {
		const batch = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 30, seed: 18 });
		const [mesh] = await parseMeshBatchObject(batch.batch, { mergeByMaterial: true });
		const geometry = mesh!.geometry;

		const dispose = vi.spyOn(geometry, 'dispose');
		geometryCacheClear();

		expect(dispose).toHaveBeenCalled();
		expect(geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG]).toBeUndefined();
	});
});
