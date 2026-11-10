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

// Options By and Repeat ride the dynamicValueList output channel: each payload sits in `values`
// under its output id. Grasshopper resolves every pick in the solve; the form shows the same
// answer from the payloads and the picks on screen, and never sends a correction.

const STYLE = 'style';
const FRONTS = 'fronts';
const HANDLES = 'handles';
const FRONT_TABLE = 'out-front-table';
const HANDLE_TABLE = 'out-handle-table';
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

const frontTable = {
	targetInputId: FRONTS,
	options: {},
	by: STYLE,
	resolvedInSolve: true,
	table: {
		Shaker: list('Shaker door', 'Shaker drawers', 'Open shelves'),
		Handleless: list('Push door'),
		'*': list('Slab door')
	}
};

const handleTable = {
	targetInputId: HANDLES,
	options: {},
	by: FRONTS,
	resolvedInSolve: true,
	table: {
		'Shaker drawers': list('Cup pull', 'Knob'),
		'Push door': list('None'),
		'*': list('Knob', 'Bar')
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

describe('buildFormModel: option tables', () => {
	const schema = schemaWith([FRONT_TABLE]);

	it('picks the branch for the driver value on screen, with no new payload', () => {
		const shaker = buildFormModel(schema, { [FRONT_TABLE]: frontTable, [STYLE]: 'Shaker' });
		const handleless = buildFormModel(schema, { [FRONT_TABLE]: frontTable, [STYLE]: 'Handleless' });

		expect(Object.keys(shaker.options[FRONTS])).toEqual([
			'Shaker door',
			'Shaker drawers',
			'Open shelves'
		]);
		expect(Object.keys(handleless.options[FRONTS])).toEqual(['Push door']);
	});

	it('falls back to the * branch for a value the table does not name', () => {
		const model = buildFormModel(schema, { [FRONT_TABLE]: frontTable, [STYLE]: 'Slab' });
		expect(model.options[FRONTS]).toEqual(list('Slab door'));
	});

	it('reads a JSON-string payload, as Rhino.Compute returns it', () => {
		const model = buildFormModel(schema, {
			[FRONT_TABLE]: JSON.stringify(frontTable),
			[STYLE]: 'Handleless'
		});
		expect(model.options[FRONTS]).toEqual(list('Push door'));
	});

	it('shows the resolved pick and keeps what the user picked', () => {
		const values = { [FRONT_TABLE]: frontTable, [STYLE]: 'Handleless', [FRONTS]: 'Shaker drawers' };

		expect(buildFormModel(schema, values).shown[FRONTS]).toBe('Push door');
		// Back on Shaker the pick is offered again, so it shows again.
		expect(buildFormModel(schema, { ...values, [STYLE]: 'Shaker' }).shown[FRONTS]).toBe(
			'Shaker drawers'
		);
	});

	it('leaves a list that is not resolved in the solve to the control', () => {
		const legacy = { ...frontTable, resolvedInSolve: undefined };
		const model = buildFormModel(schema, { [FRONT_TABLE]: legacy, [STYLE]: 'Handleless' });

		expect(model.shown).toEqual({});
		expect(model.options[FRONTS]).toEqual(list('Push door'));
	});
});

describe('buildFormModel: repeats', () => {
	const schema = schemaWith([FRONT_TABLE, HANDLE_TABLE, CABINETS]);
	const outputs = {
		[FRONT_TABLE]: frontTable,
		[HANDLE_TABLE]: handleTable,
		[CABINETS]: cabinets
	};

	it('gives every row of a repeated input its own options and a first pick', () => {
		const model = buildFormModel(schema, { ...outputs, [STYLE]: 'Shaker' });

		expect(model.repeats).toHaveLength(1);
		expect(model.repeatOf[FRONTS]).toBe(CABINETS);
		expect(model.rowOptions[FRONTS]).toHaveLength(2);
		expect(model.options[FRONTS]).toBeUndefined();
		expect(model.shown[FRONTS]).toEqual(['Shaker door', 'Shaker door']);
		expect(model.shown[HANDLES]).toEqual(['Knob', 'Knob']);
	});

	it('reads a row-wise driver per row, from what it shows', () => {
		const model = buildFormModel(schema, {
			...outputs,
			[STYLE]: 'Shaker',
			[FRONTS]: picks({ 'back/sink': 'Shaker drawers', 'back/drawers': 'Open shelves' })
		});

		expect(model.rowOptions[HANDLES][0]).toEqual(list('Cup pull', 'Knob'));
		expect(model.rowOptions[HANDLES][1]).toEqual(list('Knob', 'Bar'));
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
});

describe('buildFormModel: a driver with several items', () => {
	it('gives an input shown once the branch of the first item, as Options By does', () => {
		const schema = schemaWith([FRONT_TABLE]);
		const model = buildFormModel(schema, {
			[FRONT_TABLE]: frontTable,
			[STYLE]: ['Handleless', 'Shaker']
		});
		expect(model.options[FRONTS]).toEqual(list('Push door'));
	});

	it('gives row i of a repeated input the branch of item i, the last item covering the rest', () => {
		const schema = schemaWith([FRONT_TABLE, CABINETS]);
		const model = buildFormModel(schema, {
			[FRONT_TABLE]: frontTable,
			[CABINETS]: { ...cabinets, members: [FRONTS] },
			[STYLE]: ['Handleless']
		});
		expect(model.rowOptions[FRONTS]).toEqual([list('Push door'), list('Push door')]);
	});

	it('keeps the identity of unchanged arrays given the previous model', () => {
		const schema = schemaWith([FRONT_TABLE, HANDLE_TABLE, CABINETS]);
		const values = { [FRONT_TABLE]: frontTable, [HANDLE_TABLE]: handleTable, [CABINETS]: cabinets };
		const first = buildFormModel(schema, { ...values, [STYLE]: 'Shaker' });
		const second = buildFormModel(schema, { ...values, [STYLE]: 'Shaker', other: 1 }, first);
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

	it('reads the option table fixture', () => {
		const fixture = read('option-table-payload.json');
		const model = buildFormModel(schemaWith(['t']), { t: fixture, [fixture.by]: 'Handleless' });
		expect(model.options[fixture.targetInputId]).toEqual(list('Push door'));
		expect(model.shown[fixture.targetInputId]).toBe('Push door');
	});

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
