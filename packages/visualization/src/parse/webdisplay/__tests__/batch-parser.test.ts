import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { buildMeshBatch, encodeBatchPayload } from '@tests/helpers/mesh-batch-builder';
import type { MeshBatchBuilderOptions } from '@tests/helpers/mesh-batch-builder';
import { decodeBase64ToBinary } from '../../../shared/index.js';

import { parseMeshBatch, parseMeshBatchObject, parseMeshBatchBlob } from '../batch-parser';

const COORD_TRANSFORM_TOLERANCE = 1e-5;

describe('parseMeshBatchObject', () => {
	describe('merged path (mergeByMaterial=true)', () => {
		it('produces one mesh per material group', async () => {
			const { batch } = buildMeshBatch({
				materialCount: 3,
				meshCount: 12,
				vertsPerMesh: 6,
				layerCount: 1
			});

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			expect(meshes).toHaveLength(3);
		});

		it('preserves total vertex and triangle counts', async () => {
			const { batch, rawVertices, rawFaces } = buildMeshBatch({
				materialCount: 2,
				meshCount: 8,
				vertsPerMesh: 5
			});

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			let totalPositions = 0;
			let totalIndices = 0;
			for (const mesh of meshes) {
				const geom = mesh.geometry as THREE.BufferGeometry;
				totalPositions += geom.getAttribute('position').count;
				const index = geom.getIndex();
				expect(index).not.toBeNull();
				totalIndices += index!.count;
			}

			expect(totalPositions * 3).toBe(rawVertices.length);
			expect(totalIndices).toBe(rawFaces.length);
		});

		it('rebases indices so all triangles reference vertices that exist in the merged buffer', async () => {
			const { batch } = buildMeshBatch({ materialCount: 2, meshCount: 6, vertsPerMesh: 4 });

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			for (const mesh of meshes) {
				const geom = mesh.geometry as THREE.BufferGeometry;
				const positionCount = geom.getAttribute('position').count;
				const index = geom.getIndex()!;
				for (let i = 0; i < index.count; i++) {
					const idx = index.getX(i);
					expect(idx).toBeGreaterThanOrEqual(0);
					expect(idx).toBeLessThan(positionCount);
				}
			}
		});

		it('populates userData with first-mesh metadata and mergedFrom for siblings', async () => {
			const { batch } = buildMeshBatch({
				materialCount: 1,
				meshCount: 4,
				vertsPerMesh: 3,
				layerCount: 1
			});

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			expect(meshes).toHaveLength(1);
			const mesh = meshes[0]!;
			expect(mesh.userData.name).toBe('mesh_0');
			expect(mesh.userData.layer).toBe('Layer/0');
			expect(mesh.userData.originalIndex).toBe(0);
			expect(mesh.userData.mergedFrom).toHaveLength(3);
			expect(mesh.userData.mergedFrom[0].name).toBe('mesh_1');
		});

		it('never merges across layers, so hiding one layer cannot hide another', async () => {
			// One material, four meshes, two layers. Merging by material alone would produce a single
			// object filed under the first layer, and the outliner would hide both layers at once.
			const { batch } = buildMeshBatch({
				materialCount: 1,
				meshCount: 4,
				vertsPerMesh: 3,
				layerCount: 2
			});

			const meshes = await parseMeshBatchObject(batch, { mergeByMaterial: true });

			expect(meshes).toHaveLength(2);
			expect(meshes.map((m) => m.userData.layer).sort()).toEqual(['Layer/0', 'Layer/1']);
			for (const mesh of meshes) {
				const layers = [
					mesh.userData.layer,
					...(mesh.userData.mergedFrom ?? []).map((m: { layer: string }) => m.layer)
				];
				expect(new Set(layers).size).toBe(1);
			}
		});

		it('falls through to individual path when a group has only one mesh', async () => {
			const { batch } = buildMeshBatch({ materialCount: 4, meshCount: 4, vertsPerMesh: 3 });

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			// Single-mesh groups go through createIndividualMeshes; userData has no mergedFrom.
			expect(meshes).toHaveLength(4);
			for (const mesh of meshes) {
				expect(mesh.userData.mergedFrom).toBeUndefined();
			}
		});
	});

	describe('individual path (mergeByMaterial=false)', () => {
		it('produces one mesh per source mesh', async () => {
			const { batch } = buildMeshBatch({ materialCount: 2, meshCount: 7, vertsPerMesh: 4 });

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: false
			});

			expect(meshes).toHaveLength(7);
		});

		it('rebases indices to be local (0..vertexCount) for each mesh', async () => {
			const { batch } = buildMeshBatch({ materialCount: 2, meshCount: 5, vertsPerMesh: 6 });

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: false
			});

			for (const mesh of meshes) {
				const geom = mesh.geometry as THREE.BufferGeometry;
				const positionCount = geom.getAttribute('position').count;
				const index = geom.getIndex()!;
				for (let i = 0; i < index.count; i++) {
					const idx = index.getX(i);
					expect(idx).toBeGreaterThanOrEqual(0);
					expect(idx).toBeLessThan(positionCount);
				}
			}
		});

		it('carries mesh metadata into userData', async () => {
			const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 3, vertsPerMesh: 3 });

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: false
			});

			const names = meshes.map((m) => m.userData.name).sort();
			expect(names).toEqual(['mesh_0', 'mesh_1', 'mesh_2']);
		});
	});

	describe('coordinate transform', () => {
		it('keeps vertices in the Rhino Z-up frame (no rotation)', async () => {
			// Selva keeps one coordinate frame end to end: the Three scene IS Rhino's Z-up frame, so
			// vertices pass through unrotated.
			// Use forceFloat32 so we can compare exact float values without int16 quantization
			// noise (the quantized path is covered by binary-parser.test.ts).
			const { batch, rawVertices } = buildMeshBatch({
				materialCount: 1,
				meshCount: 1,
				vertsPerMesh: 3,
				seed: 42,
				forceFloat32: true
			});

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			const position = meshes[0]!.geometry.getAttribute('position');

			for (let v = 0; v < position.count; v++) {
				const ox = rawVertices[v * 3]!;
				const oy = rawVertices[v * 3 + 1]!;
				const oz = rawVertices[v * 3 + 2]!;

				expect(position.getX(v)).toBeCloseTo(ox, 5);
				expect(position.getY(v)).toBeCloseTo(oy, 5);
				expect(position.getZ(v)).toBeCloseTo(oz, 5);
			}
		});

		it('does not mutate the caller-supplied vertices', async () => {
			const { batch, rawVertices } = buildMeshBatch({
				materialCount: 1,
				meshCount: 1,
				vertsPerMesh: 3,
				seed: 7,
				forceFloat32: true
			});

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			const position = meshes[0]!.geometry.getAttribute('position');
			for (let v = 0; v < position.count; v++) {
				expect(position.getX(v)).toBeCloseTo(rawVertices[v * 3]!, 5);
				expect(position.getY(v)).toBeCloseTo(rawVertices[v * 3 + 1]!, 5);
				expect(position.getZ(v)).toBeCloseTo(rawVertices[v * 3 + 2]!, 5);
			}
		});
	});

	describe('material assignment', () => {
		it('assigns the correct material to each group', async () => {
			const { batch } = buildMeshBatch({ materialCount: 3, meshCount: 9, vertsPerMesh: 4 });

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			// Each merged mesh should use a distinct material instance — the parser
			// creates one material per entry in batch.materials.
			const materialIds = new Set(meshes.map((m) => (m.material as THREE.Material).uuid));
			expect(materialIds.size).toBe(3);
		});

		it('reflects material color from input', async () => {
			// Materials live inside the binary blob's metadata header. Mutate the materials and
			// re-encode so the parser sees the change — mirrors what the C# writer does end-to-end.
			const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
			built.batch.materials[0]!.color = '#ff0000';
			built.batch.compressedData = encodeBatchPayload(built.rawVertices, built.rawFaces, {
				materials: built.batch.materials,
				groups: built.batch.groups,
				sourceComponentId: built.batch.sourceComponentId
			});

			const meshes = await parseMeshBatchObject(built.batch, {
				mergeByMaterial: true
			});

			const mat = meshes[0]!.material as THREE.MeshPhysicalMaterial;
			expect(mat.color.r).toBeCloseTo(1, COORD_TRANSFORM_TOLERANCE);
			expect(mat.color.g).toBeCloseTo(0, COORD_TRANSFORM_TOLERANCE);
			expect(mat.color.b).toBeCloseTo(0, COORD_TRANSFORM_TOLERANCE);
		});

		it('gives metallic materials a satin clearcoat but leaves matte ones bare', async () => {
			// A near-pure metal has no diffuse response, so under low IBL it needs a clearcoat to read as
			// coated metal rather than flat card; matte/plastic materials must stay bare (no false sheen).
			const built = buildMeshBatch({ materialCount: 2, meshCount: 2, vertsPerMesh: 3 });
			built.batch.materials[0]!.metalness = 0.98; // metal → clearcoat
			built.batch.materials[1]!.metalness = 0.1; // matte → no clearcoat
			built.batch.compressedData = encodeBatchPayload(built.rawVertices, built.rawFaces, {
				materials: built.batch.materials,
				groups: built.batch.groups,
				sourceComponentId: built.batch.sourceComponentId
			});

			const meshes = await parseMeshBatchObject(built.batch, {
				mergeByMaterial: true
			});
			const byMetalness = (m: number) =>
				meshes
					.map((mesh) => mesh.material as THREE.MeshPhysicalMaterial)
					.find((mat) => Math.abs(mat.metalness - m) < 1e-3)!;

			const metal = byMetalness(0.98);
			expect(metal.clearcoat).toBeGreaterThan(0);
			expect(metal.clearcoatRoughness).toBeGreaterThan(0);

			expect(byMetalness(0.1).clearcoat).toBe(0); // three's default — untouched
		});
	});

	describe('uv and vertex-color attributes', () => {
		/** Re-encodes a built batch with deterministic per-vertex uv/color ramps for slice checks. */
		function withChannels(
			options: MeshBatchBuilderOptions & { uvs?: boolean; colors?: boolean; map?: string }
		) {
			const built = buildMeshBatch(options);
			const vertexCount = built.rawVertices.length / 3;

			// uv = (globalVertexIndex, globalVertexIndex + 0.5) scaled into [0,1] so every slice is
			// distinguishable; color = (i % 256, 255 - (i % 256), 128).
			const uvs = options.uvs
				? new Float32Array(Array.from({ length: vertexCount * 2 }, (_, i) => i / (vertexCount * 2)))
				: null;
			const colors = options.colors
				? new Uint8Array(Array.from({ length: vertexCount * 3 }, (_, i) => (i * 7) % 256))
				: null;

			if (options.map) {
				built.batch.materials[0]!.map = options.map;
			}

			built.batch.compressedData = encodeBatchPayload(built.rawVertices, built.rawFaces, {
				materials: built.batch.materials,
				groups: built.batch.groups,
				sourceComponentId: built.batch.sourceComponentId,
				uvs,
				colors
			});

			return { built, uvs, colors };
		}

		it('sets a per-mesh uv attribute sliced by vertexStart on the individual path', async () => {
			const { built, uvs } = withChannels({
				materialCount: 1,
				meshCount: 3,
				vertsPerMesh: 4,
				uvs: true
			});

			const meshes = await parseMeshBatchObject(built.batch, {
				mergeByMaterial: false
			});

			expect(meshes).toHaveLength(3);
			for (const mesh of meshes) {
				const geom = mesh.geometry as THREE.BufferGeometry;
				const uv = geom.getAttribute('uv');
				expect(uv).toBeDefined();
				expect(uv.itemSize).toBe(2);
				expect(uv.count).toBe(geom.getAttribute('position').count);

				// Each mesh's slice must match its global vertex range.
				const vertexStart = built.batch.groups
					.flatMap((g) => g.meshes)
					.find((m) => m.name === mesh.userData.name)!.vertexStart;
				for (let v = 0; v < uv.count; v++) {
					expect(uv.getX(v)).toBeCloseTo(uvs![(vertexStart + v) * 2]!, 4);
					expect(uv.getY(v)).toBeCloseTo(uvs![(vertexStart + v) * 2 + 1]!, 4);
				}
			}
		});

		it('sets uv and normalized color attributes on the merged path', async () => {
			const { built, colors } = withChannels({
				materialCount: 1,
				meshCount: 2,
				vertsPerMesh: 3,
				layerCount: 1,
				uvs: true,
				colors: true
			});

			const meshes = await parseMeshBatchObject(built.batch, {
				mergeByMaterial: true
			});

			expect(meshes).toHaveLength(1);
			const geom = meshes[0]!.geometry as THREE.BufferGeometry;

			const uv = geom.getAttribute('uv');
			expect(uv).toBeDefined();
			expect(uv.count).toBe(geom.getAttribute('position').count);

			const color = geom.getAttribute('color');
			expect(color).toBeDefined();
			expect(color.itemSize).toBe(3);
			expect(color.normalized).toBe(true);
			// Meshes merge in group order here, so the combined color buffer is the original.
			const colorArray = color.array as Uint8Array;
			expect(Array.from(colorArray)).toEqual(Array.from(colors!));
		});

		it('enables vertexColors on materials only when the blob carries colors', async () => {
			const withColors = withChannels({
				materialCount: 1,
				meshCount: 2,
				vertsPerMesh: 3,
				colors: true
			});
			const withoutColors = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });

			const colored = await parseMeshBatchObject(withColors.built.batch, {});
			const plain = await parseMeshBatchObject(withoutColors.batch);

			expect((colored[0]!.material as THREE.MeshPhysicalMaterial).vertexColors).toBe(true);
			expect((plain[0]!.material as THREE.MeshPhysicalMaterial).vertexColors).toBe(false);
		});

		it('leaves geometry attribute-free when the blob has no channels', async () => {
			const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });

			const meshes = await parseMeshBatchObject(batch);

			const geom = meshes[0]!.geometry as THREE.BufferGeometry;
			expect(geom.getAttribute('uv')).toBeUndefined();
			expect(geom.getAttribute('color')).toBeUndefined();
		});

		it('tolerates a material map reference without a DOM (texture load skipped)', async () => {
			const { built } = withChannels({
				materialCount: 1,
				meshCount: 2,
				vertsPerMesh: 3,
				uvs: true,
				map: 'http://localhost:9999/assets/abc123'
			});

			const meshes = await parseMeshBatchObject(built.batch);

			// Node has no document, so applyTextureMap skips silently; the batch still parses.
			expect(meshes.length).toBeGreaterThan(0);
			expect((meshes[0]!.material as THREE.MeshPhysicalMaterial).map).toBeNull();
		});
	});

	describe('options', () => {
		it("leaves scale at identity — unit scaling is the orchestrator's job", async () => {
			const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			expect(meshes[0]!.scale.x).toBe(1);
		});

		it('propagates sourceComponentId to userData', async () => {
			const { batch } = buildMeshBatch({
				materialCount: 1,
				meshCount: 2,
				vertsPerMesh: 3,
				sourceComponentId: 'gh-component-xyz'
			});

			const meshes = await parseMeshBatchObject(batch, {
				mergeByMaterial: true
			});

			expect(meshes[0]!.userData.sourceComponentId).toBe('gh-component-xyz');
		});

		// Stable identity type-checks the field to decide whether it can key on the component; a
		// null passes `in` but fails that check, demoting every mesh to the weaker name+layer key.
		it('omits sourceComponentId when the batch has none', async () => {
			const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });

			const meshes = await parseMeshBatchObject(batch, { mergeByMaterial: true });

			expect(meshes[0]!.userData.sourceComponentId).toBeUndefined();
		});

		it('gives merged meshes a member list distinct from their first index', async () => {
			const { batch } = buildMeshBatch({
				materialCount: 1,
				meshCount: 3,
				vertsPerMesh: 3,
				layerCount: 1,
				sourceComponentId: 'gh-component-xyz'
			});

			const meshes = await parseMeshBatchObject(batch, { mergeByMaterial: true });

			expect(meshes[0]!.userData.mergedIndices).toEqual([0, 1, 2]);
		});
	});
});

describe('parseMeshBatch (JSON entry point)', () => {
	it('parses a JSON-stringified DisplayBatch end-to-end', async () => {
		const { batch } = buildMeshBatch({
			materialCount: 2,
			meshCount: 6,
			vertsPerMesh: 4,
			layerCount: 1
		});

		const meshes = await parseMeshBatch(JSON.stringify(batch), {
			mergeByMaterial: true
		});

		expect(meshes).toHaveLength(2);
	});

	it('returns empty array on invalid JSON instead of throwing', async () => {
		const meshes = await parseMeshBatch('not-json');
		expect(meshes).toEqual([]);
	});

	it('rethrows blob parse errors instead of degrading to an empty scene (issue 35)', async () => {
		// Valid envelope JSON, corrupt blob: only the invalid-envelope case may return [].
		const envelope = JSON.stringify({ materials: [], groups: [], compressedData: 'AAAAAAAA' });

		await expect(parseMeshBatch(envelope)).rejects.toThrow(/SLVA/i);
	});
});

describe('error contract (issue 35)', () => {
	it('parseMeshBatchObject resolves [] for a batch with no compressedData (genuinely empty)', async () => {
		const batch = { materials: [], groups: [] } as unknown as Parameters<
			typeof parseMeshBatchObject
		>[0];

		await expect(parseMeshBatchObject(batch)).resolves.toEqual([]);
	});

	it('parseMeshBatchObject rejects on a corrupt blob', async () => {
		const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		batch.compressedData = 'AAAAAAAA'; // decodes, but is not a SLVA/SLVZ blob

		await expect(parseMeshBatchObject(batch)).rejects.toThrow(/SLVA/i);
	});

	it('parseMeshBatchBlob rejects on truncated blob bytes', async () => {
		const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		const blob = decodeBase64ToBinary(batch.compressedData);

		await expect(parseMeshBatchBlob(blob.subarray(0, 8))).rejects.toThrow();
	});
});

describe('group metadata validation (issue 19)', () => {
	/** Re-encodes the built batch so the blob's embedded metadata carries the tampered groups. */
	function reencode(built: ReturnType<typeof buildMeshBatch>): void {
		built.batch.compressedData = encodeBatchPayload(built.rawVertices, built.rawFaces, {
			materials: built.batch.materials,
			groups: built.batch.groups,
			sourceComponentId: built.batch.sourceComponentId
		});
	}

	it('rejects an out-of-range materialId instead of building a mesh with undefined material', async () => {
		const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		built.batch.groups[0]!.materialId = 5;
		reencode(built);

		await expect(parseMeshBatchObject(built.batch)).rejects.toThrow(/materialId/i);
	});

	it('rejects a vertex window that overruns the vertex buffer instead of clamping silently', async () => {
		const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		built.batch.groups[0]!.meshes[0]!.vertexStart = 1000;
		reencode(built);

		await expect(parseMeshBatchObject(built.batch)).rejects.toThrow(/vertex window/i);
	});

	it('rejects an index window that overruns the index buffer', async () => {
		const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		built.batch.groups[0]!.meshes[0]!.indexCount = 10_000;
		reencode(built);

		await expect(parseMeshBatchObject(built.batch)).rejects.toThrow(/index window/i);
	});

	it('rejects non-integer or negative metadata fields', async () => {
		const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		built.batch.groups[0]!.meshes[0]!.vertexCount = -1;
		reencode(built);

		await expect(parseMeshBatchObject(built.batch)).rejects.toThrow(/non-negative integer/i);
	});

	it('rejects indices outside their mesh vertex window on the merged path (no Uint32 wrap)', async () => {
		// Swap the two meshes' vertexStart values: each mesh's indices now sit outside its declared
		// window. Unchecked, `index - vertexStart` wraps into ~4 billion inside a Uint32Array.
		const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		const [meshA, meshB] = built.batch.groups[0]!.meshes;
		const tmp = meshA!.vertexStart;
		meshA!.vertexStart = meshB!.vertexStart;
		meshB!.vertexStart = tmp;
		reencode(built);

		await expect(parseMeshBatchObject(built.batch, { mergeByMaterial: true })).rejects.toThrow(
			/outside its mesh/i
		);
	});

	it('rejects indices outside their mesh vertex window on the individual path', async () => {
		const built = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		const [meshA, meshB] = built.batch.groups[0]!.meshes;
		const tmp = meshA!.vertexStart;
		meshA!.vertexStart = meshB!.vertexStart;
		meshB!.vertexStart = tmp;
		reencode(built);

		await expect(parseMeshBatchObject(built.batch, { mergeByMaterial: false })).rejects.toThrow(
			/outside its mesh/i
		);
	});
});

describe('parseMeshBatchBlob (binary entry point)', () => {
	// The blob entry point takes the raw SLVA bytes (a binary WebSocket frame) and
	// reads materials/groups/sourceComponentId from the blob's embedded metadata
	// rather than an outer JSON envelope.
	it('parses raw blob bytes end-to-end, honoring the shared parsing options', async () => {
		const { batch } = buildMeshBatch({
			materialCount: 2,
			meshCount: 6,
			vertsPerMesh: 4,
			layerCount: 1
		});
		const blob = decodeBase64ToBinary(batch.compressedData);

		const meshes = await parseMeshBatchBlob(blob, {
			mergeByMaterial: true
		});

		expect(meshes).toHaveLength(2);
	});

	it("leaves scale at identity — unit scaling is the orchestrator's job", async () => {
		const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		const blob = decodeBase64ToBinary(batch.compressedData);

		const meshes = await parseMeshBatchBlob(blob, {
			mergeByMaterial: true
		});

		for (const mesh of meshes) {
			expect(mesh.scale.x).toBe(1);
		}
	});
});
