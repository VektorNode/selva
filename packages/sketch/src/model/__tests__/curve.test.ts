import { describe, expect, it } from 'vitest';

import {
	clampedKnots,
	explodeToLines,
	isValidCurve,
	nurbsFromControlPoints,
	withoutVertex,
	type Point3,
	type SketchPolyline
} from '../curve.js';
import { curveLength, segmentsOf, setSegmentLength } from '../measure.js';
import { arcNurbs, evaluateNurbs, nurbsDomain, tessellate } from '../nurbs.js';

const square: SketchPolyline = {
	kind: 'polyline',
	closed: true,
	points: [
		[0, 0, 0],
		[10, 0, 0],
		[10, 10, 0],
		[0, 10, 0]
	]
};

describe('nurbs', () => {
	it('builds clamped knots', () => {
		expect(clampedKnots(4, 3)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
		expect(clampedKnots(6, 3)).toEqual([0, 0, 0, 0, 1, 2, 3, 3, 3, 3]);
	});

	it('lowers the degree for few points', () => {
		expect(
			nurbsFromControlPoints([
				[0, 0, 0],
				[1, 0, 0]
			]).degree
		).toBe(1);
		expect(
			nurbsFromControlPoints([
				[0, 0, 0],
				[1, 0, 0],
				[2, 1, 0]
			]).degree
		).toBe(2);
	});

	it('starts and ends on the end control points', () => {
		const points: Point3[] = [
			[0, 0, 0],
			[1, 5, 0],
			[4, 5, 0],
			[5, 0, 1]
		];
		const curve = nurbsFromControlPoints(points);
		const [start, end] = nurbsDomain(curve);
		expect(evaluateNurbs(curve, start)).toEqual(points[0]);
		expect(evaluateNurbs(curve, end)).toEqual(points[3]);
		// A single cubic span is a Bézier curve: its midpoint is (P0 + 3P1 + 3P2 + P3) / 8.
		expect(evaluateNurbs(curve, 0.5)).toEqual([2.5, 3.75, 0.125]);
	});

	it('draws an exact full circle', () => {
		const circle = arcNurbs([1, 2, 3], [1, 0, 0], [0, 1, 0], 4, 0, Math.PI * 2);
		for (const [x, y, z] of tessellate(circle)) {
			expect(Math.hypot(x - 1, y - 2)).toBeCloseTo(4, 12);
			expect(z).toBeCloseTo(3, 12);
		}
		expect(isValidCurve(circle)).toBe(true);
	});
});

describe('measure', () => {
	it('lists a closed polyline with its closing segment', () => {
		expect(segmentsOf(square).map((s) => s.length)).toEqual([10, 10, 10, 10]);
		expect(curveLength(square)).toBe(40);
	});

	it('moves everything after a resized segment', () => {
		const open: SketchPolyline = { ...square, closed: false };
		const resized = setSegmentLength(open, 0, 15) as SketchPolyline;
		expect(resized.points).toEqual([
			[0, 0, 0],
			[15, 0, 0],
			[15, 10, 0],
			[5, 10, 0]
		]);
	});

	it('moves the start of a closing segment', () => {
		const resized = setSegmentLength(square, 3, 4) as SketchPolyline;
		expect(resized.points[3]).toEqual([0, 4, 0]);
		expect(resized.points[0]).toEqual([0, 0, 0]);
	});

	it('leaves the curve alone for a length that is not positive', () => {
		expect(setSegmentLength(square, 0, 0)).toBe(square);
		expect(setSegmentLength(square, 0, Number.NaN)).toBe(square);
	});
});

describe('curve edits', () => {
	it('opens a closed polyline that drops to two points', () => {
		const triangle: SketchPolyline = { ...square, points: square.points.slice(0, 3) };
		expect(withoutVertex(triangle, 0)).toEqual({
			kind: 'polyline',
			closed: false,
			points: [
				[10, 0, 0],
				[10, 10, 0]
			]
		});
	});

	it('explodes polylines into lines and drops curved NURBS', () => {
		const lines = explodeToLines([
			square,
			nurbsFromControlPoints([
				[0, 0, 0],
				[1, 5, 0],
				[4, 5, 0],
				[5, 0, 0]
			])
		]);
		expect(lines).toHaveLength(4);
		expect(lines[3]).toEqual({ kind: 'line', from: [0, 10, 0], to: [0, 0, 0] });
	});

	it('rejects curves Rhino would not take', () => {
		expect(isValidCurve({ kind: 'line', from: [0, 0, 0], to: [0, 0, 0] })).toBe(false);
		expect(
			isValidCurve({
				kind: 'polyline',
				closed: true,
				points: [
					[0, 0, 0],
					[1, 0, 0]
				]
			})
		).toBe(false);
		expect(
			isValidCurve({
				kind: 'nurbs',
				degree: 3,
				points: [
					[0, 0, 0],
					[1, 0, 0]
				],
				knots: []
			})
		).toBe(false);
	});
});
