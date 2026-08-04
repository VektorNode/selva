/**
 * The wrapper-key unwrap for `/grasshopper/schema`.
 *
 * This exists because three separate call sites hand-rolled it and all three got
 * it wrong the same way — passing the response ARRAY to a shallow key-rewriter,
 * which returns arrays untouched, so `schemas` was never read and every upload
 * reported "no schemas found". These pin both casings and the pass-through.
 */
import { describe, expect, it } from 'vitest';

import { readSchemaResults } from '../schema-endpoint';

const schema = { id: 'a', version: '1.0.0' };

describe('readSchemaResults', () => {
	it('reads the wrapper keys in either server casing', () => {
		const pascal = readSchemaResults([{ FileName: 'a.gh', Schemas: [schema] }]);
		const camel = readSchemaResults([{ fileName: 'a.gh', schemas: [schema] }]);

		expect(pascal[0].schemas).toEqual([schema]);
		expect(camel[0].schemas).toEqual([schema]);
	});

	// The regression that motivated this helper: a shallow key-rewrite over the
	// array is a no-op, so every entry silently read back as `undefined`.
	it('unwraps every entry of a multi-file response', () => {
		const results = readSchemaResults([
			{ FileName: 'a.gh', Schemas: [schema] },
			{ FileName: 'b.gh', Schemas: [schema, schema] }
		]);

		expect(results.flatMap((r) => r.schemas ?? [])).toHaveLength(3);
	});

	it('accepts a bare object as a single entry', () => {
		expect(readSchemaResults({ Schemas: [schema] })[0].schemas).toEqual([schema]);
	});

	it('surfaces a per-file error (compute answers 200 with one)', () => {
		expect(readSchemaResults([{ FileName: 'a.gh', error: 'no Schema output' }])[0].error).toBe(
			'no Schema output'
		);
	});

	// The reason only the wrapper is normalized: user-authored names live inside
	// the schema, and a blanket rewrite mangles them.
	it('leaves schema contents untouched', () => {
		const authored = { ...schema, Display3d: true, 'Option A': 1 };

		expect(readSchemaResults([{ Schemas: [authored] }])[0].schemas?.[0]).toEqual(authored);
	});

	it('reports missing keys as undefined rather than throwing', () => {
		expect(readSchemaResults([{}])[0]).toEqual({ schemas: undefined, error: undefined });
		expect(readSchemaResults(null)[0]).toEqual({ schemas: undefined, error: undefined });
	});
});
