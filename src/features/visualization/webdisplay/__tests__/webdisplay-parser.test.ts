/**
 * Tests for the webdisplay entry point. The mesh-decode internals are covered by
 * batch-parser.test.ts / binary-parser.test.ts; here we pin the orchestration that
 * has no test: the unit-scale table, and that the entry returns cleanly (no scene
 * work, no throw) for responses that carry no Display component.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildMeshBatch } from '@tests/helpers/mesh-batch-builder';

import { SCALE_FACTORS, getThreeMeshesFromComputeResponse } from '../webdisplay-parser';
import type { GrasshopperComputeResponse } from '@/features/grasshopper/types';

function response(values: any[], modelunits = 'Meters'): GrasshopperComputeResponse {
	return { values, modelunits } as unknown as GrasshopperComputeResponse;
}

describe('SCALE_FACTORS', () => {
	it('maps each Rhino unit to its metres-per-unit factor', () => {
		// These drive every WebDisplay mesh's scale; a wrong value silently mis-sizes geometry.
		expect(SCALE_FACTORS.Meters).toBe(1);
		expect(SCALE_FACTORS.Millimeters).toBeCloseTo(0.001, 10);
		expect(SCALE_FACTORS.Centimeters).toBeCloseTo(0.01, 10);
		expect(SCALE_FACTORS.Inches).toBeCloseTo(1 / 39.37, 10);
		expect(SCALE_FACTORS.Feet).toBeCloseTo(1 / 3.28084, 10);
	});
});

describe('getThreeMeshesFromComputeResponse', () => {
	it('returns an empty array for a response with no values', async () => {
		const meshes = await getThreeMeshesFromComputeResponse(response([]));
		expect(meshes).toEqual([]);
	});

	it('returns an empty array when no parameter carries a Display item', async () => {
		// Only the items whose type includes "Display" are decoded; a plain string output
		// must be skipped, yielding no objects and never touching the binary decoder.
		const res = response([
			{ ParamName: 'text', InnerTree: { '{0}': [{ type: 'System.String', data: '"hi"', id: '' }] } }
		]);
		const meshes = await getThreeMeshesFromComputeResponse(res);
		expect(meshes).toEqual([]);
	});

	it('JSON-parses each Display envelope exactly once', async () => {
		// The envelope string carries the full base64 SLVA blob, so a second parse (one per
		// consumer: mesh parser + display-item extractor) doubles main-thread CPU and transient
		// memory. Pin that the orchestration parses it once and threads the object to both.
		const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
		const envelope = JSON.stringify(batch);
		const res = response([
			{ ParamName: 'display', InnerTree: { '{0}': [{ type: 'Display', data: envelope, id: '' }] } }
		]);

		const parseSpy = vi.spyOn(JSON, 'parse');
		try {
			const meshes = await getThreeMeshesFromComputeResponse(res);
			// The single parse must still feed the mesh pipeline.
			expect(meshes.length).toBeGreaterThan(0);
			const envelopeParses = parseSpy.mock.calls.filter(([arg]) => arg === envelope).length;
			expect(envelopeParses).toBe(1);
		} finally {
			parseSpy.mockRestore();
		}
	});

	it('does not throw when scaling and auto-position are disabled on an empty response', async () => {
		const meshes = await getThreeMeshesFromComputeResponse(response([], 'Millimeters'), {
			allowScaling: false,
			allowAutoPosition: false
		});
		expect(meshes).toEqual([]);
	});
});
