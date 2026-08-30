import { describe, expect, it } from 'vitest';

import { buildMeshBatch } from '@tests/helpers/mesh-batch-builder';

import { parseMeshBatchObject } from '../batch-parser';
import { parseBinaryMeshBatchRaw } from '../binary-parser';
import { splitGroupByLayer } from '../batch/merge';
import { assembleGeometries, meshAssemblyWorkerSource } from '../mesh-assembly';

import type { AssemblyInput, AssemblyJob } from '../mesh-assembly';
import type { DisplayBatch } from '../types';

/** Raw parse → AssemblyInput + jobs, mirroring tryBuildViaWorker's construction. */
function assemblyInputFor(batch: DisplayBatch, mergeByMaterial: boolean): AssemblyInput {
	const raw = parseBinaryMeshBatchRaw(batch.compressedData!);
	const groups = raw.metadata.groups ?? batch.groups ?? [];
	const jobs: AssemblyJob[] = [];
	for (const group of mergeByMaterial ? groups.flatMap(splitGroupByLayer) : groups) {
		if (mergeByMaterial && group.meshes.length > 1) {
			jobs.push({ kind: 'merged', windows: group.meshes.map((m) => ({ ...m })) });
		} else {
			for (const meshMeta of group.meshes) {
				jobs.push({ kind: 'single', windows: [{ ...meshMeta }] });
			}
		}
	}
	return {
		vertexData: raw.vertexData,
		isFloat32: raw.isFloat32,
		deltaEncoded: raw.deltaEncoded,
		planarByteSplit: raw.planarByteSplit,
		uint16Indices: raw.uint16Indices,
		origin: raw.origin,
		scale: raw.scale,
		indexData: raw.indexData,
		uvs: raw.uvs,
		colors: raw.colors,
		jobs
	};
}

describe('assembleGeometries equivalence with the synchronous parse path', () => {
	it.each([true, false])('matches buffers (mergeByMaterial=%s)', async (merge) => {
		const built = buildMeshBatch({ materialCount: 3, meshCount: 9, vertsPerMesh: 50, seed: 21 });

		const syncMeshes = await parseMeshBatchObject(built.batch, { mergeByMaterial: merge });

		const assembled = assembleGeometries(assemblyInputFor(built.batch, merge));
		expect(assembled).toHaveLength(syncMeshes.length);

		for (let i = 0; i < assembled.length; i++) {
			const result = assembled[i]!;
			const syncGeometry = syncMeshes[i]!.geometry;

			expect(Array.from(result.positions)).toEqual(
				Array.from(syncGeometry.getAttribute('position').array as Float32Array)
			);
			expect(Array.from(result.indices)).toEqual(Array.from(syncGeometry.index!.array));

			const syncNormals = syncGeometry.getAttribute('normal').array as Float32Array;
			expect(result.normals.length).toBe(syncNormals.length);
			for (let n = 0; n < syncNormals.length; n++) {
				expect(result.normals[n]).toBeCloseTo(syncNormals[n]!, 5);
			}
		}
	});

	it('handles float32 (non-quantized) blobs', async () => {
		const built = buildMeshBatch({
			materialCount: 1,
			meshCount: 3,
			vertsPerMesh: 40,
			seed: 22,
			forceFloat32: true
		});
		const syncMeshes = await parseMeshBatchObject(built.batch, { mergeByMaterial: true });
		const assembled = assembleGeometries(assemblyInputFor(built.batch, true));

		expect(assembled).toHaveLength(syncMeshes.length);
		expect(Array.from(assembled[0]!.positions)).toEqual(
			Array.from(syncMeshes[0]!.geometry.getAttribute('position').array as Float32Array)
		);
	});

	it('rejects indices outside their vertex window', () => {
		const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 20, seed: 23 });
		const input = assemblyInputFor(built.batch, false);
		// Shrink the first job's vertex window so its indices point outside it.
		input.jobs[0]!.windows[0]!.vertexCount = 2;
		expect(() => assembleGeometries(input)).toThrow(/outside vertex window/);
	});
});

describe('meshAssemblyWorkerSource', () => {
	it('stringifies to standalone code and round-trips a batch', () => {
		const source = meshAssemblyWorkerSource();
		const messages: unknown[] = [];
		const self = {
			onmessage: null as ((event: { data: unknown }) => void) | null,
			postMessage: (message: unknown) => {
				messages.push(message);
			}
		};
		new Function('self', source)(self);
		expect(self.onmessage).toBeTypeOf('function');

		const built = buildMeshBatch({ materialCount: 2, meshCount: 4, vertsPerMesh: 30, seed: 24 });
		const input = assemblyInputFor(built.batch, true);
		self.onmessage!({ data: { id: 3, input } });

		expect(messages).toHaveLength(1);
		const reply = messages[0] as { id: number; geometries?: unknown[]; error?: string };
		expect(reply.id).toBe(3);
		expect(reply.error).toBeUndefined();
		expect(reply.geometries!.length).toBeGreaterThan(0);
	});

	it('reports errors instead of throwing', () => {
		const source = meshAssemblyWorkerSource();
		const messages: unknown[] = [];
		const self = {
			onmessage: null as ((event: { data: unknown }) => void) | null,
			postMessage: (message: unknown) => {
				messages.push(message);
			}
		};
		new Function('self', source)(self);

		self.onmessage!({ data: { id: 9, input: { jobs: null } } });
		const reply = messages[0] as { id: number; error?: string };
		expect(reply.id).toBe(9);
		expect(reply.error).toBeTypeOf('string');
	});
});
