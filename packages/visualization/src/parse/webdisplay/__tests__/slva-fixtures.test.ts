import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
	FLAG_DELTA_ENCODED,
	FLAG_FLOAT32,
	FLAG_HAS_UVS,
	FLAG_HAS_VERTEX_COLORS,
	FLAG_PLANAR_BYTESPLIT,
	FLAG_UINT16_INDICES,
	parseBinaryMeshBatch
} from '../binary-parser';

import type { ParsedBinaryMeshBatch } from '../binary-parser';

/**
 * Cross-stack SLVA contract: decodes golden blobs written by the C# SlvaWriter
 * (regenerated via `UPDATE_SLVA_FIXTURES=1 dotnet test --filter SlvaFixtureContractTests`) and
 * checks the result against the writer's own inputs from the sibling .expected.json. Unlike the
 * other parser tests, the bytes here were never touched by a TS encoder — this is the only test
 * that catches the writer and this parser disagreeing about the format.
 */

const FIXTURES_DIR = fileURLToPath(
	new URL('../../../../../schemas/fixtures/slva/', import.meta.url)
);

interface ExpectedFixture {
	description: string;
	flags: {
		float32: boolean;
		uint16Indices: boolean;
		deltaEncoded: boolean;
		/** Absent in frozen pre-v4 fixtures. */
		planarByteSplit?: boolean;
		hasUvs: boolean;
		hasColors: boolean;
		float32Uvs: boolean;
	};
	vertexCount: number;
	indexCount: number;
	origin: [number, number, number];
	scale: [number, number, number];
	positionTolerance: number;
	uvTolerance: number;
	sourceComponentId: string;
	positions?: number[];
	indices?: number[];
	uvs?: number[];
	colors?: number[];
	positionSamples?: { index: number; x: number; y: number; z: number }[];
	indexHead?: number[];
	indexTail?: number[];
}

function loadFixture(blobName: string): {
	parsed: ParsedBinaryMeshBatch;
	expected: ExpectedFixture;
} {
	const expectedName = blobName.replace(/\.slv[az]$/, '.expected.json');
	const parsed = parseBinaryMeshBatch(readFileSync(FIXTURES_DIR + blobName));
	const expected = JSON.parse(
		readFileSync(FIXTURES_DIR + expectedName, 'utf-8')
	) as ExpectedFixture;
	return { parsed, expected };
}

/** World position from a parsed batch, applying dequantization when the blob is int16. */
function worldPosition(parsed: ParsedBinaryMeshBatch, vertex: number): [number, number, number] {
	const out: [number, number, number] = [0, 0, 0];
	for (let axis = 0; axis < 3; axis++) {
		const raw = parsed.vertices[vertex * 3 + axis]!;
		out[axis] =
			parsed.vertices instanceof Float32Array
				? raw
				: parsed.origin[axis]! + (raw + 32767) * parsed.scale[axis]!;
	}
	return out;
}

// Current-version fixtures at the root, frozen pre-v4 blobs under v3/ (backward compat: persisted
// blobs must decode forever — those files are never regenerated).
const blobNames = [
	...readdirSync(FIXTURES_DIR).filter((f) => /\.slv[az]$/.test(f)),
	...readdirSync(FIXTURES_DIR + 'v3/')
		.filter((f) => /\.slv[az]$/.test(f))
		.map((f) => 'v3/' + f)
];

describe('SLVA golden fixtures (C#-written blobs)', () => {
	it('covers every committed blob', () => {
		expect(blobNames.length).toBeGreaterThanOrEqual(13);
	});

	it('covers both v4 byte layouts', () => {
		// The writer picks planar or interleaved per blob, so the parser must be exercised on both.
		const layouts = blobNames
			.filter((n) => !n.startsWith('v3/'))
			.map((n) => (loadFixture(n).parsed.flags & FLAG_PLANAR_BYTESPLIT) !== 0);
		expect(layouts).toContain(true);
		expect(layouts).toContain(false);
	});

	describe.each(blobNames)('%s', (blobName) => {
		const { parsed, expected } = loadFixture(blobName);

		it('carries the expected flags and counts', () => {
			expect((parsed.flags & FLAG_FLOAT32) !== 0).toBe(expected.flags.float32);
			expect((parsed.flags & FLAG_UINT16_INDICES) !== 0).toBe(expected.flags.uint16Indices);
			expect((parsed.flags & FLAG_DELTA_ENCODED) !== 0).toBe(expected.flags.deltaEncoded);
			expect((parsed.flags & FLAG_PLANAR_BYTESPLIT) !== 0).toBe(
				expected.flags.planarByteSplit ?? false
			);
			expect((parsed.flags & FLAG_HAS_UVS) !== 0).toBe(expected.flags.hasUvs);
			expect((parsed.flags & FLAG_HAS_VERTEX_COLORS) !== 0).toBe(expected.flags.hasColors);

			expect(parsed.vertices.length).toBe(expected.vertexCount * 3);
			expect(parsed.indices.length).toBe(expected.indexCount);
			expect(parsed.origin).toEqual(expected.origin);
			expect(parsed.scale).toEqual(expected.scale);
		});

		it('parses the metadata envelope', () => {
			expect(parsed.metadata.sourceComponentId).toBe(expected.sourceComponentId);
			expect(parsed.metadata.materials).toHaveLength(1);
			expect(parsed.metadata.groups[0]?.meshes[0]?.vertexCount).toBe(expected.vertexCount);
		});

		it('reconstructs the writer input positions', () => {
			if (expected.positions) {
				for (let v = 0; v < expected.vertexCount; v++) {
					const world = worldPosition(parsed, v);
					for (let axis = 0; axis < 3; axis++) {
						expect(Math.abs(world[axis]! - expected.positions[v * 3 + axis]!)).toBeLessThanOrEqual(
							expected.positionTolerance
						);
					}
				}
			}
			for (const sample of expected.positionSamples ?? []) {
				const world = worldPosition(parsed, sample.index);
				expect(Math.abs(world[0]! - sample.x)).toBeLessThanOrEqual(expected.positionTolerance);
				expect(Math.abs(world[1]! - sample.y)).toBeLessThanOrEqual(expected.positionTolerance);
				expect(Math.abs(world[2]! - sample.z)).toBeLessThanOrEqual(expected.positionTolerance);
			}
		});

		it('reconstructs the writer input indices', () => {
			if (expected.indices) {
				expect(Array.from(parsed.indices)).toEqual(expected.indices);
			}
			if (expected.indexHead) {
				expect(Array.from(parsed.indices.slice(0, expected.indexHead.length))).toEqual(
					expected.indexHead
				);
			}
			if (expected.indexTail) {
				expect(Array.from(parsed.indices.slice(-expected.indexTail.length))).toEqual(
					expected.indexTail
				);
			}
		});

		it('reconstructs UV and color chunks when present', () => {
			if (expected.uvs) {
				expect(parsed.uvs).not.toBeNull();
				for (let i = 0; i < expected.uvs.length; i++) {
					expect(Math.abs(parsed.uvs![i]! - expected.uvs[i]!)).toBeLessThanOrEqual(
						expected.uvTolerance
					);
				}
			} else if (!expected.flags.hasUvs) {
				expect(parsed.uvs).toBeNull();
			}

			if (expected.colors) {
				expect(Array.from(parsed.colors!)).toEqual(expected.colors);
			} else if (!expected.flags.hasColors) {
				expect(parsed.colors).toBeNull();
			}
		});
	});
});
