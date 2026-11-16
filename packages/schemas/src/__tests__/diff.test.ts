import { describe, expect, it } from 'vitest';
import { diffSchemas, schemaDiffToMarkdown } from '../index.js';
import type { UISchema } from '../index.js';

type Item = Record<string, unknown>;

function schema(
	parts: {
		inputs?: Item[];
		outputs?: Item[];
		items?: Item[];
		groups?: { label: string; items: Item[] }[];
	} & Item = {}
): UISchema {
	const { inputs = [], outputs = [], items = [], groups, ...rest } = parts;
	return {
		id: 's',
		name: 'Test',
		schemaVersion: '2.20.0',
		inputs,
		outputs,
		layout: {
			type: 'flat',
			groups: (groups ?? [{ label: 'Main', items }]).map((g, i) => ({ id: `g${i}`, ...g }))
		},
		...rest
	} as unknown as UISchema;
}

const width = { id: 'w', nickname: 'Width', paramType: 'number', default: 10 };
const widthItem = (config: Item = {}, extra: Item = {}) => ({
	id: 'li-w',
	type: 'input',
	paramId: 'w',
	widgetType: 'number',
	config: { minimum: 0, maximum: 100, ...config },
	...extra
});
const area = { id: 'a', nickname: 'Area', type: 'number' };
const areaItem = { id: 'li-a', type: 'output', paramId: 'a', widgetType: 'number' };

const one = (s: UISchema, t: UISchema) => {
	const { changes } = diffSchemas(s, t);
	expect(changes).toHaveLength(1);
	return changes[0];
};

describe('diffSchemas', () => {
	it('finds nothing between equal schemas', () => {
		const s = schema({ inputs: [width], outputs: [area], items: [widthItem(), areaItem] });
		const diff = diffSchemas(s, structuredClone(s));
		expect(diff.identical).toBe(true);
		expect(diff.counts).toEqual({ breaking: 0, notable: 0, cosmetic: 0 });
	});

	it('ignores key order inside defaults and config', () => {
		const a = schema({ inputs: [{ ...width, default: { x: 1, y: 2 } }] });
		const b = schema({ inputs: [{ ...width, default: { y: 2, x: 1 } }] });
		expect(diffSchemas(a, b).identical).toBe(true);
	});

	it('a removed input is breaking, an added one notable', () => {
		const height = { id: 'h', nickname: 'Height', paramType: 'number' };
		const diff = diffSchemas(schema({ inputs: [width] }), schema({ inputs: [height] }));
		expect(diff.changes.map((c) => [c.change, c.label, c.impact])).toEqual([
			['removed', 'Width', 'breaking'],
			['added', 'Height', 'notable']
		]);
	});

	it('matches by id, so a recreated input with the same name is removed plus added', () => {
		const recreated = { ...width, id: 'w2' };
		const diff = diffSchemas(schema({ inputs: [width] }), schema({ inputs: [recreated] }));
		expect(diff.changes.map((c) => c.change)).toEqual(['removed', 'added']);
	});

	it('labels an input by its display name before its nickname', () => {
		const s = schema({ inputs: [width], items: [widthItem({}, { displayName: 'Wall width' })] });
		const t = schema({ inputs: [], items: [] });
		expect(one(s, t).label).toBe('Wall width');
	});

	it('a type or structure change is breaking', () => {
		const t = schema({ inputs: [{ ...width, paramType: 'integer', inputStructure: 'list' }] });
		const change = one(schema({ inputs: [width] }), t);
		expect(change.impact).toBe('breaking');
		expect(change.details).toEqual(['type number → integer', 'takes item → list']);
	});

	it('a new default is notable', () => {
		const change = one(
			schema({ inputs: [width] }),
			schema({ inputs: [{ ...width, default: 12 }] })
		);
		expect(change).toMatchObject({ impact: 'notable', details: ['default 10 → 12'] });
	});

	it('a narrower range is breaking, a wider one notable', () => {
		const base = schema({ inputs: [width], items: [widthItem()] });
		const narrow = schema({ inputs: [width], items: [widthItem({ maximum: 50 })] });
		const wide = schema({ inputs: [width], items: [widthItem({ maximum: 200 })] });
		expect(one(base, narrow)).toMatchObject({
			impact: 'breaking',
			details: ['range 0–100 → 0–50 (narrower)']
		});
		expect(one(base, wide)).toMatchObject({ impact: 'notable', details: ['range 0–100 → 0–200'] });
	});

	it('a removed dropdown option is breaking; an added one notable', () => {
		const wood = { id: 'm', nickname: 'Wood', paramType: 'valueList' };
		const dropdown = (options: Record<string, string>) => ({
			id: 'li-m',
			type: 'input',
			paramId: 'm',
			widgetType: 'dropdown',
			config: { options }
		});
		const a = schema({ inputs: [wood], items: [dropdown({ Oak: '0', Ash: '1' })] });
		const b = schema({ inputs: [wood], items: [dropdown({ Oak: '0', Elm: '2' })] });
		expect(one(a, b)).toMatchObject({
			impact: 'breaking',
			details: ['options removed: Ash', 'options added: Elm']
		});
	});

	it('a moved or relabelled input is cosmetic', () => {
		const a = schema({
			inputs: [width],
			groups: [
				{ label: 'Size', items: [widthItem()] },
				{ label: 'Other', items: [] }
			]
		});
		const b = schema({
			inputs: [width],
			groups: [
				{ label: 'Size', items: [] },
				{ label: 'Other', items: [widthItem({}, { displayName: 'W' })] }
			]
		});
		expect(one(a, b)).toMatchObject({
			impact: 'cosmetic',
			details: ['label none → W', 'moved Size → Other']
		});
	});

	it('a change of who fills an input is breaking', () => {
		const a = schema({ inputs: [width], items: [widthItem()] });
		const b = schema({ inputs: [width], items: [widthItem({}, { source: { kind: 'server' } })] });
		expect(one(a, b)).toMatchObject({ impact: 'breaking', details: ['filled by user → server'] });
	});

	it('removed and retyped outputs are breaking', () => {
		const a = schema({ outputs: [area, { id: 'f', nickname: 'File', type: 'file' }] });
		const b = schema({ outputs: [{ ...area, type: 'text' }] });
		const diff = diffSchemas(a, b);
		expect(diff.counts.breaking).toBe(2);
		expect(diff.changes.map((c) => c.details[0] ?? c.change)).toEqual([
			'removed',
			'type number → text'
		]);
	});

	it('reports solve settings as notable and names as cosmetic', () => {
		const a = schema({});
		const b = schema({ previewSolves: true, name: 'Renamed' });
		const diff = diffSchemas(a, b);
		expect(diff.changes.map((c) => [c.id, c.impact])).toEqual([
			['previewSolves', 'notable'],
			['name', 'cosmetic']
		]);
	});

	it('sorts breaking before notable before cosmetic', () => {
		const a = schema({ inputs: [width], outputs: [area], name: 'A' });
		const b = schema({ inputs: [{ ...width, default: 1 }], outputs: [], name: 'B' });
		expect(diffSchemas(a, b).changes.map((c) => c.impact)).toEqual([
			'breaking',
			'notable',
			'cosmetic'
		]);
	});
});

describe('schemaDiffToMarkdown', () => {
	it('groups changes under headings by impact', () => {
		const a = schema({ inputs: [width], outputs: [area] });
		const b = schema({ inputs: [{ ...width, default: 12 }], outputs: [] });
		expect(schemaDiffToMarkdown(diffSchemas(a, b))).toBe(
			[
				'### Breaking',
				'',
				'- Removed output **Area**',
				'',
				'### Changes',
				'',
				'- Input **Width**: default 10 → 12'
			].join('\n')
		);
	});

	it('is empty when nothing changed', () => {
		expect(schemaDiffToMarkdown(diffSchemas(schema({}), schema({})))).toBe('');
	});
});
