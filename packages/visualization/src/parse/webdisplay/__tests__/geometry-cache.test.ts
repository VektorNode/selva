import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMeshBatch } from '@tests/helpers/mesh-batch-builder';

import { CACHED_GEOMETRY_USERDATA_FLAG } from '../../../shared/index.js';
import { parseMeshBatchObject } from '../batch-parser';
import { geometryCacheClear, geometryCacheGet, geometryCachePut } from '../geometry-cache';

import type * as THREE from 'three';

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

	// NOTE: the companion test — that `clearScene` skips disposing cache-owned geometries — lives in
	// `render/__tests__/three-helpers.test.ts`, because `clearScene` is a render-layer function and
	// `parse/` must not import upward from `render/`. This file keeps the cache side of that
	// contract: the flag is set, and `geometryCacheClear` disposes + clears it.

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

// Eviction is budgeted in bytes (256 MB), so these use stubs that *report* large attribute sizes
// without allocating them — bytesOf only reads `attribute.array.byteLength`.
function stubGeometry(bytes: number): { geometry: THREE.BufferGeometry; disposed: () => boolean } {
	let disposed = false;
	const geometry = {
		userData: {} as Record<string, unknown>,
		index: null,
		attributes: { position: { array: { byteLength: bytes } } },
		dispose: () => {
			disposed = true;
		}
	};
	return { geometry: geometry as unknown as THREE.BufferGeometry, disposed: () => disposed };
}

const MB = 1024 * 1024;

describe('byte-budget eviction (LRU)', () => {
	it('evicts the least-recently-used entry once over budget, disposing and untagging it', () => {
		const a = stubGeometry(100 * MB);
		const b = stubGeometry(100 * MB);
		const c = stubGeometry(100 * MB);

		geometryCachePut('a', a.geometry);
		geometryCachePut('b', b.geometry);
		geometryCacheGet('a'); // refresh a — b becomes the LRU entry
		geometryCachePut('c', c.geometry); // 300 MB > 256 MB → evict b

		expect(geometryCacheGet('b')).toBeUndefined();
		expect(b.disposed()).toBe(true);
		expect(b.geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG]).toBeUndefined();

		expect(geometryCacheGet('a')).toBe(a.geometry);
		expect(geometryCacheGet('c')).toBe(c.geometry);
		expect(a.disposed()).toBe(false);
		expect(c.disposed()).toBe(false);
	});

	it('rejects a single geometry larger than the whole budget without tagging it', () => {
		const giant = stubGeometry(300 * MB);

		geometryCachePut('giant', giant.geometry);

		expect(geometryCacheGet('giant')).toBeUndefined();
		expect(giant.geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG]).toBeUndefined();
		expect(giant.disposed()).toBe(false); // still the caller's to use and dispose
	});

	it('keeps the incumbent on a duplicate key and leaves the newcomer scene-owned', () => {
		const first = stubGeometry(1 * MB);
		const second = stubGeometry(1 * MB);

		geometryCachePut('dup', first.geometry);
		geometryCachePut('dup', second.geometry);

		expect(geometryCacheGet('dup')).toBe(first.geometry);
		// The newcomer must NOT carry the cache-owned flag: the cache never owns it, so a stray
		// flag would make every disposal path skip it forever (the leak this pins).
		expect(second.geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG]).toBeUndefined();
		expect(second.disposed()).toBe(false);
	});
});
