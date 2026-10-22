import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeBuilder, type TreeValueEntry } from '../data-tree';
import { ComputeError, ErrorCodes, setLogger } from '@/core';
import { processInput } from '../../io/input/input-processors';
import type { DataTree, InnerTreeData, InputParam } from '../../types';
import { createInputSchema } from '@tests/helpers/test-data-builders';

// ---------------------------------------------------------------------------
// Helpers — build the InputParam shapes that fetchParsedDefinitionIO produces
// ---------------------------------------------------------------------------

function numericInput(name: string, def: number, opts: Partial<InputParam> = {}): InputParam {
	return {
		name,
		nickname: name,
		description: '',
		groupName: '',
		id: `${name}-id`,
		treeAccess: false,
		paramType: 'Number',
		minimum: undefined,
		maximum: undefined,
		atLeast: 1,
		atMost: 1,
		default: def,
		...opts
	} as InputParam;
}

/** A compiled tree as a solve returns it. Its items carry only `data`, which `DataItem` doesn't model. */
function dataTree(ParamName: string, branches: Record<string, unknown[]>): DataTree {
	return { ParamName, InnerTree: branches as unknown as InnerTreeData };
}

function textInput(name: string, def: string): InputParam {
	return {
		name,
		nickname: name,
		description: '',
		groupName: '',
		id: `${name}-id`,
		treeAccess: false,
		paramType: 'Text',
		default: def
	} as InputParam;
}

// ---------------------------------------------------------------------------

describe('TreeBuilder — basic building', () => {
	it('builds a flat tree at path [0]', () => {
		const tree = new TreeBuilder('MyParam').appendFlat([1, 2, 3, 4, 5]).toComputeFormat();

		expect(tree.ParamName).toBe('MyParam');
		expect(tree.InnerTree).toEqual({
			'{0}': [{ data: 1 }, { data: 2 }, { data: 3 }, { data: 4 }, { data: 5 }]
		});
	});

	it('builds a multi-branch tree with nested paths', () => {
		const tree = new TreeBuilder('Points')
			.append([0], [{ x: 0, y: 0, z: 0 }])
			.append([0, 1], [{ x: 1, y: 1, z: 1 }])
			.append([1], [{ x: 2, y: 2, z: 2 }])
			.toComputeFormat();

		expect(Object.keys(tree.InnerTree)).toEqual(['{0}', '{0;1}', '{1}']);
		// Object values are JSON-stringified by serializeValue
		expect(tree.InnerTree['{0}']).toEqual([{ data: '{"x":0,"y":0,"z":0}' }]);
	});

	it('preserves booleans and numbers as primitives (Grasshopper depends on this)', () => {
		const tree = new TreeBuilder('Mixed').appendFlat([true, 42, 'hello']).toComputeFormat();
		const items = tree.InnerTree['{0}'];
		expect(items[0].data).toBe(true);
		expect(items[1].data).toBe(42);
		expect(items[2].data).toBe('hello');
	});

	it('appendFlat with a single (non-array) value still wraps to path [0]', () => {
		const tree = new TreeBuilder('Single').appendFlat(7).toComputeFormat();
		expect(tree.InnerTree).toEqual({ '{0}': [{ data: 7 }] });
	});

	it('fromDataTreeDefault loads an existing branch structure', () => {
		const tree = new TreeBuilder('Values').fromDataTreeDefault({
			'{0}': [1, 2, 3],
			'{0;0}': [4, 5],
			'{1}': [6, 7, 8]
		});

		expect(Object.keys(tree.toComputeFormat().InnerTree)).toEqual(['{0}', '{0;0}', '{1}']);
		expect(tree.toComputeFormat().InnerTree['{0;0}']).toEqual([{ data: 4 }, { data: 5 }]);
		expect(tree.flatten()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});
});

describe('TreeBuilder.fromInputParams — definition IO -> trees', () => {
	it('skips inputs whose default is undefined/null/empty', () => {
		const inputs: InputParam[] = [
			numericInput('keep', 5),
			{ ...numericInput('drop1', 0), default: undefined } as InputParam,
			{ ...numericInput('drop2', 0), default: null } as InputParam,
			{ ...numericInput('drop3', 0), default: [] } as InputParam
		];

		const trees = TreeBuilder.fromInputParams(inputs);
		expect(trees).toHaveLength(1);
		expect(trees[0].ParamName).toBe('keep');
	});

	it('clamps numeric defaults to min/max constraints', () => {
		const inputs: InputParam[] = [
			numericInput('over', 200, { minimum: 0, maximum: 100 }),
			numericInput('under', -5, { minimum: 0, maximum: 100 }),
			numericInput('inside', 50, { minimum: 0, maximum: 100 })
		];

		const trees = TreeBuilder.fromInputParams(inputs);
		expect(trees[0].InnerTree['{0}'][0].data).toBe(100);
		expect(trees[1].InnerTree['{0}'][0].data).toBe(0);
		expect(trees[2].InnerTree['{0}'][0].data).toBe(50);
	});

	it('keeps text values as-is (no clamping)', () => {
		const trees = TreeBuilder.fromInputParams([textInput('label', 'hello')]);
		expect(trees[0].InnerTree['{0}'][0].data).toBe('hello');
	});

	it('expands tree-access inputs whose default is a DataTreeDefault', () => {
		const input = numericInput('grid', 0, {
			treeAccess: true,
			default: { '{0}': [1, 2], '{1}': [3, 4] }
		});

		const trees = TreeBuilder.fromInputParams([input]);
		expect(Object.keys(trees[0].InnerTree)).toEqual(['{0}', '{1}']);
		expect(trees[0].InnerTree['{0}']).toEqual([{ data: 1 }, { data: 2 }]);
	});

	it('expands a list-access default end to end instead of sending it as one JSON string', () => {
		const input = processInput(
			createInputSchema({
				name: 'pts',
				nickname: 'pts',
				paramType: 'Number',
				treeAccess: false,
				atLeast: 1,
				atMost: 2147483647,
				default: {
					InnerTree: {
						'{0}': [
							{ type: 'System.Double', data: '1' },
							{ type: 'System.Double', data: '2' }
						]
					}
				}
			})
		);

		const trees = TreeBuilder.fromInputParams([input]);
		expect(trees[0].InnerTree).toEqual({ '{0}': [{ data: 1 }, { data: 2 }] });
	});
});

// ---------------------------------------------------------------------------
// replaceTreeValue
// ---------------------------------------------------------------------------

describe('TreeBuilder.replaceTreeValue', () => {
	it('replaces an existing parameter in compiled InnerTree array', () => {
		const trees = [
			dataTree('X', { '{0}': [{ data: 1 }] }),
			dataTree('Y', { '{0}': [{ data: 2 }] })
		];

		const updated = TreeBuilder.replaceTreeValue(trees, 'X', 42);

		expect(updated).toHaveLength(2);
		expect(updated[0].ParamName).toBe('X');
		expect(updated[0].InnerTree['{0}']).toEqual([{ data: 42 }]);
		// Y untouched
		expect(updated[1].InnerTree['{0}']).toEqual([{ data: 2 }]);
	});

	it('appends a new DataTree when paramName not found', () => {
		const trees = [dataTree('X', { '{0}': [{ data: 1 }] })];

		const updated = TreeBuilder.replaceTreeValue(trees, 'Y', [10, 20]);

		expect(updated).toHaveLength(2);
		expect(updated[1].ParamName).toBe('Y');
		expect(updated[1].InnerTree['{0}']).toEqual([{ data: 10 }, { data: 20 }]);
	});

	it('writes a branch-path map as branches', () => {
		const updated = TreeBuilder.replaceTreeValue([], 'Grid', { '{0}': [1, 2], '{1}': [3] });

		expect(updated[0].InnerTree).toEqual({
			'{0}': [{ data: 1 }, { data: 2 }],
			'{1}': [{ data: 3 }]
		});
	});

	it('matches a camelCase paramName instead of appending a duplicate', () => {
		const trees = [{ paramName: 'X', innerTree: { '{0}': [{ data: 1 }] } } as unknown as DataTree];

		const updated = TreeBuilder.replaceTreeValue(trees, 'X', 42);

		expect(updated).toHaveLength(1);
		expect(updated[0].InnerTree['{0}']).toEqual([{ data: 42 }]);
	});

	it('returns a new array and leaves the caller array untouched', () => {
		// Pristine defaults from fromInputParams must survive slider updates.
		const original = [dataTree('X', { '{0}': [{ data: 1 }] })];

		const replaced = TreeBuilder.replaceTreeValue(original, 'X', 42);
		const appended = TreeBuilder.replaceTreeValue(original, 'Y', 2);

		expect(replaced).not.toBe(original);
		expect(appended).not.toBe(original);
		expect(original).toHaveLength(1);
		expect(original[0].InnerTree['{0}']).toEqual([{ data: 1 }]);
	});

	it('adds to an empty array', () => {
		const updated = TreeBuilder.replaceTreeValue([], 'New', 5);

		expect(updated).toHaveLength(1);
		expect(updated[0].ParamName).toBe('New');
		expect(updated[0].InnerTree['{0}']).toEqual([{ data: 5 }]);
	});
});

// ---------------------------------------------------------------------------
// getTree / getTreeValue
// ---------------------------------------------------------------------------

describe('TreeBuilder.getTree', () => {
	it('returns every branch keyed by path, deserializing each item', () => {
		const trees = [
			dataTree('Grid', {
				'{0;0}': [{ data: '1' }, { data: '2' }],
				'{0;1}': [{ data: '{"x":1}' }],
				'{1}': []
			})
		];

		const tree = TreeBuilder.getTree(trees, 'Grid');

		expect(tree).toEqual(
			new Map<string, unknown[]>([
				['{0;0}', [1, 2]],
				['{0;1}', [{ x: 1 }]],
				['{1}', []]
			])
		);
	});

	it('returns null for a missing param', () => {
		expect(TreeBuilder.getTree([dataTree('X', { '{0}': [{ data: 1 }] })], 'Y')).toBeNull();
	});

	it('returns an empty Map for a param with no branches', () => {
		expect(TreeBuilder.getTree([dataTree('Empty', {})], 'Empty')).toEqual(new Map());
	});

	it('reads ParamName and InnerTree in any casing', () => {
		const trees = [
			{ paramName: 'Camel', innerTree: { '{0}': [{ data: 7 }] } },
			{ PARAMNAME: 'Upper', INNERTREE: { '{0}': [{ data: 8 }] } }
		] as unknown as DataTree[];

		expect(TreeBuilder.getTree(trees, 'Camel')).toEqual(new Map([['{0}', [7]]]));
		expect(TreeBuilder.getTree(trees, 'Upper')).toEqual(new Map([['{0}', [8]]]));
	});

	it('maps an item without data to null in place', () => {
		const trees = [dataTree('Holey', { '{0}': [{ data: 1 }, {}, { data: null }] })];
		expect(TreeBuilder.getTree(trees, 'Holey')?.get('{0}')).toEqual([1, null, null]);
	});
});

describe('TreeBuilder.getTreeValue', () => {
	it('unwraps a single value', () => {
		const trees = [dataTree('X', { '{0}': [{ data: 42 }] })];
		expect(TreeBuilder.getTreeValue(trees, 'X')).toBe(42);
	});

	it('returns array for multiple values, deserializing each', () => {
		const trees = [dataTree('Pts', { '{0}': [{ data: '1' }, { data: '2' }, { data: '3' }] })];
		expect(TreeBuilder.getTreeValue(trees, 'Pts')).toEqual([1, 2, 3]);
	});

	it('returns null when paramName missing', () => {
		const trees = [dataTree('X', { '{0}': [{ data: 1 }] })];
		expect(TreeBuilder.getTreeValue(trees, 'Missing')).toBeNull();
	});

	it('returns null when InnerTree has no branches', () => {
		expect(TreeBuilder.getTreeValue([dataTree('Empty', {})], 'Empty')).toBeNull();
	});

	it('returns null when the one branch is empty', () => {
		expect(TreeBuilder.getTreeValue([dataTree('Empty', { '{0}': [] })], 'Empty')).toBeNull();
	});

	it('throws INVALID_INPUT naming getTree when the param has several branches', () => {
		const trees = [dataTree('X', { '{0}': [{ data: 100 }], '{1}': [{ data: 200 }] })];

		let caught: unknown;
		try {
			TreeBuilder.getTreeValue(trees, 'X');
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(ComputeError);
		expect((caught as ComputeError).code).toBe(ErrorCodes.INVALID_INPUT);
		expect((caught as ComputeError).message).toContain('getTree');
	});

	it('reads a camelCase tree', () => {
		const trees = [
			{ paramName: 'X', innerTree: { '{0}': [{ data: 5 }] } }
		] as unknown as DataTree[];
		expect(TreeBuilder.getTreeValue(trees, 'X')).toBe(5);
	});

	it('deserializes JSON-encoded objects', () => {
		const trees = [dataTree('P', { '{0}': [{ data: '{"x":1,"y":2}' }] })];
		expect(TreeBuilder.getTreeValue(trees, 'P')).toEqual({ x: 1, y: 2 });
	});

	it('preserves legitimate null items without shifting indices', () => {
		const trees = [dataTree('WithNulls', { '{0}': [{ data: 1 }, { data: null }, { data: 3 }] })];
		expect(TreeBuilder.getTreeValue(trees, 'WithNulls')).toEqual([1, null, 3]);
	});

	it('maps items missing a data field to null in place (no index shift)', () => {
		const trees = [dataTree('Holey', { '{0}': [{ data: 1 }, {}, { data: 3 }] })];
		expect(TreeBuilder.getTreeValue(trees, 'Holey')).toEqual([1, null, 3]);
	});

	it('an all-null branch reads as nulls, not "param not found"', () => {
		const trees = [dataTree('AllNull', { '{0}': [{ data: null }, { data: null }] })];
		expect(TreeBuilder.getTreeValue(trees, 'AllNull')).toEqual([null, null]);
	});

	it('keeps an empty string a string (not numeric 0)', () => {
		// Number('') === 0, so a plain numeric check would turn '' into 0.
		expect(TreeBuilder.getTreeValue([dataTree('S', { '{0}': [{ data: '' }] })], 'S')).toBe('');
	});

	it('keeps a whitespace-only string a string', () => {
		expect(TreeBuilder.getTreeValue([dataTree('S', { '{0}': [{ data: '  ' }] })], 'S')).toBe('  ');
	});

	it('keeps non-canonical numeric-looking strings as strings', () => {
		// A string on the wire stays a string unless it is the canonical form of a finite number.
		const strings = ['007', '1e5', 'Infinity', '-Infinity', ' 5'];
		const trees = [dataTree('S', { '{0}': strings.map((data) => ({ data })) })];
		expect(TreeBuilder.getTreeValue(trees, 'S')).toEqual(strings);
	});

	it('still round-trips canonical numeric strings to numbers', () => {
		const trees = [
			dataTree('N', { '{0}': ['42', '3.14', '-7', '1e+21'].map((data) => ({ data })) })
		];
		expect(TreeBuilder.getTreeValue(trees, 'N')).toEqual([42, 3.14, -7, 1e21]);
	});
});

// ---------------------------------------------------------------------------
// fromValues
// ---------------------------------------------------------------------------

describe('TreeBuilder.fromValues', () => {
	const warn = vi.fn();

	beforeEach(() => {
		warn.mockClear();
		setLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() });
	});

	afterEach(() => setLogger(null));

	function entry(partial: Partial<TreeValueEntry>): TreeValueEntry {
		return { paramName: 'P', paramType: 'Number', value: undefined, ...partial };
	}

	function only(entries: Partial<TreeValueEntry>[]) {
		const trees = TreeBuilder.fromValues(entries.map(entry));
		expect(trees).toHaveLength(1);
		return trees[0].InnerTree;
	}

	it('puts a scalar on branch {0}', () => {
		expect(only([{ value: 5 }])).toEqual({ '{0}': [{ data: 5 }] });
	});

	it('puts an array on branch {0}', () => {
		expect(only([{ value: [1, 2, 3] }])).toEqual({
			'{0}': [{ data: 1 }, { data: 2 }, { data: 3 }]
		});
	});

	it('keeps a branch-path map as branches', () => {
		expect(only([{ value: { '{0;0}': [1, 2], '{0;1}': [3] } }])).toEqual({
			'{0;0}': [{ data: 1 }, { data: 2 }],
			'{0;1}': [{ data: 3 }]
		});
	});

	it('keeps entry order and names each tree by paramName', () => {
		const trees = TreeBuilder.fromValues([
			entry({ paramName: 'A', value: 1 }),
			entry({ paramName: 'B', value: 2 })
		]);
		expect(trees.map((t) => t.ParamName)).toEqual(['A', 'B']);
	});

	it('coerces numeric strings for Number', () => {
		expect(only([{ value: ['1.5', ' 2 '] }])).toEqual({ '{0}': [{ data: 1.5 }, { data: 2 }] });
	});

	it('drops a Number item the numeric coercion rejects, with a warning', () => {
		expect(only([{ value: [1, 'abc', Infinity, '0x10', 2] }])).toEqual({
			'{0}': [{ data: 1 }, { data: 2 }]
		});
		expect(warn).toHaveBeenCalledTimes(3);
		expect(warn.mock.calls[0][0]).toContain('P');
	});

	it('rounds Integer items', () => {
		expect(only([{ paramType: 'Integer', value: [1.4, 1.6, '2.5'] }])).toEqual({
			'{0}': [{ data: 1 }, { data: 2 }, { data: 3 }]
		});
	});

	it('clamps Number and Integer items to minimum and maximum', () => {
		expect(only([{ value: [-5, 50, 500], minimum: 0, maximum: 100 }])).toEqual({
			'{0}': [{ data: 0 }, { data: 50 }, { data: 100 }]
		});
		expect(
			only([{ paramType: 'Integer', value: { '{1}': [11.6] }, minimum: 0, maximum: 10 }])
		).toEqual({ '{1}': [{ data: 10 }] });
	});

	it('ignores null bounds', () => {
		expect(only([{ value: -5, minimum: null, maximum: null }])).toEqual({
			'{0}': [{ data: -5 }]
		});
	});

	it('coerces Boolean items, keeping an explicit false', () => {
		expect(only([{ paramType: 'Boolean', value: [false, 'TRUE', ' false '] }])).toEqual({
			'{0}': [{ data: false }, { data: true }, { data: false }]
		});
	});

	it('drops a Boolean item the boolean coercion rejects, with a warning', () => {
		expect(only([{ paramType: 'Boolean', value: [true, 'yes', 1] }])).toEqual({
			'{0}': [{ data: true }]
		});
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('matches paramType case-insensitively', () => {
		expect(only([{ paramType: 'number', value: '3' }])).toEqual({ '{0}': [{ data: 3 }] });
		expect(only([{ paramType: 'INTEGER', value: 2.7 }])).toEqual({ '{0}': [{ data: 3 }] });
		expect(only([{ paramType: 'boolean', value: 'true' }])).toEqual({ '{0}': [{ data: true }] });
	});

	it.each([
		['Text', 'hello'],
		['ValueList', '1'],
		['valueList', '1'],
		['dynamicValueList', '3.5'],
		['Color', '255,0,0'],
		['generic', 'd'],
		['SomethingNew', 'x']
	])('passes a %s value through unchanged', (paramType, value) => {
		expect(only([{ paramType, value }])).toEqual({ '{0}': [{ data: value }] });
		expect(warn).not.toHaveBeenCalled();
	});

	it('passes a numeric-looking string through for a non-numeric type', () => {
		expect(only([{ paramType: 'Text', value: '007' }])).toEqual({ '{0}': [{ data: '007' }] });
	});

	it('passes a dynamicValueList checklist through as one branch', () => {
		expect(only([{ paramType: 'dynamicValueList', value: ['a', 'b'] }])).toEqual({
			'{0}': [{ data: 'a' }, { data: 'b' }]
		});
	});

	it('serializes an object value (File) as JSON', () => {
		expect(only([{ paramType: 'File', value: { fileName: 'a.3dm' } }])).toEqual({
			'{0}': [{ data: '{"fileName":"a.3dm"}' }]
		});
	});

	it('keeps an empty string', () => {
		expect(only([{ paramType: 'Text', value: '' }])).toEqual({ '{0}': [{ data: '' }] });
	});

	it.each([
		['undefined', undefined],
		['null', null],
		['an empty array', []],
		['an empty object', {}]
	])('omits an entry whose value is %s', (_label, value) => {
		expect(TreeBuilder.fromValues([entry({ paramType: 'Text', value })])).toEqual([]);
	});

	it('omits an entry whose every item is rejected', () => {
		expect(TreeBuilder.fromValues([entry({ value: ['abc', 'def'] })])).toEqual([]);
	});

	it('drops null items without a warning', () => {
		expect(only([{ value: [1, null, undefined, 2] }])).toEqual({
			'{0}': [{ data: 1 }, { data: 2 }]
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it('omits an empty branch of a branch-path map but keeps the rest', () => {
		expect(only([{ value: { '{0}': [], '{1}': ['abc'], '{2}': [4] } }])).toEqual({
			'{2}': [{ data: 4 }]
		});
	});
});

// ---------------------------------------------------------------------------
// End-to-end: the slider scrub flow
// ---------------------------------------------------------------------------

describe('TreeBuilder — slider scrub end-to-end flow', () => {
	it('build trees from inputs, override one value, read it back', () => {
		const inputs: InputParam[] = [
			numericInput('radius', 10, { minimum: 0, maximum: 100 }),
			numericInput('height', 20, { minimum: 0, maximum: 50 })
		];

		const trees = TreeBuilder.fromInputParams(inputs);
		expect(trees).toHaveLength(2);

		// Simulate slider moving radius to 75
		const updated = TreeBuilder.replaceTreeValue(trees, 'radius', 75);

		expect(TreeBuilder.getTreeValue(updated, 'radius')).toBe(75);
		expect(TreeBuilder.getTreeValue(updated, 'height')).toBe(20);
	});
});

// ---------------------------------------------------------------------------
// Path string round-trip
// ---------------------------------------------------------------------------

describe('TreeBuilder — path string parsing', () => {
	it('round-trips simple and nested paths', () => {
		expect(TreeBuilder.formatPathString([0])).toBe('{0}');
		expect(TreeBuilder.formatPathString([0, 1, 2])).toBe('{0;1;2}');
		expect(TreeBuilder.parsePathString('{0}')).toEqual([0]);
		expect(TreeBuilder.parsePathString('{0;1;2}')).toEqual([0, 1, 2]);
	});

	it('treats the root path "{}" as []', () => {
		expect(TreeBuilder.parsePathString('{}')).toEqual([]);
	});

	it('round-trips negative indices (GH_Path allows them)', () => {
		expect(TreeBuilder.formatPathString([-1])).toBe('{-1}');
		expect(TreeBuilder.formatPathString([-1, 2, -3])).toBe('{-1;2;-3}');
		expect(TreeBuilder.parsePathString('{-1}')).toEqual([-1]);
		expect(TreeBuilder.parsePathString('{-1;2;-3}')).toEqual([-1, 2, -3]);
	});

	it('throws a descriptive error on malformed paths (no silent [0] fallback)', () => {
		expect(() => TreeBuilder.parsePathString('garbage')).toThrow(
			/Invalid Grasshopper tree path.*garbage/
		);
		expect(() => TreeBuilder.parsePathString('{abc}')).toThrow(/Invalid Grasshopper tree path/);
	});

	it('throws on empty path segments instead of producing phantom zeros', () => {
		// `{0;}`.split(';').map(Number) would be [0, 0] — these must throw.
		expect(() => TreeBuilder.parsePathString('{0;}')).toThrow(/Invalid Grasshopper tree path/);
		expect(() => TreeBuilder.parsePathString('{;}')).toThrow(/Invalid Grasshopper tree path/);
		expect(() => TreeBuilder.parsePathString('{0;;1}')).toThrow(/Invalid Grasshopper tree path/);
	});

	it('keeps negative-index branches apart instead of merging them', () => {
		const tree = new TreeBuilder('Neg').fromDataTreeDefault({
			'{-1}': [10, 11],
			'{-2}': [20]
		});

		expect(tree.toComputeFormat().InnerTree).toEqual({
			'{-1}': [{ data: 10 }, { data: 11 }],
			'{-2}': [{ data: 20 }]
		});
	});

	it('fromDataTreeDefault throws on a genuinely unparseable key rather than corrupting topology', () => {
		expect(() =>
			new TreeBuilder('Bad').fromDataTreeDefault({ '{oops}': [1], '{nope}': [2] })
		).toThrow(/Invalid Grasshopper tree path/);
	});
});
