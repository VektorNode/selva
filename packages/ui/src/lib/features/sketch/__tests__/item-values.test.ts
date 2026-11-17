import rhino3dm, { type RhinoModule } from 'rhino3dm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SketchItem } from '@selvajs/sketch/model';
import { itemsFromValue, valueBranches, valueFromItems, valueNeedsRhino } from '../item-values';
import { modelUnits } from '../units';

let rhino: RhinoModule;
beforeAll(async () => {
	rhino = await rhino3dm();
});

const line: SketchItem = { kind: 'line', from: [0, 0, 0], to: [10, 0, 0] };
const point: SketchItem = { kind: 'point', at: [1, 2, 3] };
const corner: SketchItem = {
	kind: 'polyline',
	closed: false,
	points: [
		[0, 0, 0],
		[10, 0, 0],
		[10, 5, 0]
	]
};
const lineJson = { From: { X: 0, Y: 0, Z: 0 }, To: { X: 10, Y: 0, Z: 0 } };
const pointJson = { X: 1, Y: 2, Z: 3 };

describe('valueBranches', () => {
	it('unwraps one item, a list and JSON text into the default branch', () => {
		const flat = [{ path: undefined, items: [lineJson] }];
		expect(valueBranches(lineJson)).toEqual(flat);
		expect(valueBranches([lineJson])).toEqual(flat);
		expect(valueBranches(JSON.stringify([lineJson]))).toEqual(flat);
	});

	it('keeps the branches of a branch map, with {0} as the default', () => {
		expect(valueBranches({ '{0}': [lineJson], '{0;1}': [lineJson, lineJson] })).toEqual([
			{ path: undefined, items: [lineJson] },
			{ path: [0, 1], items: [lineJson, lineJson] }
		]);
	});

	it('reads nothing out of an empty or unrelated value', () => {
		for (const value of [null, undefined, '', 'Curve', 5, []]) {
			expect(valueBranches(value)).toEqual([]);
		}
	});
});

describe('line inputs', () => {
	it('send { From, To } objects and need no rhino3dm', () => {
		const value = valueFromItems([line], 'line', null);
		expect(value).toEqual([lineJson]);
		expect(valueNeedsRhino(value)).toBe(false);
		expect(itemsFromValue(value, null)).toEqual([line]);
	});

	it('send a polyline as its segments and leave points out', () => {
		expect(valueFromItems([corner, point], 'line', null)).toHaveLength(2);
	});
});

describe('point inputs', () => {
	it('send { X, Y, Z } objects and only the points', () => {
		const value = valueFromItems([point, line], 'point', null);
		expect(value).toEqual([pointJson]);
		expect(itemsFromValue(value, null)).toEqual([point]);
	});
});

describe('geometry inputs', () => {
	it('round-trip curves and points through Rhino archives', () => {
		const value = valueFromItems([line, corner, point], 'geometry', rhino);
		expect(valueNeedsRhino(value)).toBe(true);
		expect(itemsFromValue(value, rhino)).toEqual([line, corner, point]);
	});

	it('survive the JSON trip to the server and back as a default', () => {
		const value = valueFromItems([corner], 'geometry', rhino);
		expect(itemsFromValue(JSON.stringify(value), rhino)).toEqual([corner]);
	});

	it('skip archives while rhino3dm is not loaded, and send nothing without it', () => {
		const value = valueFromItems([corner], 'geometry', rhino);
		expect(itemsFromValue(value, null)).toEqual([]);
		expect(valueFromItems([corner], 'geometry', null)).toBeNull();
	});
});

describe('branches', () => {
	const a = { ...line, path: [0, 0] };
	const b = { ...line, path: [0, 1], attributes: { role: 'inner' } };

	it('turn the value into a data tree and come back with their paths', () => {
		const value = valueFromItems([a, b, b], 'geometry', rhino) as Record<string, unknown[]>;
		expect(Object.keys(value)).toEqual(['{0;0}', '{0;1}']);
		expect(value['{0;1}']).toHaveLength(2);
		expect(itemsFromValue(value, rhino)).toEqual([a, b, b]);
	});

	it('stay a plain list while every item sits in {0}', () => {
		expect(Array.isArray(valueFromItems([{ ...line, path: [0] }, line], 'line', null))).toBe(true);
	});

	it('reach a line input, which carries the path but no attributes', () => {
		expect(valueFromItems([a, b], 'line', null)).toEqual({
			'{0;0}': [lineJson],
			'{0;1}': [lineJson]
		});
	});
});

describe('nothing to send', () => {
	it('is null, so the definition default applies', () => {
		expect(valueFromItems([], 'line', null)).toBeNull();
		expect(valueFromItems([], 'geometry', rhino)).toBeNull();
		expect(valueFromItems([line], 'point', null)).toBeNull();
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
