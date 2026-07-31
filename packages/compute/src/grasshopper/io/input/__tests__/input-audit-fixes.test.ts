/**
 * Regression tests for the grasshopper input-parsing audit fixes
 * (issue 64, 65, 66, 73, 74, 75, 76): tree defaults parsed with the scalar
 * transformers, array defaults supported, server stepSize honored, strict
 * numeric/boolean edge cases, dual error reporting with raw paramType, the
 * ValueList cluster, and the numeric fallback shape.
 */
import { describe, expect, it } from 'vitest';
import {
	processInputs,
	processInputsWithErrors,
	processInputWithError
} from '@/grasshopper/io/input/input-processors';
import { createInputSchema } from '@tests/helpers/test-data-builders';

describe('issue 64 — tree-access defaults use the scalar parsing rules', () => {
	it('drops an empty-string tree double instead of coercing it to 0', () => {
		const { input, error } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: {
					InnerTree: {
						'{0}': [
							{ type: 'System.Double', data: '' },
							{ type: 'System.Double', data: '2.5' }
						]
					}
				} as any
			})
		);
		// The old tree path ran Number('') → 0. Blank means "no value" — same as
		// the scalar path, silently dropped, never 0.
		expect((input as any).default).toEqual({ '{0}': [2.5] });
		expect(error).toBeUndefined();
	});

	it('drops an invalid tree boolean and surfaces it, instead of silently coercing to false', () => {
		const { input, error } = processInputWithError(
			createInputSchema({
				name: 'Toggle',
				paramType: 'Boolean',
				treeAccess: true,
				default: {
					InnerTree: {
						'{0}': [
							{ type: 'System.Boolean', data: 'true' },
							{ type: 'System.Boolean', data: 'maybe' }
						]
					}
				} as any
			})
		);
		// 'maybe' used to become false via `data.toLowerCase() === 'true'`.
		expect((input as any).default).toEqual({ '{0}': [true] });
		expect(error?.code).toBe('MALFORMED_DEFAULT');
		expect(error?.message).toContain('maybe');
	});

	it('parses System.Single/Int64/Decimal tree items as numbers and rounds integral types', () => {
		const { input, error } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: {
					InnerTree: {
						'{0}': [
							{ type: 'System.Single', data: '1.5' },
							{ type: 'System.Decimal', data: '2.25' },
							{ type: 'System.Int64', data: '7.6' },
							{ type: 'System.Int32', data: '3.4' }
						]
					}
				} as any
			})
		);
		expect(error).toBeUndefined();
		// Single/Decimal parse as numbers (they used to stay strings inside a
		// DefaultValue<number> tree); Int32/Int64 round like scalar Integer.
		expect((input as any).default).toEqual({ '{0}': [1.5, 2.25, 8, 3] });
	});

	it('surfaces a locale-comma tree double instead of leaving a string in a number tree', () => {
		const { input, error } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: {
					InnerTree: { '{0}': [{ type: 'System.Double', data: '1,5' }] }
				} as any
			})
		);
		expect((input as any).default).toEqual({ '{0}': [] });
		expect(error?.code).toBe('MALFORMED_DEFAULT');
		expect(error?.message).toContain('1,5');
	});
});

describe('issue 65 — array defaults via public processInputs', () => {
	it('keeps an array default instead of nulling it as MALFORMED_DEFAULT', () => {
		const { inputs, parseErrors } = processInputsWithErrors([
			createInputSchema({ paramType: 'Number', default: [1, 2, 3] })
		]);
		expect(parseErrors).toEqual([]);
		expect((inputs[0] as any).default).toEqual([1, 2, 3]);
	});

	it('supports string-array defaults through the plain processInputs facade', () => {
		const [input] = processInputs([createInputSchema({ paramType: 'Text', default: ['a', 'b'] })]);
		expect((input as any).default).toEqual(['a', 'b']);
	});
});

describe('issue 66 — server-provided stepSize is honored', () => {
	it('uses schema.stepSize instead of the heuristic', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 1.5, stepSize: 0.5 })
		);
		expect(error).toBeUndefined();
		// The heuristic would derive 0.1 from the default's decimal precision.
		expect((input as any).stepSize).toBe(0.5);
		expect((input as any).default).toBe(1.5);
	});

	it('honors stepSize for Integer and tree-access defaults too', () => {
		const { input: intInput } = processInputWithError(
			createInputSchema({ paramType: 'Integer', default: 4, stepSize: 2 })
		);
		expect((intInput as any).stepSize).toBe(2);

		const { input: treeInput } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				stepSize: 0.25,
				default: { InnerTree: { '{0}': [{ type: 'System.Double', data: '1.5' }] } } as any
			})
		);
		expect((treeInput as any).stepSize).toBe(0.25);
	});

	it('falls back to the heuristic when stepSize is absent or unusable', () => {
		const { input } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 1.5, stepSize: -1 })
		);
		expect((input as any).stepSize).toBe(0.1);
	});
});

describe('issue 73 — scalar transformer edge cases', () => {
	it("rejects 'Infinity' and hex strings as numeric defaults with a parse error", () => {
		for (const bad of ['Infinity', '-Infinity', '0x10']) {
			const { input, error } = processInputWithError(
				createInputSchema({ paramType: 'Number', default: bad })
			);
			expect(error, bad).toBeDefined();
			expect(error?.code).toBe('VALIDATION_ERROR');
			// Fallback, never Infinity/16 sneaking through.
			expect((input as any).default).toBe(0);
		}
	});

	it('surfaces a parse error for a locale-comma number instead of silent undefined', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: '1,5' })
		);
		expect(error?.code).toBe('VALIDATION_ERROR');
		expect(error?.message).toContain('1,5');
		expect((input as any).default).toBe(0);
	});

	it('still treats a blank numeric string as "no default" without an error', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: '   ' })
		);
		expect(error).toBeUndefined();
		expect((input as any).default).toBeUndefined();
	});

	it('trims boolean strings like the numeric transformer', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Boolean', default: ' true ' })
		);
		expect(error).toBeUndefined();
		expect((input as any).default).toBe(true);
	});

	it('filters a bad boolean array item like non-string junk instead of aborting the array', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Boolean', default: ['true', 'maybe'] })
		);
		// Previously one 'maybe' threw, discarding 'true' for the [false] fallback.
		expect(error).toBeUndefined();
		expect((input as any).default).toEqual([true]);
	});

	it('still surfaces a scalar invalid boolean as a parse error with the safe fallback', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Boolean', default: 'maybe' })
		);
		expect(error).toBeDefined();
		expect((input as any).default).toBe(false);
	});
});

describe('issue 74 — dual error reporting and raw paramType', () => {
	it('reports BOTH the malformed-default warning and the thrown parser error', () => {
		// Malformed default (no innerTree key) AND a ValueList without values:
		// normalization warns, then the parser throws. Both must surface.
		const { parseErrors } = processInputsWithErrors([
			createInputSchema({
				name: 'Pick',
				paramType: 'ValueList',
				values: undefined,
				default: { somethingElse: 1 } as any
			})
		]);
		expect(parseErrors).toHaveLength(2);
		expect(parseErrors.map((e) => e.code)).toEqual(['MALFORMED_DEFAULT', 'INVALID_INPUT']);
		expect(parseErrors.every((e) => e.inputName === 'Pick')).toBe(true);
	});

	it('reports the RAW declared paramType, not the canonicalized casing', () => {
		const { error, errors } = processInputWithError(
			createInputSchema({ paramType: 'boolean', default: 'maybe' })
		);
		// The input still parses under the canonical 'Boolean' parser, but the
		// error must echo the casing the client sent (per InputParseError docs).
		expect(error?.paramType).toBe('boolean');
		expect(errors?.map((e) => e.paramType)).toEqual(['boolean']);
	});
});

describe('issue 75 — ValueList parsing cluster', () => {
	it('returns the canonical-cased key on a case-insensitive default match', () => {
		const { input, error } = processInputWithError(
			createInputSchema({
				paramType: 'ValueList',
				values: { Alpha: '0', Beta: '1' },
				default: 'alpha'
			})
		);
		expect(error).toBeUndefined();
		// 'alpha' would miss values['alpha'] downstream — the canonical key must win.
		expect((input as any).default).toBe('Alpha');
	});

	it('rejects a non-string-able (tree/array) default with a parse error, not "[object Object]"', () => {
		const { input, error } = processInputWithError(
			createInputSchema({
				paramType: 'ValueList',
				treeAccess: true,
				values: { A: '0' },
				default: { InnerTree: { '{0}': [{ type: 'System.String', data: 'A' }] } } as any
			})
		);
		expect(error?.code).toBe('VALIDATION_ERROR');
		expect((input as any).default).toBeUndefined();
		expect((input as any).default).not.toBe('[object Object]');
	});

	it('never fabricates a [undefined] default on the list-shaped fallback', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'ValueList', values: undefined, atMost: 5 })
		);
		expect(error).toBeDefined();
		expect((input as any).default).toBeUndefined();
		expect((input as any).default).not.toEqual([undefined]);
	});

	it('drops a default that is provably absent from a missing values map', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'ValueList', values: undefined, default: 'x' })
		);
		expect(error).toBeDefined();
		expect((input as any).values).toEqual({});
		expect((input as any).default).toBeUndefined();
	});
});

describe('issue 76 — numeric fallback shape', () => {
	it('sets a stepSize on the fallback param (parse always does)', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'not-a-number' })
		);
		expect(error).toBeDefined();
		expect((input as any).stepSize).toBe(0.1);

		const { input: intInput } = processInputWithError(
			createInputSchema({ paramType: 'Integer', default: 'not-a-number' })
		);
		expect((intInput as any).stepSize).toBe(1);
	});

	it('clamps the safe default to schema.minimum when 0 would be below the floor', () => {
		const { input, error } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'junk', minimum: 1, maximum: 10 })
		);
		expect(error).toBeDefined();
		expect((input as any).default).toBe(1);

		const { input: listInput } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'junk', minimum: 2, atMost: 5 })
		);
		expect((listInput as any).default).toEqual([2]);
	});

	it('keeps 0 when it is already within range', () => {
		const { input } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'junk', minimum: -5, maximum: 5 })
		);
		expect((input as any).default).toBe(0);
	});
});
