import { describe, it, expect } from 'vitest';
import type { DataTree } from '@selvajs/compute/grasshopper';
import type { SchemaInput, UISchema } from '@selvajs/schemas';
import { buildSolveInputTree, solveInputsFromSchema } from '../transform-input.js';

type Input = SchemaInput & { minimum?: number; maximum?: number };

function input(partial: Partial<Input>): Input {
	return { id: 'id-1', nickname: 'Param', paramType: 'text', ...partial } as Input;
}

/** The items of the one tree built from `input` and `value`, or `undefined` when it was omitted. */
function itemsOf(partial: Partial<Input>, value?: unknown): unknown[] | undefined {
	const trees = buildSolveInputTree([input(partial)], value === undefined ? {} : { 'id-1': value });
	expect(trees.length).toBeLessThanOrEqual(1);
	return trees[0]?.InnerTree['{0}']?.map((item) => item.data);
}

describe('buildSolveInputTree', () => {
	it('names each tree by the input nickname', () => {
		const trees: DataTree[] = buildSolveInputTree(
			[input({ id: 'a', nickname: 'Width' }), input({ id: 'b', nickname: 'Label' })],
			{ a: 'x', b: 'y' }
		);
		expect(trees.map((t) => t.ParamName)).toEqual(['Width', 'Label']);
	});

	it('skips an input without a paramType', () => {
		expect(buildSolveInputTree([input({ paramType: undefined })], { 'id-1': 'v' })).toEqual([]);
	});

	it('lets the value win over the schema default', () => {
		expect(itemsOf({ paramType: 'number', default: 1, minimum: 0, maximum: 10 }, 7)).toEqual([7]);
	});

	it('falls back to the schema default when no value is supplied', () => {
		expect(itemsOf({ paramType: 'number', default: 3 })).toEqual([3]);
	});

	it('keeps an explicit false over a true default', () => {
		expect(itemsOf({ paramType: 'boolean', default: true }, false)).toEqual([false]);
	});

	it('clamps a number to its minimum and maximum', () => {
		expect(itemsOf({ paramType: 'number', minimum: 0, maximum: 10 }, 50)).toEqual([10]);
	});

	it('reads only the values map itself, not what it inherits', () => {
		const [tree] = buildSolveInputTree(
			[input({ id: 'constructor', paramType: 'text', default: 'd' })],
			{}
		);
		expect(tree.InnerTree['{0}'].map((item) => item.data)).toEqual(['d']);
	});
});

describe('solveInputsFromSchema', () => {
	function schema(items: unknown[], inputs: Input[]): UISchema {
		return {
			inputs,
			outputs: [],
			layout: { type: 'flat', groups: [{ items }] }
		} as unknown as UISchema;
	}

	const number = (id: string, config?: Record<string, unknown>) => ({
		type: 'input',
		widgetType: 'number',
		paramId: id,
		...(config ? { config } : {})
	});

	it('adds the bounds a number widget declares, which `schema.inputs` does not carry', () => {
		const inputs = solveInputsFromSchema(
			schema([number('w', { minimum: 1, maximum: 100 })], [input({ id: 'w', paramType: 'number' })])
		);
		expect(inputs[0]).toMatchObject({ id: 'w', minimum: 1, maximum: 100 });
	});

	it('so a forged value clamps', () => {
		const inputs = solveInputsFromSchema(
			schema([number('w', { maximum: 100 })], [input({ id: 'w', paramType: 'number' })])
		);
		const [tree] = buildSolveInputTree(inputs, { w: 1e9 });
		expect(tree.InnerTree['{0}'][0].data).toBe(100);
	});

	it('leaves an input without a number widget as it was', () => {
		const text = input({ id: 't' });
		const inputs = solveInputsFromSchema(
			schema([{ type: 'input', widgetType: 'text', paramId: 't', config: { minimum: 1 } }], [text])
		);
		expect(inputs[0]).toBe(text);
	});

	it('ignores layout items that are not inputs', () => {
		const a = input({ id: 'a' });
		expect(solveInputsFromSchema(schema([{ type: 'output', paramId: 'a' }], [a]))).toEqual([a]);
	});
});
