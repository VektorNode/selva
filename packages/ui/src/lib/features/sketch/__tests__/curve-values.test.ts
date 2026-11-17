import rhino3dm, { type RhinoModule } from 'rhino3dm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SketchCurve } from '@selvajs/sketch/model';
import { curvesFromValue, valueFromCurves, valueItems, valueNeedsRhino } from '../curve-values';
import { modelUnits } from '../units';

let rhino: RhinoModule;
beforeAll(async () => {
	rhino = await rhino3dm();
});

const line: SketchCurve = { kind: 'line', from: [0, 0, 0], to: [10, 0, 0] };
const corner: SketchCurve = {
	kind: 'polyline',
	closed: false,
	points: [
		[0, 0, 0],
		[10, 0, 0],
		[10, 5, 0]
	]
};
const lineJson = { From: { X: 0, Y: 0, Z: 0 }, To: { X: 10, Y: 0, Z: 0 } };

describe('valueItems', () => {
	it('unwraps one item, a list, a branch map and JSON text', () => {
		expect(valueItems(lineJson)).toEqual([lineJson]);
		expect(valueItems([lineJson, lineJson])).toHaveLength(2);
		expect(valueItems({ '{0}': [lineJson], '{0;1}': [lineJson] })).toHaveLength(2);
		expect(valueItems(JSON.stringify([lineJson]))).toEqual([lineJson]);
	});

	it('reads nothing out of an empty or unrelated value', () => {
		for (const value of [null, undefined, '', 'Curve', 5, []]) {
			expect(valueItems(value)).toEqual([]);
		}
	});
});

describe('line inputs', () => {
	it('send { From, To } objects and need no rhino3dm', () => {
		const value = valueFromCurves([line], 'line', null);
		expect(value).toEqual([lineJson]);
		expect(valueNeedsRhino(value)).toBe(false);
		expect(curvesFromValue(value, null)).toEqual([line]);
	});

	it('send a polyline as its segments', () => {
		expect(valueFromCurves([corner], 'line', null)).toHaveLength(2);
	});

	it('send nothing for no curves, so the definition default applies', () => {
		expect(valueFromCurves([], 'line', null)).toBeNull();
		expect(valueFromCurves([], 'geometry', rhino)).toBeNull();
	});
});

describe('geometry inputs', () => {
	it('round-trip through Rhino archives', () => {
		const value = valueFromCurves([line, corner], 'geometry', rhino);
		expect(valueNeedsRhino(value)).toBe(true);
		expect(curvesFromValue(value, rhino)).toEqual([line, corner]);
	});

	it('survive the JSON trip to the server and back as a default', () => {
		const value = valueFromCurves([corner], 'geometry', rhino);
		expect(curvesFromValue(JSON.stringify(value), rhino)).toEqual([corner]);
	});

	it('skip archives while rhino3dm is not loaded', () => {
		const value = valueFromCurves([corner], 'geometry', rhino);
		expect(curvesFromValue(value, null)).toEqual([]);
	});
});

describe('modelUnits', () => {
	it('gives the scale the display parser uses', () => {
		expect(modelUnits('Millimeters')).toEqual({ metersPerUnit: 1e-3, suffix: 'mm' });
		expect(modelUnits('Feet')).toEqual({ metersPerUnit: 0.3048, suffix: 'ft' });
	});

	it('is null until the units are known', () => {
		expect(modelUnits(undefined)).toBeNull();
		expect(modelUnits('CustomUnits')).toBeNull();
	});
});
