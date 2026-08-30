import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseBinaryMeshBatch } from '../binary-parser';

import type { ParsedBinaryMeshBatch } from '../binary-parser';
import type { MaterialGroup, SerializableMaterial } from '../types';

/**
 * Cross-stack SLVM v2 contract: decodes golden containers written by the C# production path
 * (regenerated via `UPDATE_SLVM_FIXTURES=1 dotnet test --filter SlvmFixtureContractTests`) and
 * checks the reconstructed metadata against the writer's own batch from the sibling
 * .expected.json. The bytes here were never touched by a TS encoder — this is the only test that
 * catches the C# container writer and this decoder disagreeing about TABL/MATL/TEXR/EXTN.
 */

/** "EXTN" little-endian. */
const EXTN = 0x4e545845;

const FIXTURES_DIR = fileURLToPath(
	new URL('../../../../../schemas/fixtures/slvm2/', import.meta.url)
);

interface ExpectedFixture {
	sourceComponentId: string;
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

describe('SLVM v2 fixtures (written by C#)', () => {
	it('plain-sequential: zero-cost columns reconstruct names, windows and the implicit group', () => {
		const { parsed, expected } = loadFixture('plain-sequential.slvm');

		expect(parsed.metadata.sourceComponentId).toBe(expected.sourceComponentId);
		expect(parsed.metadata.groups).toEqual(expected.groups);
		expect(parsed.vertices.length / 3).toBe(expected.totalVertexCount);
		expect(parsed.indices.length).toBe(expected.totalIndexCount);
	});

	it('multi-material: originalIndex survives the material sort, attrs land sparsely', () => {
		const { parsed, expected } = loadFixture('multi-material.slvm');

		expect(parsed.metadata.groups).toEqual(expected.groups);
		expect(parsed.metadata.materials).toEqual(expected.materials);

		const meshes = parsed.metadata.groups.flatMap((g) => g.meshes);
		// Input order was wall(red), window(blue), wall2(red); the sort groups the two reds first.
		expect(meshes.map((m) => m.name)).toEqual(['wall', 'wall2', 'window']);
		expect(meshes.map((m) => m.originalIndex)).toEqual([0, 2, 1]);
		expect(meshes[0]!.metadata).toEqual({ 'gh:branch': '{0;0}', fire: 'REI60' });
		expect(meshes[1]!.metadata).toEqual({ 'gh:branch': '{0;1}' });
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

	it('still reads a container whose EXTN uses the pre-rename sourceComponentId key', () => {
		// v2 renamed the EXTN field to batchId. Containers written before that must keep their
		// identity, or every hidden/selected object in a viewer session is orphaned. Rebuild the
		// fixture's EXTN chunk with the old spelling, byte-for-byte otherwise.
		const bytes = new Uint8Array(readFileSync(FIXTURES_DIR + 'multi-material.slvm'));
		const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const chunkCount = dv.getUint32(8, true);
		const parts: Uint8Array[] = [bytes.subarray(0, 12)];
		let off = 12;
		for (let i = 0; i < chunkCount; i++) {
			const type = dv.getUint32(off, true);
			const len = dv.getUint32(off + 4, true);
			const padded = 8 + len + ((4 - (len % 4)) % 4);
			if (type === EXTN) {
				const payload = bytes.subarray(off + 8, off + 8 + len);
				const nsLen = payload[0]!;
				const ns = payload.subarray(1, 1 + nsLen);
				const ext = JSON.parse(new TextDecoder().decode(payload.subarray(1 + nsLen))) as {
					batchId?: string;
					curves?: Record<string, string>;
				};
				const legacyJson = new TextEncoder().encode(
					JSON.stringify({
						sourceComponentId: ext.batchId,
						...(ext.curves ? { curves: ext.curves } : {})
					})
				);
				const newPayload = new Uint8Array(1 + nsLen + legacyJson.length);
				newPayload[0] = nsLen;
				newPayload.set(ns, 1);
				newPayload.set(legacyJson, 1 + nsLen);
				const pad = (4 - (newPayload.length % 4)) % 4;
				const chunk = new Uint8Array(8 + newPayload.length + pad);
				const cv = new DataView(chunk.buffer);
				cv.setUint32(0, type, true);
				cv.setUint32(4, newPayload.length, true);
				chunk.set(newPayload, 8);
				parts.push(chunk);
			} else {
				parts.push(bytes.subarray(off, off + padded));
			}
			off += padded;
		}

		const rebuilt = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let o = 0;
		for (const p of parts) {
			rebuilt.set(p, o);
			o += p.length;
		}

		const parsed = parseBinaryMeshBatch(rebuilt);
		expect(parsed.metadata.sourceComponentId).toBe('fixture-multi');
		expect(parsed.metadata.groups.flatMap((g) => g.meshes)).toHaveLength(3);
	});
});
