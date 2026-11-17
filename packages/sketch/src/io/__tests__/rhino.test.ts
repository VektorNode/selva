import rhino3dm, { type RhinoModule } from 'rhino3dm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Point3, SketchCurve, SketchNurbs } from '../../model/curve.js';
import { nurbsFromControlPoints } from '../../model/curve.js';
import { curveLength } from '../../model/measure.js';
import { arcNurbs, evaluateNurbs, nurbsDomain } from '../../model/nurbs.js';
import {
	decodeCurve,
	encodeCurve,
	isRhinoArchive,
	lineFromRhinoJson,
	lineToRhinoJson,
	read3dm,
	type RhinoArchive
} from '../rhino.js';

let rhino: RhinoModule;
beforeAll(async () => {
	rhino = await rhino3dm();
});

const expectPoint = (actual: ArrayLike<number>, expected: Point3) => {
	for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], 9);
};

// rhino3dm's types leave out `delete()` and type `encode()` as void.
const free = (object: unknown) => (object as { delete(): void }).delete();
const encode = (object: unknown) => (object as { encode(): RhinoArchive }).encode();

const roundTrip = (curve: SketchCurve) => decodeCurve(rhino, encodeCurve(rhino, curve));

describe('encodeCurve / decodeCurve', () => {
	it('writes the archive Rhino.Compute reads', () => {
		const archive = encodeCurve(rhino, { kind: 'line', from: [0, 0, 0], to: [10, 0, 0] });
		expect(isRhinoArchive(archive)).toBe(true);
		expect(JSON.parse(JSON.stringify(archive))).toEqual(archive);
	});

	it('round-trips a line', () => {
		const line: SketchCurve = { kind: 'line', from: [1, 2, 3], to: [4, 5, 6] };
		expect(roundTrip(line)).toEqual(line);
	});

	it('round-trips an open and a closed polyline', () => {
		const points: Point3[] = [
			[0, 0, 0],
			[10, 0, 0],
			[10, 5, 0],
			[0, 5, 2]
		];
		const open: SketchCurve = { kind: 'polyline', points, closed: false };
		const closed: SketchCurve = { kind: 'polyline', points, closed: true };
		expect(roundTrip(open)).toEqual(open);
		expect(roundTrip(closed)).toEqual(closed);
	});

	it('round-trips a drawn control-point curve', () => {
		const curve = nurbsFromControlPoints([
			[0, 0, 0],
			[5, 10, 0],
			[10, -10, 0],
			[15, 0, 0],
			[20, 5, 0]
		]);
		expect(roundTrip(curve)).toEqual(curve);
	});

	it('gives Rhino the same shape our own evaluation draws', () => {
		const curve = nurbsFromControlPoints([
			[0, 0, 0],
			[5, 10, 0],
			[10, -10, 0],
			[15, 0, 0],
			[20, 5, 0]
		]);
		const decoded = rhino.CommonObject.decode(encodeCurve(rhino, curve)) as InstanceType<
			RhinoModule['NurbsCurve']
		>;
		const [start, end] = nurbsDomain(curve);
		expect(decoded.domain[0]).toBeCloseTo(start);
		expect(decoded.domain[1]).toBeCloseTo(end);
		for (const t of [start, 0.37, 1, 1.5, end]) {
			expectPoint(decoded.pointAt(t), evaluateNurbs(curve, t));
		}
		free(decoded);
	});

	it('keeps an arc circular through its weights', () => {
		const arc = arcNurbs([0, 0, 0], [1, 0, 0], [0, 1, 0], 10, 0, Math.PI * 1.5);
		const back = roundTrip(arc) as SketchNurbs;
		expect(back.weights).toBeDefined();
		const [start, end] = nurbsDomain(back);
		for (let i = 0; i <= 20; i++) {
			const [x, y] = evaluateNurbs(back, start + ((end - start) * i) / 20);
			expect(Math.hypot(x, y)).toBeCloseTo(10, 9);
		}
		expect(curveLength(back)).toBeCloseTo(10 * Math.PI * 1.5, 2);
	});

	it('reads a Rhino arc as NURBS', () => {
		const circle = new rhino.Circle(5);
		const arcCurve = rhino.ArcCurve.createFromCircle(circle);
		const archive = encode(arcCurve);
		free(arcCurve);
		const curve = decodeCurve(rhino, archive) as SketchNurbs;
		expect(curve.kind).toBe('nurbs');
		expect(curveLength(curve)).toBeCloseTo(2 * Math.PI * 5, 1);
	});

	it('rejects an archive that is not a curve', () => {
		const sphere = new rhino.Sphere([0, 0, 0], 1).toBrep();
		const archive = encode(sphere);
		free(sphere);
		expect(decodeCurve(rhino, archive)).toBeNull();
		expect(
			decodeCurve(rhino, { version: 1, archive3dm: 80, opennurbs: 0, data: 'AAAA' })
		).toBeNull();
	});

	it('refuses to encode a zero-length line', () => {
		expect(() => encodeCurve(rhino, { kind: 'line', from: [1, 1, 1], to: [1, 1, 1] })).toThrow();
	});
});

describe('line JSON', () => {
	it('round-trips', () => {
		const line = { kind: 'line', from: [1, 2, 3], to: [4, 5, 6] } as const;
		expect(lineToRhinoJson(line)).toEqual({ From: { X: 1, Y: 2, Z: 3 }, To: { X: 4, Y: 5, Z: 6 } });
		expect(lineFromRhinoJson(lineToRhinoJson(line))).toEqual(line);
	});

	it('rejects other shapes', () => {
		expect(lineFromRhinoJson(null)).toBeNull();
		expect(lineFromRhinoJson({ From: { X: 0, Y: 0 }, To: { X: 1, Y: 1, Z: 1 } })).toBeNull();
		expect(lineFromRhinoJson('line')).toBeNull();
	});
});

describe('read3dm', () => {
	it('reads curves, their units, and counts what it skips', () => {
		const file = new rhino.File3dm();
		file.settings().modelUnitSystem = rhino.UnitSystem.Meters;
		const objects = file.objects();
		objects.addLine([0, 0, 0], [3, 4, 0]);
		objects.addPolyline(
			[
				[0, 0, 0],
				[1, 0, 0],
				[1, 1, 0]
			],
			null as never
		);
		objects.addPoint([9, 9, 9]);
		const bytes = file.toByteArray();
		free(file);

		const result = read3dm(rhino, bytes);
		expect(result.metersPerUnit).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.curves.map((c) => c.kind).sort()).toEqual(['line', 'polyline']);
	});

	it('throws on bytes that are not a .3dm', () => {
		expect(() => read3dm(rhino, new Uint8Array([1, 2, 3]))).toThrow();
	});
});
