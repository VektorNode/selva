import { describe, expect, it, vi } from 'vitest';
import { getValues, getValue, extractFileData } from '@/grasshopper/io/output/response-processors';
import type { RhinoRuntime } from '@/grasshopper/io/output/rhino-decoder';
import { disposeRhinoObjects } from '@/grasshopper/io/output/rhino-objects';
import type { DataItem, GrasshopperComputeResponse } from '@/grasshopper/types';

// --- local builders ---------------------------------------------------------

function item(type: string, data: string, id = ''): DataItem {
	return { type, data, id };
}

/** One parameter with a single `{0}` branch holding the given items. */
function param(paramName: string, items: DataItem[], branch = '{0}') {
	return { ParamName: paramName, InnerTree: { [branch]: items } };
}

function response(...params: ReturnType<typeof param>[]): GrasshopperComputeResponse {
	return { values: params } as unknown as GrasshopperComputeResponse;
}

// --- decode by system type ---------------------------------------------------

describe('getValues — system type decoding', () => {
	it.each([
		['System.Int32', '42', 42],
		['System.Double', '3.14', 3.14],
		['System.Boolean', 'True', true],
		['System.String', '"hello"', 'hello'],
		// parseValues default true → tryDecodeJSON parses it; no rhino → the parsed object.
		['Rhino.Geometry.Point3d', '{"X":1,"Y":2,"Z":3}', { X: 1, Y: 2, Z: 3 }]
	])('decodes %s %s', (type, data, expected) => {
		const res = response(param('v', [item(type, data)]));
		expect(getValues(res).values.v).toEqual(expected);
	});
});

// --- tryDecodeJSON double-parse ---------------------------------------------

describe('getValues — parseValues / JSON decoding', () => {
	it('parses a JSON object string into an object', () => {
		const res = response(param('o', [item('SomeType', '{"a":1}')]));
		expect(getValues(res).values.o).toEqual({ a: 1 });
	});

	it('double-parses a JSON-stringified-JSON string', () => {
		// outer parse yields a string, which is itself JSON → inner parse
		const res = response(param('o', [item('SomeType', JSON.stringify('{"a":1}'))]));
		expect(getValues(res).values.o).toEqual({ a: 1 });
	});

	it('with parseValues:false, does not JSON-decode (String type still unquoted)', () => {
		const res = response(param('o', [item('System.String', '{"a":1}')]));
		expect(getValues(res, false, { parseValues: false }).values.o).toEqual('{"a":1}');
	});

	it('leaves a non-JSON-looking string as-is', () => {
		const res = response(param('s', [item('System.String', 'plain text')]));
		expect(getValues(res).values.s).toBe('plain text');
	});
});

// --- aggregation & keys ------------------------------------------------------

describe('getValues — aggregation and keys', () => {
	it('aggregates multiple items under one ParamName into an array', () => {
		const res = response(
			param('nums', [
				item('System.Int32', '1'),
				item('System.Int32', '2'),
				item('System.Int32', '3')
			])
		);
		expect(getValues(res).values.nums).toEqual([1, 2, 3]);
	});

	it('wraps (not merges) when the first item itself parses to an array', () => {
		// Not [1,2,3,[4]]: a parsed array value must not be mistaken for the aggregate.
		const res = response(
			param('lists', [item('System.String', '[1,2,3]'), item('System.String', '[4]')])
		);
		expect(getValues(res).values.lists).toEqual([[1, 2, 3], [4]]);
	});

	it('keeps a single item as a scalar (not a 1-element array)', () => {
		const res = response(param('n', [item('System.Int32', '7')]));
		expect(getValues(res).values.n).toBe(7);
	});

	it('keys by item id when byId is true', () => {
		const res = response(param('ignored', [item('System.Int32', '9', 'item-id-1')]));
		const values = getValues(res, true).values;
		expect(values['item-id-1']).toBe(9);
		expect(values.ignored).toBeUndefined();
	});

	it('skips items with no key', () => {
		// byId with empty id → no key → skipped
		const res = response(param('p', [item('System.Int32', '1', '')]));
		expect(getValues(res, true).values).toEqual({});
	});
});

// --- filters -----------------------------------------------------------------

describe('getValues — filtering', () => {
	it('excludes WebDisplay-typed items entirely', () => {
		const res = response(
			param('mixed', [item('System.Int32', '1'), item('WebDisplay', 'whatever')])
		);
		// only the int survives, and as a scalar
		expect(getValues(res).values.mixed).toBe(1);
	});

	it('stringOnly keeps only System.String items', () => {
		const res = response(param('a', [item('System.String', '"keep"'), item('System.Int32', '5')]));
		// only the string survives, as a scalar
		expect(getValues(res, false, { stringOnly: true }).values.a).toBe('keep');
	});
});

// --- getValue ----------------------------------------------------------------

describe('getValue', () => {
	it('returns an array byName when the param has multiple items', () => {
		const res = response(param('xs', [item('System.Int32', '1'), item('System.Int32', '2')]));
		expect(getValue(res, { byName: 'xs' })).toEqual([1, 2]);
	});

	it.each([[{ byName: 'missing' }], [{ byId: 'nope' }]])('returns undefined for %j', (selector) => {
		const res = response(param('a', [item('System.Int32', '1', 'id-a')]));
		expect(getValue(res, selector)).toBeUndefined();
	});

	it('returns the matching item byId', () => {
		const res = response(
			param('p', [item('System.Int32', '1', 'id-a'), item('System.Int32', '2', 'id-b')])
		);
		expect(getValue(res, { byId: 'id-b' })).toBe(2);
	});
});

// --- missing / alternate-cased fields -----------------------------------------

describe('resilience to missing or alternate-cased response fields', () => {
	it('skips params with no InnerTree instead of throwing (warnings-only partial success)', () => {
		// This is exactly what client.solve returns on a warnings-only partial
		// success: a param that produced nothing ships without InnerTree.
		const res = {
			values: [{ ParamName: 'out' }, param('ok', [item('System.Int32', '1')])],
			warnings: ['some component warned'],
			errors: []
		} as unknown as GrasshopperComputeResponse;

		expect(() => getValues(res)).not.toThrow();
		expect(getValues(res).values).toEqual({ ok: 1 });
		expect(() => getValue(res, { byName: 'out' })).not.toThrow();
		expect(getValue(res, { byName: 'out' })).toBeUndefined();
		expect(() => extractFileData(res)).not.toThrow();
		expect(extractFileData(res)).toEqual([]);
	});

	it('reads camelCase fields, and tolerates a null InnerTree or no values array', () => {
		const res = {
			values: [{ paramName: 'n', innerTree: { '{0}': [item('System.Int32', '7')] } }]
		} as unknown as GrasshopperComputeResponse;

		expect(getValues(res).values.n).toBe(7);
		expect(getValue(res, { byName: 'n' })).toBe(7);

		const nullTree = {
			values: [{ ParamName: 'x', InnerTree: null }]
		} as unknown as GrasshopperComputeResponse;
		expect(getValues(nullTree).values).toEqual({});
		expect(getValue(nullTree, { byName: 'x' })).toBeUndefined();

		const noValues = { warnings: ['w'] } as unknown as GrasshopperComputeResponse;
		expect(getValues(noValues).values).toEqual({});
		expect(getValue(noValues, { byName: 'x' })).toBeUndefined();
		expect(extractFileData(noValues)).toEqual([]);
	});

	it('skips null items and items without a type instead of throwing', () => {
		const res = {
			values: [
				{
					ParamName: 'p',
					InnerTree: { '{0}': [null, { data: 'no-type', id: '' }, item('System.Int32', '2')] }
				}
			]
		} as unknown as GrasshopperComputeResponse;

		expect(() => getValues(res)).not.toThrow();
		// The typeless item still yields its raw data; the int decodes.
		expect(getValues(res).values.p).toEqual(['no-type', 2]);
	});
});

// --- repeated reads -----------------------------------------------------------

describe('repeated reads of one response', () => {
	it('return fresh objects, so mutating one read leaves the next untouched', () => {
		const res = response(param('o', [item('SomeType', '{"a":1}')]));

		const first = getValues(res).values.o;
		first.a = 2;

		expect(getValues(res).values.o).toEqual({ a: 1 });
		expect(getValue(res, { byName: 'o' })).toEqual({ a: 1 });
		expect(getValue(res, { byName: 'o' })).not.toBe(getValue(res, { byName: 'o' }));
	});
});

// --- extractFileData ---------------------------------------------------------

describe('extractFileData', () => {
	const validFile = {
		fileName: 'out.txt',
		fileType: 'txt',
		data: 'aGk=',
		isBase64Encoded: true,
		subFolder: 'results'
	};

	it('extracts well-formed FileData items', () => {
		const res = response(param('files', [item('FileData', JSON.stringify(validFile))]));
		expect(extractFileData(res)).toEqual([validFile]);
	});

	it('ignores FileData items that fail the shape guard', () => {
		const res = response(param('files', [item('FileData', JSON.stringify({ fileName: 'x' }))]));
		expect(extractFileData(res)).toEqual([]);
	});

	it('ignores non-FileData items', () => {
		const res = response(param('n', [item('System.Int32', '1')]));
		expect(extractFileData(res)).toEqual([]);
	});

	// mcneel-branch servers serialize these PascalCase, with `Id`/`Metadata` alongside.
	it('extracts PascalCase FileData and normalizes it to camelCase', () => {
		const pascal = {
			Id: 'abc',
			FileName: 'out',
			FileType: '.txt',
			Data: 'aGk=',
			IsBase64Encoded: true,
			SubFolder: 'results',
			Metadata: { author: 'gh' }
		};
		const res = response(param('Files', [item('Selva.FileIO.FileData', JSON.stringify(pascal))]));

		expect(extractFileData(res)).toEqual([
			{
				fileName: 'out',
				fileType: '.txt',
				data: 'aGk=',
				isBase64Encoded: true,
				subFolder: 'results',
				metadata: { author: 'gh' }
			}
		]);
	});

	it('accepts a string-serialized isBase64Encoded flag', () => {
		const stringFlag = {
			FileName: 'out',
			FileType: '.txt',
			Data: 'aGk=',
			IsBase64Encoded: 'True',
			SubFolder: ''
		};
		const res = response(
			param('Files', [item('Selva.FileIO.FileData', JSON.stringify(stringFlag))])
		);

		expect(extractFileData(res)[0]?.isBase64Encoded).toBe(true);
	});

	it('omits metadata when the payload carries none', () => {
		const res = response(param('Files', [item('FileData', JSON.stringify(validFile))]));
		expect(extractFileData(res)[0]).not.toHaveProperty('metadata');
	});

	// Output widgets read through getValue, and @selvajs/ui's `isFileData` guard
	// expects camelCase: both read paths must normalize alike.
	it('normalizes PascalCase FileData read through getValue', () => {
		const pascal = {
			Id: 'abc',
			FileName: 'PREVIEW',
			FileType: '.svg',
			Data: '<svg />',
			IsBase64Encoded: false,
			SubFolder: ''
		};
		const res = response(
			param('Preview_Image', [item('Selva.FileIO.FileData', JSON.stringify(pascal))])
		);

		expect(getValue(res, { byName: 'Preview_Image' })).toMatchObject({
			fileName: 'PREVIEW',
			fileType: '.svg',
			data: '<svg />',
			isBase64Encoded: false
		});
	});
});

// --- WASM disposal ------------------------------------------------------------

/**
 * Fake emscripten binding: exposes delete()/isDeleted() like real rhino3dm
 * objects. A fake `rhino` module whose Point3d decoder returns these lets the
 * tests observe heap frees without loading WASM.
 */
function makeWasmObject() {
	let deleted = false;
	return {
		delete: vi.fn(() => {
			if (deleted) throw new Error('double delete');
			deleted = true;
		}),
		isDeleted: () => deleted
	};
}

function fakeRhino(created: ReturnType<typeof makeWasmObject>[]) {
	return {
		Point: class {
			constructor() {
				const obj = makeWasmObject();
				created.push(obj);
				return obj;
			}
		}
	};
}

describe('getValues().dispose / disposeRhinoObjects', () => {
	const pointJson = JSON.stringify({ X: 1, Y: 2, Z: 3 });

	it('dispose() deletes every decoded WASM object exactly once, idempotently', () => {
		const created: ReturnType<typeof makeWasmObject>[] = [];
		const res = response(
			param('a', [item('Rhino.Geometry.Point3d', pointJson)]),
			param('b', [
				item('Rhino.Geometry.Point3d', pointJson),
				item('Rhino.Geometry.Point3d', pointJson)
			])
		);

		const result = getValues(res, false, { rhino: fakeRhino(created) as unknown as RhinoRuntime });
		expect(created).toHaveLength(3);
		expect(created.every((o) => !o.isDeleted())).toBe(true);

		result.dispose();
		expect(created.every((o) => o.isDeleted())).toBe(true);

		// Second dispose is a no-op — no double-delete throw.
		expect(() => result.dispose()).not.toThrow();
		for (const o of created) expect(o.delete).toHaveBeenCalledTimes(1);
	});

	it('dispose() leaves plain values untouched and is safe without rhino', () => {
		const res = response(param('n', [item('System.Int32', '42')]));
		const result = getValues(res);
		expect(() => result.dispose()).not.toThrow();
		expect(result.values.n).toBe(42);
	});

	it('disposeRhinoObjects frees getValue results, including aggregated arrays', () => {
		const created: ReturnType<typeof makeWasmObject>[] = [];
		const res = response(
			param('pts', [
				item('Rhino.Geometry.Point3d', pointJson),
				item('Rhino.Geometry.Point3d', pointJson)
			])
		);

		const value = getValue(
			res,
			{ byName: 'pts' },
			{ rhino: fakeRhino(created) as unknown as RhinoRuntime }
		);
		expect(Array.isArray(value)).toBe(true);

		disposeRhinoObjects(value);
		expect(created.every((o) => o.isDeleted())).toBe(true);
	});

	it('disposeRhinoObjects deletes an aliased object only once', () => {
		const obj = makeWasmObject();
		disposeRhinoObjects([obj, { nested: obj }]);
		expect(obj.delete).toHaveBeenCalledTimes(1);
	});
});

describe('getValues — outputs named after Object.prototype members', () => {
	it('keeps each value as-is and the result a plain object', () => {
		const names = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];
		const wire = JSON.parse(
			JSON.stringify(response(...names.map((name) => param(name, [item('System.String', name)]))))
		);

		const { values } = getValues(wire);

		for (const name of names)
			expect(Object.getOwnPropertyDescriptor(values, name)?.value).toBe(name);
		expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
	});

	it('still aggregates repeated names', () => {
		const wire = response(
			param('constructor', [item('System.String', 'a')]),
			param('constructor', [item('System.String', 'b')])
		);
		expect(getValues(wire).values.constructor).toEqual(['a', 'b']);
	});
});

describe('getValues — text outputs keep their type', () => {
	const textOutput = (data: string) =>
		({
			values: [
				{ ParamName: 'Out', InnerTree: { '{0}': [{ type: 'System.String', data, id: 'i' }] } }
			]
		}) as unknown as GrasshopperComputeResponse;

	it.each([
		['"12345678901234567890"', '12345678901234567890'],
		['"123"', '123'],
		['"true"', 'true'],
		['"null"', 'null'],
		['"01234"', '01234']
	])('leaves %s as a string', (data, expected) => {
		expect(getValues(textOutput(data)).values.Out).toBe(expected);
	});

	it('still unwraps JSON held in a JSON string', () => {
		expect(getValues(textOutput('"{\\"a\\":1}"')).values.Out).toEqual({ a: 1 });
		expect(getValues(textOutput('"[1,2]"')).values.Out).toEqual([1, 2]);
	});
});

describe('getValues — numeric CLR types', () => {
	it.each([
		['System.Int64', '42', 42],
		['System.Single', '1.5', 1.5],
		['System.Decimal', '2.25', 2.25]
	])('parses %s', (type, data, expected) => {
		const response = {
			values: [{ ParamName: 'Out', InnerTree: { '{0}': [{ type, data, id: 'i' }] } }]
		} as unknown as GrasshopperComputeResponse;
		expect(getValues(response).values.Out).toBe(expected);
	});
});

describe('getValues — a System.Int64 past the safe integer range', () => {
	it('keeps the digits as a string rather than rounding them', () => {
		const data = '12345678901234567890';
		const res = response(param('Out', [item('System.Int64', data)]));
		expect(getValues(res).values.Out).toBe(data);
	});
});

describe('getValue — scan boundaries', () => {
	const item = (data: string, id = 'i') => ({ type: 'System.Double', data, id });
	const duplicated = {
		values: [
			{ ParamName: 'Out', InnerTree: { '{0}': [item('1')] } },
			{ ParamName: 'Out', InnerTree: { '{0}': [item('2')] } }
		]
	} as unknown as GrasshopperComputeResponse;

	it('stops at the first param with the name, while getValues aggregates', () => {
		expect(getValue(duplicated, { byName: 'Out' })).toBe(1);
		expect(getValues(duplicated).values.Out).toEqual([1, 2]);
	});

	it('stringOnly filters out FileData', () => {
		const response = {
			values: [
				{ ParamName: 'F', InnerTree: { '{0}': [{ type: 'FileData', data: '{}', id: 'f' }] } }
			]
		} as unknown as GrasshopperComputeResponse;
		expect(getValue(response, { byName: 'F' }, { stringOnly: true })).toBeUndefined();
	});
});
