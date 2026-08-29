import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBinaryMeshBatch } from '../binary-parser';

import type { ParsedBinaryMeshBatch } from '../binary-parser';
import type { MaterialGroup, SerializableMaterial } from '../types';

/**
 * Cross-stack SLVM v3 contract: decodes golden containers written by the C# production path
 * (regenerated via `UPDATE_SLVM_FIXTURES=1 dotnet test --filter SlvmFixtureContractTests`) and
 * checks the reconstructed metadata against the writer's own batch from the sibling
 * .expected.json. The bytes here were never touched by a TS encoder — this is the only test that
 * catches the C# container writer and this decoder disagreeing about TABL/MATL/TEXR.
 */

const FIXTURES_DIR = fileURLToPath(
	new URL('../../../../../schemas/fixtures/slvm3/', import.meta.url)
);

interface ExpectedFixture {
	materials: SerializableMaterial[];
	groups: MaterialGroup[];
	totalVertexCount: number;
	totalIndexCount: number;
	positionTolerance: number;
}

function loadFixture(blobName: string): {
	parsed: ParsedBinaryMeshBatch;
	expected: ExpectedFixture;
} {
	const parsed = parseBinaryMeshBatch(readFileSync(FIXTURES_DIR + blobName));
	const expected = JSON.parse(
		readFileSync(FIXTURES_DIR + blobName.replace(/\.slvm$/, '.expected.json'), 'utf-8')
	) as ExpectedFixture;
	// C#'s JSON serializes an absent metadata dict as null; the decoder normalizes to {}.
	for (const group of expected.groups) {
		for (const mesh of group.meshes) {
			mesh.metadata ??= {};
		}
	}

	return { parsed, expected };
}

describe('SLVM v3 fixtures (written by C#)', () => {
	it('plain-sequential: zero-cost columns reconstruct names, windows and the implicit group', () => {
		const { parsed, expected } = loadFixture('plain-sequential.slvm');

		expect(parsed.metadata.groups).toEqual(expected.groups);
		expect(parsed.vertices.length / 3).toBe(expected.totalVertexCount);
		expect(parsed.indices.length).toBe(expected.totalIndexCount);
	});

	it('multi-material: ids survive the material sort, attrs land sparsely', () => {
		const { parsed, expected } = loadFixture('multi-material.slvm');

		expect(parsed.metadata.groups).toEqual(expected.groups);
		expect(parsed.metadata.materials).toEqual(expected.materials);

		const meshes = parsed.metadata.groups.flatMap((g) => g.meshes);
		// Input order was wall(red), window(blue), wall2(red); the sort groups the two reds first.
		expect(meshes.map((m) => m.name)).toEqual(['wall', 'wall2', 'window']);
		expect(meshes.map((m) => m.id)).toEqual([
			'fixture-multi/{0;0}/0',
			'fixture-multi/{0;1}/0',
			'fixture-multi/{0;0}/1'
		]);
		expect(meshes[0]!.metadata).toEqual({ fire: 'REI60' });
		expect(meshes[1]!.metadata).toEqual({});
		expect(meshes[2]!.metadata).toEqual({});
	});

	it('textured: the TEXR chunk reconstructs the data URI on the material', () => {
		const { parsed, expected } = loadFixture('textured.slvm');

		expect(parsed.metadata.materials).toEqual(expected.materials);
		expect(parsed.metadata.materials[0]!.map).toMatch(/^data:image\/png;base64,/);
		expect(parsed.uvs).not.toBeNull();
		expect(parsed.uvs!.length).toBe(expected.totalVertexCount * 2);
	});

	it('geometry decodes through the nested blob with correct world positions', () => {
		const { parsed, expected } = loadFixture('multi-material.slvm');

		// Every fixture quad spans x ∈ [dx, dx+1]; the second table mesh is wall2 at dx = 4.
		const meshes = parsed.metadata.groups.flatMap((g) => g.meshes);
		const wall2 = meshes.find((m) => m.name === 'wall2')!;
		const v0 = wall2.vertexStart * 3;
		const x =
			parsed.vertices instanceof Float32Array
				? parsed.vertices[v0]!
				: parsed.origin[0]! + (parsed.vertices[v0]! + 32767) * parsed.scale[0]!;
		expect(Math.abs(x - 4)).toBeLessThanOrEqual(expected.positionTolerance);
	});
});
