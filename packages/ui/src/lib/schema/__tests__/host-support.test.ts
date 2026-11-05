import { describe, expect, it } from 'vitest';
import type { LayoutItem, SchemaInput, UISchema } from '@selvajs/schemas';
import {
	isSupportedOn,
	layoutItemKind,
	unsupportedItems,
	valuelessInputIds
} from '../host-support';

const CURVE = '11111111-1111-4111-8111-111111111111';
const BAKE = '22222222-2222-4222-8222-222222222222';
const COUNT = '33333333-3333-4333-8333-333333333333';

const inputs: SchemaInput[] = [
	{ id: CURVE, nickname: 'Curve', paramType: 'geometry' },
	{ id: BAKE, nickname: 'Bake', paramType: 'boolean' },
	{ id: COUNT, nickname: 'Count', paramType: 'number' }
];

// Saved geometry inputs hold the text widget the builder used to give them.
const curveItem = { id: 'a', type: 'input', widgetType: 'text', paramId: CURVE } as LayoutItem;
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
		expect(layoutItemKind(curveItem, inputs)).toBe('geometry');
	});

	it('renders geometry and buttons in Rhino only', () => {
		expect(isSupportedOn('rhino', layoutItemKind(curveItem, inputs))).toBe(true);
		expect(isSupportedOn('selva', layoutItemKind(curveItem, inputs))).toBe(false);
		expect(isSupportedOn('selva', layoutItemKind(bakeItem, inputs))).toBe(false);
		expect(isSupportedOn('selva', layoutItemKind(countItem, inputs))).toBe(true);
	});

	it('renders a layout item from a newer schema on no host', () => {
		expect(isSupportedOn('rhino', layoutItemKind(futureItem, inputs))).toBe(false);
	});

	it('keeps no form value for geometry or buttons', () => {
		expect(valuelessInputIds(schemaWith([curveItem, bakeItem, countItem]))).toEqual(
			new Set([CURVE, BAKE])
		);
	});

	it('lists what a host leaves out', () => {
		const schema = schemaWith([curveItem, bakeItem, countItem]);
		expect(unsupportedItems(schema, 'selva').map((i) => i.id)).toEqual(['a', 'b']);
		expect(unsupportedItems(schema, 'rhino')).toEqual([]);
	});
});
