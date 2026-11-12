import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import {
	buildFormModel,
	keepHiddenPicks,
	readRowPicks,
	resolvePick,
	resolvePicks,
	withRowPick
} from '../dynamic-value-list';

// Options Table and Repeat ride the dynamicValueList output channel: each payload sits in `values`
// under its output id. Grasshopper resolves every pick in the solve; the form shows the same
// answer from the payloads and the picks on screen, and never sends a correction.

const STYLE = 'style';
const FRONTS = 'fronts';
const HANDLES = 'handles';
const OPTIONS = 'out-options';
const CABINETS = 'out-cabinets';

function schemaWith(outputIds: string[]): UISchema {
	return {
		inputs: [],
		outputs: outputIds.map((id) => ({ id, type: 'dynamicValueList' })),
		layout: { type: 'tabbed', tabs: [] }
	} as unknown as UISchema;
}

const list = (...names: string[]) => Object.fromEntries(names.map((n) => [n, n]));
const picks = (byRow: Record<string, string>) => JSON.stringify(byRow);

// Style narrows the table without being filled; Fronts narrows on it, Handles on Fronts.
const kitchen = {
	targetInputId: null,
	options: {},
	resolvedInSolve: true,
	pickTable: {
		by: [STYLE],
		inputs: [FRONTS, HANDLES],
		parents: [-1, 0],
		rows: [
			['Shaker', 'Shaker door', 'Knob'],
			['Shaker', 'Shaker door', 'Bar'],
			['Shaker', 'Shaker drawers', 'Cup pull'],
			['Shaker', 'Shaker drawers', 'Knob'],
			['Shaker', 'Open shelves', 'None'],
			['Handleless', 'Push door', 'None']
		]
	}
};

const cabinets = {
	targetInputId: null,
	options: {},
	resolvedInSolve: true,
	rows: [
		{ key: 'back/sink', label: 'Sink', section: 'Back wall' },
		{ key: 'back/drawers', label: 'Drawers', section: 'Back wall' }
	],
	members: [FRONTS, HANDLES]
};

describe('buildFormModel: pick tables', () => {
	const schema = schemaWith([OPTIONS]);

	it('narrows by the value on screen, with no new payload', () => {
		const shaker = buildFormModel(schema, { [OPTIONS]: kitchen, [STYLE]: 'Shaker' });
		const handleless = buildFormModel(schema, { [OPTIONS]: kitchen, [STYLE]: 'Handleless' });

		expect(Object.keys(shaker.options[FRONTS])).toEqual([
			'Shaker door',
			'Shaker drawers',
			'Open shelves'
		]);
		expect(Object.keys(handleless.options[FRONTS])).toEqual(['Push door']);
	});

	it('reads a JSON-string payload, as Rhino.Compute returns it', () => {
		const model = buildFormModel(schema, {
			[OPTIONS]: JSON.stringify(kitchen),
			[STYLE]: 'Handleless'
		});
		expect(model.options[FRONTS]).toEqual(list('Push door'));
	});

	it('shows the resolved pick and keeps what the user picked', () => {
		const values = { [OPTIONS]: kitchen, [STYLE]: 'Handleless', [FRONTS]: 'Shaker drawers' };

		expect(buildFormModel(schema, values).shown[FRONTS]).toBe('Push door');
		// Back on Shaker the pick is offered again, so it shows again.
		expect(buildFormModel(schema, { ...values, [STYLE]: 'Shaker' }).shown[FRONTS]).toBe(
			'Shaker drawers'
		);
	});

	it('leaves a list that is not resolved in the solve to the control', () => {
		const unwired = { targetInputId: FRONTS, options: list('Push door') };
		const model = buildFormModel(schema, { [OPTIONS]: unwired, [FRONTS]: 'Shaker door' });

		expect(model.shown).toEqual({});
		expect(model.options[FRONTS]).toEqual(list('Push door'));
	});
});

describe('buildFormModel: repeats', () => {
	const schema = schemaWith([OPTIONS, CABINETS]);
	const outputs = { [OPTIONS]: kitchen, [CABINETS]: cabinets };

	it('gives every row of a repeated input its own options and a first pick', () => {
		const model = buildFormModel(schema, { ...outputs, [STYLE]: 'Shaker' });

		expect(model.repeats).toHaveLength(1);
		expect(model.repeatOf[FRONTS]).toBe(CABINETS);
		expect(model.rowOptions[FRONTS]).toHaveLength(2);
		expect(model.options[FRONTS]).toBeUndefined();
		expect(model.shown[FRONTS]).toEqual(['Shaker door', 'Shaker door']);
		expect(model.shown[HANDLES]).toEqual(['Knob', 'Knob']);
	});

	it('narrows each row on that row’s own pick', () => {
		const model = buildFormModel(schema, {
			...outputs,
			[STYLE]: 'Shaker',
			[FRONTS]: picks({ 'back/sink': 'Shaker drawers', 'back/drawers': 'Open shelves' })
		});

		expect(model.rowOptions[HANDLES][0]).toEqual(list('Cup pull', 'Knob'));
		expect(model.rowOptions[HANDLES][1]).toEqual(list('None'));
		expect(model.shown[FRONTS]).toEqual(['Shaker drawers', 'Open shelves']);
	});

	it('resolves a chain at once: the style changes the fronts, the fronts change the handles', () => {
		const model = buildFormModel(schema, {
			...outputs,
			[STYLE]: 'Handleless',
			[FRONTS]: picks({ 'back/sink': 'Shaker drawers', 'back/drawers': 'Shaker door' }),
			[HANDLES]: picks({ 'back/sink': 'Cup pull' })
		});

		expect(model.shown[FRONTS]).toEqual(['Push door', 'Push door']);
		expect(model.rowOptions[HANDLES][0]).toEqual(list('None'));
		expect(model.shown[HANDLES]).toEqual(['None', 'None']);
	});

	it('keeps each pick with its row when the rows change', () => {
		const fronts = picks({ 'back/drawers': 'Open shelves', 'back/sink': 'Shaker drawers' });
		const reordered = {
			...cabinets,
			rows: [{ key: 'side/larder' }, { key: 'back/drawers' }]
		};
		const model = buildFormModel(schema, {
			...outputs,
			[CABINETS]: reordered,
			[STYLE]: 'Shaker',
			[FRONTS]: fronts
		});

		expect(model.shown[FRONTS]).toEqual(['Shaker door', 'Open shelves']);
	});

	it('gives every row the options of a plain payload', () => {
		const computed = { targetInputId: FRONTS, options: list('A', 'B'), resolvedInSolve: true };
		const model = buildFormModel(schema, {
			[OPTIONS]: computed,
			[CABINETS]: { ...cabinets, members: [FRONTS] },
			[FRONTS]: picks({ 'back/drawers': 'B' })
		});

		expect(model.rowOptions[FRONTS]).toEqual([list('A', 'B'), list('A', 'B')]);
		expect(model.shown[FRONTS]).toEqual(['A', 'B']);
	});

	it('gives every row the Repeat’s own options, unless another payload fills the member', () => {
		const computed = { targetInputId: HANDLES, options: list('Knob'), resolvedInSolve: true };
		const model = buildFormModel(schema, {
			[OPTIONS]: computed,
			[CABINETS]: { ...cabinets, options: list('A', 'B') },
			[FRONTS]: picks({ 'back/drawers': 'B' })
		});

		expect(model.rowOptions[FRONTS]).toEqual([list('A', 'B'), list('A', 'B')]);
		expect(model.shown[FRONTS]).toEqual(['A', 'B']);
		expect(model.rowOptions[HANDLES]).toEqual([list('Knob'), list('Knob')]);
	});

	it('keeps the identity of unchanged arrays given the previous model', () => {
		const first = buildFormModel(schema, { ...outputs, [STYLE]: 'Shaker' });
		const second = buildFormModel(schema, { ...outputs, [STYLE]: 'Shaker', other: 1 }, first);
		expect(second.shown[FRONTS]).toBe(first.shown[FRONTS]);
		expect(second.rowOptions[HANDLES]).toBe(first.rowOptions[HANDLES]);
	});
});

describe('checklist picks', () => {
	it('keeps two options that share a value, as the solve does', () => {
		expect(resolvePicks({ 'Red A': 'red', 'Red B': 'red' }, ['Red A', 'Red B'])).toEqual([
			'red',
			'red'
		]);
	});

	it('keeps picks not offered now through an edit', () => {
		expect(keepHiddenPicks(list('A', 'C'), ['A', 'B'], ['A', 'C'])).toEqual(['A', 'C', 'B']);
	});

	it('drops a pick the edit unticked', () => {
		expect(keepHiddenPicks(list('A', 'B'), ['A', 'B'], ['A'])).toEqual(['A']);
	});
});

describe('row picks', () => {
	it('sets one row and keeps the others, including rows not shown now', () => {
		const value = withRowPick(picks({ gone: 'Bar', a: 'Knob' }), 'b', 'Cup pull');
		expect(readRowPicks(value)).toEqual({ gone: 'Bar', a: 'Knob', b: 'Cup pull' });
	});

	it.each([undefined, '', 'Knob', '["Knob"]', '{ not json', 42])(
		'reads %j as no picks',
		(value) => {
			expect(readRowPicks(value)).toEqual({});
		}
	);
});

// The SAME json files the C# tests load.
describe('cross-stack fixtures', () => {
	const read = (name: string) =>
		JSON.parse(
			readFileSync(
				fileURLToPath(new URL(`../../../../../schemas/fixtures/${name}`, import.meta.url)),
				'utf-8'
			)
		);

	it('reads the repeat fixture', () => {
		const fixture = read('repeat-payload.json');
		const model = buildFormModel(schemaWith(['r']), { r: fixture });
		expect(model.repeats[0].rows.map((r) => r.key)).toEqual([
			'back/sink',
			'back/drawers',
			'side/larder'
		]);
		expect(model.repeats[0].members).toEqual(fixture.members);
	});

	const pickTable = read('pick-table.json') as {
		inputs: string[];
		rows: string[][];
		cases: { name: string; picks: (string | null)[]; options: string[][]; shown: string[] }[];
		repeated: {
			rowKeys: string[];
			members: string[];
			picks: (string | null)[][];
			options: string[][][];
			shown: string[][];
		};
	};

	it.each(['driven', 'branching'] as const)('narrows a pick table like Grasshopper: %s', (name) => {
		const c = read('pick-table.json')[name] as {
			by?: string[];
			inputs: string[];
			parents: number[];
			held?: string[];
			picks: (string | null)[];
			options: string[][];
			shown: string[];
		};
		const payload = {
			targetInputId: null,
			options: {},
			resolvedInSolve: true,
			pickTable: { by: c.by, inputs: c.inputs, parents: c.parents, rows: pickTable.rows }
		};
		const model = buildFormModel(schemaWith(['t']), {
			t: payload,
			...Object.fromEntries((c.by ?? []).map((id, i) => [id, c.held![i]])),
			...Object.fromEntries(c.inputs.map((id, i) => [id, c.picks[i]]))
		});

		expect(c.inputs.map((id) => Object.keys(model.options[id]))).toEqual(c.options);
		expect(c.inputs.map((id) => model.shown[id])).toEqual(c.shown);
		// A By input keeps its own options and value: the table only reads it.
		for (const id of c.by ?? []) expect(id in model.shown).toBe(false);
	});

	it('narrows a pick table per row of a repeat like Grasshopper', () => {
		const c = pickTable.repeated;
		const repeat = {
			targetInputId: null,
			options: {},
			resolvedInSolve: true,
			rows: c.rowKeys.map((key) => ({ key })),
			members: c.members
		};
		const values = Object.fromEntries(
			pickTable.inputs.map((id, i) => [
				id,
				c.members.includes(id)
					? JSON.stringify(
							Object.fromEntries(
								c.rowKeys.map((key, r) => [key, c.picks[i][r]]).filter(([, pick]) => pick !== null)
							)
						)
					: c.picks[i][0]
			])
		);
		const model = buildFormModel(schemaWith(['t', 'r']), { t: tablePayload, r: repeat, ...values });

		pickTable.inputs.forEach((id, i) => {
			const repeated = c.members.includes(id);
			const offered = repeated ? model.rowOptions[id] : [model.options[id]];
			expect(offered.map((o) => Object.keys(o))).toEqual(c.options[i]);
			expect(repeated ? model.shown[id] : [model.shown[id]]).toEqual(c.shown[i]);
		});
	});
	const tablePayload = {
		targetInputId: null,
		options: {},
		resolvedInSolve: true,
		pickTable: { inputs: pickTable.inputs, rows: pickTable.rows }
	};
	const tablePicks = (picks: (string | null)[]) =>
		Object.fromEntries(pickTable.inputs.map((id, i) => [id, picks[i]]));

	it.each(pickTable.cases)('narrows a pick table like Grasshopper: $name', (c) => {
		const model = buildFormModel(schemaWith(['t']), { t: tablePayload, ...tablePicks(c.picks) });
		expect(pickTable.inputs.map((id) => Object.keys(model.options[id]))).toEqual(c.options);
		expect(pickTable.inputs.map((id) => model.shown[id])).toEqual(c.shown);
	});

	it('keeps a pick table input’s options object while the picks before it stay', () => {
		const [style, front, handle] = pickTable.inputs;
		const values = { t: tablePayload, ...tablePicks(['Slab', 'Slab door', 'Bar']) };
		const first = buildFormModel(schemaWith(['t']), values);
		const second = buildFormModel(schemaWith(['t']), { ...values, [handle]: 'Edge pull' });
		const third = buildFormModel(schemaWith(['t']), { ...values, [style]: 'Shaker' });

		expect(second.options[handle]).toBe(first.options[handle]);
		expect(third.options[style]).toBe(first.options[style]);
		expect(third.options[front]).not.toBe(first.options[front]);
	});

	const resolution = read('dynamic-value-list-resolution.json') as {
		single: {
			name: string;
			options: Record<string, string>;
			pick: string | null;
			expect: string;
		}[];
		rows: {
			name: string;
			rows: string[];
			picks: Record<string, string>;
			options: Record<string, string>[];
			expect: string[];
		}[];
	};

	it.each(resolution.single)('resolves like Grasshopper: $name', (c) => {
		expect(resolvePick(c.options, c.pick)).toBe(c.expect);
	});

	it.each(resolution.rows)('resolves rows like Grasshopper: $name', (c) => {
		const value = picks(c.picks);
		const shown = c.rows.map((key, i) =>
			resolvePick(c.options[Math.min(i, c.options.length - 1)], readRowPicks(value)[key])
		);
		expect(shown).toEqual(c.expect);
	});

	it('resolves a checklist like Grasshopper', () => {
		const options = list('a', 'b', 'c');
		expect(resolvePicks(options, ['c', 'x', 'a', 'c'])).toEqual(['c', 'a']);
		expect(resolvePicks(options, ['x'])).toEqual(['a']);
	});
});
