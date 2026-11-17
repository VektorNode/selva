import { describe, expect, it } from 'vitest';

import type { SketchNurbs, SketchPolyline } from '../../model/curve.js';
import { curveLength } from '../../model/measure.js';
import { evaluateNurbs, nurbsDomain } from '../../model/nurbs.js';
import { parseDxf } from '../dxf.js';

const dxf = (entities: (string | number)[], header: (string | number)[] = []) =>
	[
		0,
		'SECTION',
		2,
		'HEADER',
		...header,
		0,
		'ENDSEC',
		0,
		'SECTION',
		2,
		'ENTITIES',
		...entities,
		0,
		'ENDSEC',
		0,
		'EOF'
	].join('\r\n');

describe('parseDxf', () => {
	it('reads units from $INSUNITS', () => {
		expect(parseDxf(dxf([], [9, '$INSUNITS', 70, 4])).metersPerUnit).toBe(1e-3);
		expect(parseDxf(dxf([], [9, '$INSUNITS', 70, 0])).metersPerUnit).toBeNull();
		expect(parseDxf(dxf([])).metersPerUnit).toBeNull();
	});

	it('reads a line', () => {
		const { curves } = parseDxf(dxf([0, 'LINE', 8, '0', 10, 1, 20, 2, 30, 3, 11, 4, 21, 5, 31, 6]));
		expect(curves).toEqual([{ kind: 'line', from: [1, 2, 3], to: [4, 5, 6] }]);
	});

	it('reads a closed lightweight polyline at its elevation', () => {
		const { curves } = parseDxf(
			dxf([0, 'LWPOLYLINE', 90, 3, 70, 1, 38, 5, 10, 0, 20, 0, 10, 10, 20, 0, 10, 10, 20, 10])
		);
		expect(curves).toEqual([
			{
				kind: 'polyline',
				closed: true,
				points: [
					[0, 0, 5],
					[10, 0, 5],
					[10, 10, 5]
				]
			}
		]);
	});

	it('turns a bulge into an exact arc', () => {
		// Bulge 1 is a half circle, counter-clockwise from (0,0) to (10,0): it dips to (5,-5).
		const { curves } = parseDxf(
			dxf([0, 'LWPOLYLINE', 90, 2, 70, 0, 10, 0, 20, 0, 42, 1, 10, 10, 20, 0])
		);
		const curve = curves[0] as SketchNurbs;
		expect(curve.kind).toBe('nurbs');
		expect(curveLength(curve)).toBeCloseTo(Math.PI * 5, 2);
		const [start, end] = nurbsDomain(curve);
		const middle = evaluateNurbs(curve, (start + end) / 2);
		expect(middle[0]).toBeCloseTo(5);
		expect(middle[1]).toBeCloseTo(-5);
	});

	it('reads a 3D polyline and ends it at SEQEND', () => {
		const vertex = (x: number, y: number, z: number) => [0, 'VERTEX', 10, x, 20, y, 30, z, 70, 32];
		const { curves, skipped } = parseDxf(
			dxf([
				0,
				'POLYLINE',
				66,
				1,
				70,
				8,
				...vertex(0, 0, 0),
				...vertex(1, 0, 2),
				...vertex(1, 1, 4),
				0,
				'SEQEND',
				0,
				'LINE',
				10,
				0,
				20,
				0,
				11,
				1,
				21,
				0
			])
		);
		expect((curves[0] as SketchPolyline).points).toEqual([
			[0, 0, 0],
			[1, 0, 2],
			[1, 1, 4]
		]);
		expect(curves[1].kind).toBe('line');
		expect(skipped).toEqual({});
	});

	it('reads a spline with its knots and weights', () => {
		const { curves } = parseDxf(
			dxf([
				0,
				'SPLINE',
				70,
				8,
				71,
				2,
				...[0, 0, 0, 1, 1, 1].flatMap((k) => [40, k]),
				...[
					[0, 0],
					[5, 5],
					[10, 0]
				].flatMap(([x, y]) => [10, x, 20, y, 30, 0]),
				...[1, 0.5, 1].flatMap((w) => [41, w])
			])
		);
		expect(curves[0]).toEqual({
			kind: 'nurbs',
			degree: 2,
			knots: [0, 0, 0, 1, 1, 1],
			points: [
				[0, 0, 0],
				[5, 5, 0],
				[10, 0, 0]
			],
			weights: [1, 0.5, 1]
		});
	});

	it('reads an arc counter-clockwise across zero degrees', () => {
		const { curves } = parseDxf(dxf([0, 'ARC', 10, 0, 20, 0, 30, 0, 40, 2, 50, 270, 51, 90]));
		const curve = curves[0] as SketchNurbs;
		expect(curveLength(curve)).toBeCloseTo(Math.PI * 2, 2);
		const [start, end] = nurbsDomain(curve);
		expect(evaluateNurbs(curve, start)[1]).toBeCloseTo(-2);
		expect(evaluateNurbs(curve, (start + end) / 2)[0]).toBeCloseTo(2);
	});

	it('mirrors an arc whose extrusion points down', () => {
		// In a plane with normal (0,0,-1) the entity's X axis is world -X.
		const { curves } = parseDxf(
			dxf([0, 'ARC', 10, 3, 20, 0, 30, 0, 40, 1, 50, 0, 51, 90, 210, 0, 220, 0, 230, -1])
		);
		const curve = curves[0] as SketchNurbs;
		const [start, end] = nurbsDomain(curve);
		const from = evaluateNurbs(curve, start);
		const to = evaluateNurbs(curve, end);
		expect(from[0]).toBeCloseTo(-4);
		expect(from[1]).toBeCloseTo(0);
		expect(to[0]).toBeCloseTo(-3);
		expect(to[1]).toBeCloseTo(1);
	});

	it('counts what it does not read', () => {
		const { curves, skipped } = parseDxf(
			dxf([
				0,
				'INSERT',
				2,
				'BLOCK',
				0,
				'TEXT',
				1,
				'hi',
				0,
				'TEXT',
				1,
				'ho',
				0,
				'LINE',
				10,
				0,
				11,
				0
			])
		);
		expect(curves).toEqual([]);
		expect(skipped).toEqual({ INSERT: 1, TEXT: 2, LINE: 1 });
	});

	it('ignores entities inside block definitions', () => {
		const text = [0, 'SECTION', 2, 'BLOCKS', 0, 'LINE', 10, 0, 11, 5, 0, 'ENDSEC', 0, 'EOF'].join(
			'\n'
		);
		expect(parseDxf(text).curves).toEqual([]);
	});

	it('refuses a binary DXF', () => {
		expect(() => parseDxf('AutoCAD Binary DXF\r\n\u001a\u0000')).toThrow(/ASCII/);
	});
});
