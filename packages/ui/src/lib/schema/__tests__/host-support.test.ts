import { describe, expect, it } from 'vitest';
import type { LayoutItem, SchemaInput, UISchema } from '@selvajs/schemas';
import {
	isCurveInput,
	isSupportedOn,
	layoutItemKind,
	unsupportedItems,
	valuelessInputIds
} from '../host-support';

const CURVE = '11111111-1111-4111-8111-111111111111';
const BAKE = '22222222-2222-4222-8222-222222222222';
const COUNT = '33333333-3333-4333-8333-333333333333';
const ORIGIN = '44444444-4444-4444-8444-444444444444';
const AXIS = '55555555-5555-4555-8555-555555555555';

const inputs: SchemaInput[] = [
	{ id: CURVE, nickname: 'Curve', paramType: 'geometry' },
	{ id: BAKE, nickname: 'Bake', paramType: 'boolean' },
	{ id: COUNT, nickname: 'Count', paramType: 'number' },
	{ id: ORIGIN, nickname: 'Origin', paramType: 'point' },
	{ id: AXIS, nickname: 'Axis', paramType: 'line' }
];

// Saved geometry inputs hold the text widget the builder used to give them.
const curveItem = { id: 'a', type: 'input', widgetType: 'text', paramId: CURVE } as LayoutItem;
const originItem = { id: 'e', type: 'input', widgetType: 'text', paramId: ORIGIN } as LayoutItem;
const axisItem = { id: 'f', type: 'input', widgetType: 'text', paramId: AXIS } as LayoutItem;
const bakeItem = {
	id: 'b',
	type: 'input',
	widgetType: 'checkbox',
	paramId: BAKE,
	config: { displayAs: 'button' }
} as LayoutItem;
const countItem = { id: 'c', type: 'input', widgetType: 'number', paramId: COUNT } as LayoutItem;
const futureItem = {
	id: 'd',
	type: 'input',
	widgetType: 'hologram',
	paramId: COUNT
} as unknown as LayoutItem;

function schemaWith(items: LayoutItem[]): UISchema {
	return {
		id: 's',
		name: 'S',
		schemaVersion: '2.16.0',
		inputs,
		outputs: [],
		layout: { type: 'flat', groups: [{ id: 'g', label: 'G', items }] }
	} as UISchema;
}

describe('host support', () => {
	it('takes a geometry control from paramType, whatever the saved widget says', () => {
		expect(layoutItemKind(curveItem, inputs)).toBe('curve');
		expect(layoutItemKind(axisItem, inputs)).toBe('curve');
		expect(layoutItemKind(originItem, inputs)).toBe('geometry');
	});

	it('renders curve inputs on both hosts', () => {
		for (const item of [curveItem, axisItem]) {
			expect(isSupportedOn('rhino', layoutItemKind(item, inputs))).toBe(true);
			expect(isSupportedOn('selva', layoutItemKind(item, inputs))).toBe(true);
		}
	});

	it('reads a Get Geometry type filter to tell a curve input from the rest', () => {
		const geometry = (geometryTypes?: SchemaInput['geometryTypes']) =>
			({ paramType: 'geometry', geometryTypes }) as SchemaInput;
		expect(isCurveInput(geometry(['curve']))).toBe(true);
		expect(isCurveInput(geometry(['mesh', 'curve']))).toBe(true);
		expect(isCurveInput(geometry(['mesh', 'polysurface']))).toBe(false);
		// An empty filter allows everything; an absent one is a schema from before 2.22.0.
		expect(isCurveInput(geometry([]))).toBe(true);
		expect(isCurveInput(geometry())).toBe(true);
		expect(isCurveInput({ paramType: 'point' } as SchemaInput)).toBe(false);
		expect(isCurveInput(undefined)).toBe(false);
	});

	it('leaves a Get Geometry that takes no curves to Rhino', () => {
		const meshOnly: SchemaInput[] = [
			{ id: CURVE, nickname: 'Terrain', paramType: 'geometry', geometryTypes: ['mesh'] }
		];
		expect(layoutItemKind(curveItem, meshOnly)).toBe('geometry');
		expect(isSupportedOn('selva', layoutItemKind(curveItem, meshOnly))).toBe(false);
	});

	it('renders points, planes and buttons in Rhino only', () => {
		expect(isSupportedOn('rhino', layoutItemKind(originItem, inputs))).toBe(true);
		expect(isSupportedOn('selva', layoutItemKind(originItem, inputs))).toBe(false);
		expect(isSupportedOn('selva', layoutItemKind(bakeItem, inputs))).toBe(false);
		expect(isSupportedOn('selva', layoutItemKind(countItem, inputs))).toBe(true);
	});

	it('renders a layout item from a newer schema on no host', () => {
		expect(isSupportedOn('rhino', layoutItemKind(futureItem, inputs))).toBe(false);
	});

	it('keeps no form value for geometry or buttons', () => {
		expect(valuelessInputIds(schemaWith([curveItem, bakeItem, countItem]))).toEqual(
			new Set([CURVE, ORIGIN, AXIS, BAKE])
		);
	});

	it('lists what a host leaves out', () => {
		const schema = schemaWith([curveItem, originItem, bakeItem, countItem]);
		expect(unsupportedItems(schema, 'selva').map((i) => i.id)).toEqual(['e', 'b']);
		expect(unsupportedItems(schema, 'rhino')).toEqual([]);
	});
});
