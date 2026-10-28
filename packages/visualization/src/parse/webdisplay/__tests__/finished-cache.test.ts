import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMeshBatch } from '@tests/helpers/mesh-batch-builder';
import { wrapInSlvm } from './fixtures.js';
import { parseMeshBatchBlob } from '../batch-parser.js';
import { clearGeometryCache } from '../batch/finished-cache.js';
import { disposeObjectTree, setHiddenMembers } from '../../../shared/index.js';

// Over ASSEMBLY_WORKER_MIN_TRIANGLES, so the batch takes the cached assembly path.
const heavy = (seed = 1) =>
	buildMeshBatch({ materialCount: 1, meshCount: 10, vertsPerMesh: 5_100, layerCount: 1, seed });

const positionsOf = (meshes: THREE.Mesh[]) => meshes[0]!.geometry.getAttribute('position').array;

describe('finished-geometry cache', () => {
	beforeEach(() => clearGeometryCache());

	it('serves an unchanged payload from the cache, with identical geometry', async () => {
		const container = wrapInSlvm(heavy());

		const first = await parseMeshBatchBlob(container);
		const second = await parseMeshBatchBlob(container.slice());

		// The same geometry object, so its GPU buffers are already uploaded.
		expect(second[0]!.geometry).toBe(first[0]!.geometry);
		expect(second[0]).not.toBe(first[0]);
	});

	it('keeps a cached geometry through scene teardown, and frees it on eviction', async () => {
		const meshes = await parseMeshBatchBlob(wrapInSlvm(heavy()));
		const geometry = meshes[0]!.geometry;
		const disposed = vi.fn();
		geometry.addEventListener('dispose', disposed);

		// What scene teardown (`clearScene`) runs on every top-level object.
		meshes.forEach((mesh) => disposeObjectTree(mesh));
		expect(disposed).not.toHaveBeenCalled();

		clearGeometryCache();
		expect(disposed).toHaveBeenCalledOnce();
	});

	it('gives a mesh its own geometry before hiding a member, leaving the shared one untouched', async () => {
		const container = wrapInSlvm(heavy());
		const [first] = await parseMeshBatchBlob(container);
		const [second] = await parseMeshBatchBlob(container.slice());
		const shared = first!.geometry;

		setHiddenMembers(second!, new Set([0]));

		expect(second!.geometry).not.toBe(shared);
		expect(second!.geometry.getAttribute('position')).toBe(shared.getAttribute('position'));
		expect(second!.geometry.groups.length).toBeGreaterThan(0);
		expect(shared.groups).toHaveLength(0);
		expect(first!.geometry).toBe(shared);
	});

	it('reuses the geometry when only the materials changed, and applies the new ones', async () => {
		const built = heavy();
		const red = built.batch.materials.map((m) => ({ ...m, color: '#ff0000' }));

		const first = await parseMeshBatchBlob(wrapInSlvm(built));
		const recoloured = await parseMeshBatchBlob(wrapInSlvm(built, red));

		expect(positionsOf(recoloured)).toBe(positionsOf(first));
		const material = recoloured[0]!.material as THREE.MeshStandardMaterial;
		expect(material.color.getHexString()).toBe('ff0000');
	});

	it('decodes again when the geometry bytes differ', async () => {
		const first = await parseMeshBatchBlob(wrapInSlvm(heavy(1)));
		const other = await parseMeshBatchBlob(wrapInSlvm(heavy(2)));

		expect(positionsOf(other)).not.toBe(positionsOf(first));
	});

	it('decodes again when the same bytes are cut into different jobs', async () => {
		const container = wrapInSlvm(heavy());

		const merged = await parseMeshBatchBlob(container);
		const unmerged = await parseMeshBatchBlob(container, { mergeByMaterial: false });

		expect(merged).toHaveLength(1);
		expect(unmerged).toHaveLength(10);
	});
});
