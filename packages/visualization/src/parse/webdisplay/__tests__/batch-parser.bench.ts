import * as THREE from 'three';
import { deflateSync, inflateSync } from 'fflate';
import { bench, describe } from 'vitest';

import { buildMeshBatch } from '@tests/helpers/mesh-batch-builder';

import { parseMeshBatch, parseMeshBatchObject } from '../batch-parser';
import { parseBinaryMeshBatch } from '../binary-parser';

// Realistic-ish workload: ~500 meshes, ~10 materials, ~400 verts/mesh = 200k verts.
// Build once, reuse across iterations — vitest bench calls the fn many times.
const realistic = buildMeshBatch({
	materialCount: 10,
	meshCount: 500,
	vertsPerMesh: 400,
	seed: 1
});
const realisticJson = JSON.stringify(realistic.batch);

// Smaller workload to surface fixed-cost overhead.
const small = buildMeshBatch({
	materialCount: 4,
	meshCount: 50,
	vertsPerMesh: 60,
	seed: 2
});

// Heavy workload to amplify the JSON.parse + decode costs.
const heavy = buildMeshBatch({
	materialCount: 12,
	meshCount: 1000,
	vertsPerMesh: 800,
	seed: 3
});
const heavyJson = JSON.stringify(heavy.batch);

// Slow benches get fixed iteration counts instead of a time budget (mirrors edges.bench.ts).
const FEW = { time: 0, warmupTime: 0, warmupIterations: 1, iterations: 3 } as const;

// Multi-million-triangle workload — the display-pipeline audit case: 500 meshes × 2002 verts
// ≈ 1M verts / 1M triangles, matching the edge-bench scale so stage costs line up.
const xheavy = buildMeshBatch({
	materialCount: 8,
	meshCount: 500,
	vertsPerMesh: 2002,
	seed: 4
});

describe('parseBinaryMeshBatch (decode only)', () => {
	bench('realistic (~200k verts)', () => {
		parseBinaryMeshBatch(realistic.batch.compressedData);
	});

	bench('heavy (~800k verts)', () => {
		parseBinaryMeshBatch(heavy.batch.compressedData);
	});

	bench(
		'xheavy (~1M verts / 1M tri)',
		() => {
			parseBinaryMeshBatch(xheavy.batch.compressedData);
		},
		FEW
	);
});

describe('full parse path at 1M tri (audit: where the per-solve time goes)', () => {
	bench(
		'parseMeshBatchObject, merged',
		async () => {
			await parseMeshBatchObject(xheavy.batch, { mergeByMaterial: true });
		},
		FEW
	);

	bench(
		'parseMeshBatchObject, individual meshes',
		async () => {
			await parseMeshBatchObject(xheavy.batch, { mergeByMaterial: false });
		},
		FEW
	);

	// computeVertexNormals isolated — it runs per built geometry inside the parse above.
	const parsed = parseBinaryMeshBatch(xheavy.batch.compressedData);
	const positions = new Float32Array(parsed.vertices.length);
	for (let i = 0; i < positions.length; i++) positions[i] = Number(parsed.vertices[i]);
	const indices = parsed.indices.slice();
	bench(
		'computeVertexNormals alone (1M tri, one geometry)',
		() => {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			geometry.setIndex(new THREE.BufferAttribute(indices, 1));
			geometry.computeVertexNormals();
			geometry.dispose();
		},
		FEW
	);

	// The SLVZ inflate the C# side applies to real payloads (the builder emits raw SLVA, so the
	// decode benches above never pay it). Deflate once here; bench the inflate the client runs.
	const rawBase64 = xheavy.batch.compressedData;
	const rawBytes = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
	const deflated = deflateSync(rawBytes, { level: 6 });
	// eslint-disable-next-line no-console
	console.log(
		`[batch-parser.bench] xheavy blob: raw ${(rawBytes.length / 1e6).toFixed(1)} MB, deflated ${(deflated.length / 1e6).toFixed(1)} MB`
	);
	bench(
		'inflateSync of the 1M-tri blob (SLVZ path, main thread)',
		() => {
			inflateSync(deflated, { out: new Uint8Array(rawBytes.length + 1) });
		},
		FEW
	);
});

describe('parseMeshBatchObject (decode + dequantize + assemble)', () => {
	bench('small, merged', async () => {
		await parseMeshBatchObject(small.batch, {
			mergeByMaterial: true
		});
	});

	bench('realistic, merged', async () => {
		await parseMeshBatchObject(realistic.batch, {
			mergeByMaterial: true
		});
	});

	bench('realistic, individual', async () => {
		await parseMeshBatchObject(realistic.batch, {
			mergeByMaterial: false
		});
	});

	bench('realistic, no transform', async () => {
		await parseMeshBatchObject(realistic.batch, {
			mergeByMaterial: true
		});
	});

	bench('heavy, merged', async () => {
		await parseMeshBatchObject(heavy.batch, {
			mergeByMaterial: true
		});
	});
});

describe('parseMeshBatch (JSON.parse + decode + assemble)', () => {
	bench('realistic JSON', async () => {
		await parseMeshBatch(realisticJson, {
			mergeByMaterial: true
		});
	});

	bench('heavy JSON', async () => {
		await parseMeshBatch(heavyJson, {
			mergeByMaterial: true
		});
	});
});
