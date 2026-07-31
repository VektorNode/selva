/**
 * Characterization tests for the output decode pipeline (response-processors.ts).
 *
 * This 285-line module — the output-side mirror of the input parser pipeline —
 * had no test coverage. These pin its CURRENT behavior: per-system-type
 * decoding, the tryDecodeJSON double-parse, the stringOnly filter, byId/byName
 * lookup, duplicate-key aggregation, WebDisplay exclusion, and extractFileData.
 *
 * They assert what the code does today, so any later deepening of the decode
 * dispatch can be proven behavior-identical.
 */
import { describe, expect, it, vi } from 'vitest';
import { getValues, getValue, extractFileData } from '@/grasshopper/io/output/response-processors';
import { disposeRhinoObjects } from '@/grasshopper/io/output/rhino-decoder';
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
	it('decodes System.Int32 to a number', () => {
		const res = response(param('n', [item('System.Int32', '42')]));
		expect(getValues(res).values.n).toBe(42);
	});

	it('decodes System.Double to a float', () => {
		const res = response(param('x', [item('System.Double', '3.14')]));
		expect(getValues(res).values.x).toBe(3.14);
	});

	it('decodes System.Boolean to a boolean (case-insensitive)', () => {
		const res = response(param('b', [item('System.Boolean', 'True')]));
		expect(getValues(res).values.b).toBe(true);
	});

	it('strips surrounding quotes from System.String', () => {
		const res = response(param('s', [item('System.String', '"hello"')]));
		expect(getValues(res).values.s).toBe('hello');
	});

	it('leaves an unknown type untouched when no rhino instance is given', () => {
		const res = response(param('g', [item('Rhino.Geometry.Point3d', '{"X":1,"Y":2,"Z":3}')]));
		// parseValues default true → tryDecodeJSON parses it; no rhino → returned as the parsed object
		expect(getValues(res).values.g).toEqual({ X: 1, Y: 2, Z: 3 });
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
		// Regression: Array.isArray-based aggregation pushed the second item INTO
		// the first item's parsed array — [1,2,3,[4]] instead of [[1,2,3],[4]].
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
	it('returns a single value byName', () => {
		const res = response(param('radius', [item('System.Double', '5')]));
		expect(getValue(res, { byName: 'radius' })).toBe(5);
	});

	it('returns an array byName when the param has multiple items', () => {
		const res = response(param('xs', [item('System.Int32', '1'), item('System.Int32', '2')]));
		expect(getValue(res, { byName: 'xs' })).toEqual([1, 2]);
	});

	it('returns undefined for an unknown name', () => {
		const res = response(param('a', [item('System.Int32', '1')]));
		expect(getValue(res, { byName: 'missing' })).toBeUndefined();
	});

	it('returns the matching item byId', () => {
		const res = response(
			param('p', [item('System.Int32', '1', 'id-a'), item('System.Int32', '2', 'id-b')])
		);
		expect(getValue(res, { byId: 'id-b' })).toBe(2);
	});

	it('returns undefined for an unknown id', () => {
		const res = response(param('p', [item('System.Int32', '1', 'id-a')]));
		expect(getValue(res, { byId: 'nope' })).toBeUndefined();
	});
});

// --- missing / alternate-cased fields (issue 62) ------------------------------

describe('resilience to missing or alternate-cased response fields — issue 62', () => {
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

	it('reads camelCase paramName/innerTree (server-branch casing drift)', () => {
		const res = {
			values: [{ paramName: 'n', innerTree: { '{0}': [item('System.Int32', '7')] } }]
		} as unknown as GrasshopperComputeResponse;

		expect(getValues(res).values.n).toBe(7);
		expect(getValue(res, { byName: 'n' })).toBe(7);
	});

	it('tolerates a null InnerTree and a response with no values array', () => {
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

// --- memoization (issue 84) ----------------------------------------------------

describe('parsed-JSON memoization — issue 84', () => {
	it('does not re-run JSON.parse on repeated reads of the same response', () => {
		const res = response(
			param('o', [item('SomeType', '{"a":1}')]),
			param('n', [item('System.Int32', '5')])
		);

		const parseSpy = vi.spyOn(JSON, 'parse');
		try {
			const first = getValues(res).values;
			const callsAfterFirst = parseSpy.mock.calls.length;
			expect(callsAfterFirst).toBeGreaterThan(0);

			const second = getValues(res).values;
			expect(parseSpy.mock.calls.length).toBe(callsAfterFirst); // no re-parse
			expect(second).toEqual(first);

			// getValue over the same response reuses the memo too.
			expect(getValue(res, { byName: 'o' })).toEqual({ a: 1 });
			expect(parseSpy.mock.calls.length).toBe(callsAfterFirst);
		} finally {
			parseSpy.mockRestore();
		}
	});

	it('a fresh (structurally identical) response is parsed independently', () => {
		const make = () => response(param('o', [item('SomeType', '{"a":1}')]));
		expect(getValues(make()).values.o).toEqual({ a: 1 });
		expect(getValues(make()).values.o).toEqual({ a: 1 });
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
});

// --- WASM disposal (issue 48) --------------------------------------------------

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

describe('getValues().dispose / disposeRhinoObjects — issue 48', () => {
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

		const result = getValues(res, false, { rhino: fakeRhino(created) });
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

		const value = getValue(res, { byName: 'pts' }, { rhino: fakeRhino(created) });
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
