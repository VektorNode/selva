import { describe, it, expect } from 'vitest';
import type { DataTree } from '@selvajs/compute/grasshopper';
import { buildSolveInputTree } from '../transform-input.js';
import type { SchemaInput } from '@selvajs/schemas';

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
		expect(itemsOf({ paramType: 'text', default: 'd' })).toEqual(['d']);
		expect(itemsOf({ paramType: 'boolean', default: true })).toEqual([true]);
	});

	it('omits an input with neither value nor default, so Grasshopper uses its own', () => {
		expect(itemsOf({ paramType: 'text', default: undefined })).toBeUndefined();
		expect(itemsOf({ paramType: 'boolean', default: undefined })).toBeUndefined();
	});

	it('keeps an explicit false over a true default', () => {
		expect(itemsOf({ paramType: 'boolean', default: true }, false)).toEqual([false]);
	});

	it('clamps a number to its minimum and maximum', () => {
		expect(itemsOf({ paramType: 'number', minimum: 0, maximum: 10 }, 50)).toEqual([10]);
	});

	it('rounds an integer', () => {
		expect(itemsOf({ paramType: 'integer' }, 4.6)).toEqual([5]);
	});

	it('drops a number item that is not a number', () => {
		expect(itemsOf({ paramType: 'number' }, [1, 'abc', 2])).toEqual([1, 2]);
		expect(itemsOf({ paramType: 'number' }, 'abc')).toBeUndefined();
	});

	it('carries a valueList selection', () => {
		expect(itemsOf({ paramType: 'valueList', default: '0' }, '1')).toEqual(['1']);
	});

	it('carries a dynamicValueList selection, scalar or checklist', () => {
		expect(itemsOf({ paramType: 'dynamicValueList', default: '0' }, '3.5')).toEqual(['3.5']);
		expect(itemsOf({ paramType: 'dynamicValueList' }, ['a', 'b'])).toEqual(['a', 'b']);
	});

	it('carries a color', () => {
		expect(itemsOf({ paramType: 'color' }, '255,0,0')).toEqual(['255,0,0']);
	});

	it('carries a file as JSON', () => {
		expect(itemsOf({ paramType: 'file' }, { fileName: 'a.3dm' })).toEqual(['{"fileName":"a.3dm"}']);
	});

	it('carries a generic default to the tree', () => {
		expect(itemsOf({ paramType: 'generic', default: 'd' })).toEqual(['d']);
	});

	it('keeps a branch-path value as branches', () => {
		const [tree] = buildSolveInputTree([input({ paramType: 'number' })], {
			'id-1': { '{0;0}': [1], '{0;1}': [2] }
		});
		expect(tree.InnerTree).toEqual({ '{0;0}': [{ data: 1 }], '{0;1}': [{ data: 2 }] });
	});
});
