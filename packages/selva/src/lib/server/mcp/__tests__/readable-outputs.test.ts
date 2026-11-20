import { describe, expect, it } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { viewInputs } from '../form.js';
import {
	isChartType,
	isValueListType,
	readCharts,
	readValueLists,
	solvedOptions
} from '../readable-outputs.js';

const SCHEMA = {
	id: 's',
	name: 'Kitchen',
	schemaVersion: '2.15.0',
	inputs: [
		{ id: 'in-style', nickname: 'S', paramType: 'valueList' },
		{ id: 'in-colour', nickname: 'C', paramType: 'valueList' },
		{ id: 'in-top', nickname: 'T', paramType: 'valueList' }
	],
	outputs: [
		{ id: 'out-p', nickname: 'Palette', type: 'dynamicValueList', targetInputId: 'in-top' }
	],
	layout: {
		type: 'flat',
		groups: [
			{
				id: 'g',
				items: [
					{
						id: 'l1',
						type: 'input',
						widgetType: 'dropdown',
						paramId: 'in-style',
						displayName: 'Style'
					},
					{
						id: 'l2',
						type: 'input',
						widgetType: 'dynamicValueList',
						paramId: 'in-colour',
						displayName: 'Colour'
					},
					{
						id: 'l3',
						type: 'input',
						widgetType: 'dynamicValueList',
						paramId: 'in-top',
						displayName: 'Worktop'
					}
				]
			}
		]
	}
} as unknown as UISchema;

const item = (payload: unknown, quoteTwice = false) => {
	const json = JSON.stringify(payload);
	return { data: quoteTwice ? JSON.stringify(json) : json };
};

describe('readValueLists', () => {
	it('names the options by the label of the input they fill', () => {
		const read = readValueLists(SCHEMA, 'Palette', [
			item({ targetInputId: 'in-colour', options: { Sage: 'sage', Navy: 'navy' } }, true)
		]);
		expect(read?.text).toBe('options for "Colour": "Sage", "Navy"');
		expect(read?.structured).toEqual({ options: { Colour: ['Sage', 'Navy'] } });
	});

	it("falls back to the schema's target when the payload has none", () => {
		const read = readValueLists(SCHEMA, 'Palette', [
			item({ targetInputId: null, options: { Oak: 'oak' } })
		]);
		expect(read?.text).toBe('options for "Worktop": "Oak"');
	});

	it("lists an Options Table's combinations by label", () => {
		const read = readValueLists(SCHEMA, 'Palette', [
			item({
				targetInputId: null,
				options: {},
				pickTable: {
					by: ['in-style'],
					inputs: ['in-colour', 'in-top'],
					parents: [-1, 0],
					rows: [
						['Shaker', 'Sage', 'Oak'],
						['Handleless', 'Black', 'Marble']
					]
				}
			})
		]);
		expect(read?.text).toBe(
			'valid combinations of "Style", "Colour", "Worktop": ' +
				'["Shaker", "Sage", "Oak"], ["Handleless", "Black", "Marble"]'
		);
	});

	it('reads nothing from a payload it cannot parse', () => {
		expect(readValueLists(SCHEMA, 'Palette', [{ data: 'not json' }])).toBeUndefined();
	});
});

describe('readCharts', () => {
	it("lists each trace's points under the chart title", () => {
		const read = readCharts([
			item({
				data: [
					{ type: 'bar', name: 'Cost', x: ['Worktop', 'Tap'], y: [1200, 310] },
					{ type: 'pie', labels: ['Base', 'Wall'], values: [4331, 900] }
				],
				layout: { title: { text: 'Price breakdown' } }
			})
		]);
		expect(read?.text).toBe(
			'chart "Price breakdown": "Cost" (bar): Worktop = 1200, Tap = 310; ' +
				'(pie): Base = 4331, Wall = 900'
		);
	});

	it('reads a horizontal bar as label against value', () => {
		const read = readCharts([
			item({ data: [{ type: 'bar', orientation: 'h', x: [5], y: ['Pendant'] }] })
		]);
		expect(read?.text).toBe('(bar): Pendant = 5');
	});

	it('shows the head of a long trace', () => {
		const y = Array.from({ length: 60 }, (_, i) => i);
		const read = readCharts([item({ data: [{ type: 'scatter', y }] })]);
		expect(read?.text).toMatch(/49 = 49, and 10 more$/);
	});
});

describe('type detection', () => {
	it('matches the goo type names', () => {
		expect(isValueListType('Selva.GH.Features.ComputeIO.Goos.DynamicValueListGoo')).toBe(true);
		expect(isChartType('Plotly.GH.PlotlyFigure')).toBe(true);
		expect(isChartType('PlotlyFigureGoo')).toBe(false);
	});
});

describe('solvedOptions', () => {
	const DVL = 'Selva.GH.Features.ComputeIO.Goos.DynamicValueListGoo';
	const trees = [
		{
			ParamName: 'Palette',
			InnerTree: {
				'{0}': [
					{
						type: DVL,
						data: JSON.stringify(
							JSON.stringify({
								targetInputId: 'in-colour',
								options: { Sage: 'sage', Navy: 'navy' }
							})
						)
					}
				]
			}
		}
	];

	it('keys the computed options by input id', () => {
		expect(solvedOptions(SCHEMA, trees).get('in-colour')).toEqual({ Sage: 'sage', Navy: 'navy' });
	});

	it("gives the view's form the computed options, resolving a pick no longer offered", () => {
		const solved = solvedOptions(SCHEMA, trees);
		const colour = (given: Record<string, unknown>) =>
			viewInputs(SCHEMA, given, solved).find((i) => i.name === 'Colour');
		expect(colour({ Colour: 'navy' })).toMatchObject({ options: ['Sage', 'Navy'], value: 'Navy' });
		expect(colour({ Colour: 'Teal' })).toMatchObject({ value: 'Sage' });
	});
});
