/**
 * Tests for the webdisplay entry point. The mesh-decode internals are covered by
 * batch-parser.test.ts / binary-parser.test.ts; here we pin the orchestration that
 * has no test elsewhere: the unit-scale table (exact factors, unknown-unit warning),
 * unit scaling applied to parsed objects, the exact-token Display-type dispatch, and
 * that the entry returns cleanly (no scene work, no throw) for responses that carry
 * no Display component.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMeshBatch } from '@tests/helpers/mesh-batch-builder';
import { setLogger } from '@/core';
import { computeCombinedBoundingBox } from '../../threejs/three-helpers.js';

import { SCALE_FACTORS, getThreeMeshesFromComputeResponse } from '../webdisplay-parser';
import type { GrasshopperComputeResponse } from '@/features/grasshopper/types';

function response(values: any[], modelunits = 'Meters'): GrasshopperComputeResponse {
	return { values, modelunits } as unknown as GrasshopperComputeResponse;
}

/** Wraps a built batch in the response envelope shape the server produces. */
function displayResponse(modelunits: string, type = 'Display'): GrasshopperComputeResponse {
	const { batch } = buildMeshBatch({ materialCount: 1, meshCount: 2, vertsPerMesh: 3 });
	return response(
		[
			{
				ParamName: 'display',
				InnerTree: { '{0}': [{ type, data: JSON.stringify(batch), id: '' }] }
			}
		],
		modelunits
	);
}

const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

afterEach(() => {
	setLogger(noopLogger);
});

describe('SCALE_FACTORS', () => {
	it('maps each Rhino unit to its exact metres-per-unit factor', () => {
		// These drive every WebDisplay mesh's scale; a wrong value silently mis-sizes geometry.
		// Imperial factors are the exact international definitions (1 in = 0.0254 m), not the
		// lossy 1/39.37-style approximations they used to be (issue 33).
		expect(SCALE_FACTORS.Meters).toBe(1);
		expect(SCALE_FACTORS.Millimeters).toBe(0.001);
		expect(SCALE_FACTORS.Centimeters).toBe(0.01);
		expect(SCALE_FACTORS.Decimeters).toBe(0.1);
		expect(SCALE_FACTORS.Kilometers).toBe(1000);
		expect(SCALE_FACTORS.Microns).toBe(1e-6);
		expect(SCALE_FACTORS.Inches).toBe(0.0254);
		expect(SCALE_FACTORS.Feet).toBe(0.3048);
		expect(SCALE_FACTORS.Yards).toBe(0.9144);
		expect(SCALE_FACTORS.Miles).toBe(1609.344);
	});

	it('keeps inches and feet mutually consistent (1 ft = 12 in)', () => {
		expect(SCALE_FACTORS.Feet).toBeCloseTo(SCALE_FACTORS.Inches! * 12, 12);
		expect(SCALE_FACTORS.Miles).toBeCloseTo(SCALE_FACTORS.Feet! * 5280, 9);
	});
});

describe('getThreeMeshesFromComputeResponse', () => {
	it('returns an empty array for a response with no values', async () => {
		const meshes = await getThreeMeshesFromComputeResponse(response([]));
		expect(meshes).toEqual([]);
	});

	it('returns an empty array when no parameter carries a Display item', async () => {
		// Only Display-typed items are decoded; a plain string output must be skipped,
		// yielding no objects and never touching the binary decoder.
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

describe('Display-type dispatch (issue 34)', () => {
	it('decodes the real namespaced wire type', async () => {
		const res = displayResponse('Meters', 'Selva.GH.Features.Display.Services.DisplayBatch');
		const meshes = await getThreeMeshesFromComputeResponse(res, { allowAutoPosition: false });
		expect(meshes.length).toBeGreaterThan(0);
	});

	it('decodes the bare "Display" token', async () => {
		const res = displayResponse('Meters', 'Display');
		const meshes = await getThreeMeshesFromComputeResponse(res, { allowAutoPosition: false });
		expect(meshes.length).toBeGreaterThan(0);
	});

	it('skips unrelated types that merely CONTAIN "Display" as a substring', async () => {
		// The old substring dispatch would feed these to the SLVA parser.
		for (const type of ['System.DisplayText', 'DisplayText', 'My.DisplayBatchLike']) {
			const res = displayResponse('Meters', type);
			const meshes = await getThreeMeshesFromComputeResponse(res, { allowAutoPosition: false });
			expect(meshes).toEqual([]);
		}
	});
});

describe('unit scaling (issue 33)', () => {
	it('applies the metres-per-unit factor to every parsed object', async () => {
		const res = displayResponse('Millimeters');
		const meshes = await getThreeMeshesFromComputeResponse(res, { allowAutoPosition: false });

		expect(meshes.length).toBeGreaterThan(0);
		for (const mesh of meshes) {
			expect(mesh.scale.x).toBe(0.001);
			expect(mesh.scale.y).toBe(0.001);
			expect(mesh.scale.z).toBe(0.001);
		}
	});

	it('grounds geometry on the Z=0 plane when allowAutoPosition is enabled', async () => {
		const res = displayResponse('Meters');
		const meshes = await getThreeMeshesFromComputeResponse(res);

		expect(meshes.length).toBeGreaterThan(0);
		const box = computeCombinedBoundingBox(meshes);
		expect(box.min.z).toBeCloseTo(0, 5);
	});

	it('leaves scale at identity when allowScaling is false', async () => {
		const res = displayResponse('Millimeters');
		const meshes = await getThreeMeshesFromComputeResponse(res, {
			allowScaling: false,
			allowAutoPosition: false
		});

		expect(meshes.length).toBeGreaterThan(0);
		for (const mesh of meshes) {
			expect(mesh.scale.x).toBe(1);
		}
	});

	it('warns once (and scales 1) for an unknown Rhino unit', async () => {
		const warn = vi.fn();
		setLogger({ ...noopLogger, warn });

		const first = await getThreeMeshesFromComputeResponse(displayResponse('Parsecs'), {
			allowAutoPosition: false
		});
		expect(first.length).toBeGreaterThan(0);
		for (const mesh of first) {
			expect(mesh.scale.x).toBe(1); // fallback factor, but no longer silent
		}

		const unitWarnings = warn.mock.calls.filter(([msg]) =>
			String(msg).includes('Unknown Rhino model unit "Parsecs"')
		);
		expect(unitWarnings).toHaveLength(1);

		// Same unknown unit again: no second warning (once per unit name, not per solve).
		await getThreeMeshesFromComputeResponse(displayResponse('Parsecs'), {
			allowAutoPosition: false
		});
		const unitWarningsAfter = warn.mock.calls.filter(([msg]) =>
			String(msg).includes('Unknown Rhino model unit "Parsecs"')
		);
		expect(unitWarningsAfter).toHaveLength(1);

		// A different unknown unit warns on its own.
		await getThreeMeshesFromComputeResponse(displayResponse('LightYears'), {
			allowAutoPosition: false
		});
		const otherUnitWarnings = warn.mock.calls.filter(([msg]) =>
			String(msg).includes('Unknown Rhino model unit "LightYears"')
		);
		expect(otherUnitWarnings).toHaveLength(1);
	});
});
