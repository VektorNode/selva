import { describe, expect, it } from 'vitest';
import {
	processInput,
	processInputsWithErrors,
	processInputWithError
} from '@/grasshopper/io/input/input-processors';
import type { NumericInputType, ValueListInputType } from '@/grasshopper/types';
import { createInputSchema } from '@tests/helpers/test-data-builders';

describe('tree-access defaults use the scalar parsing rules', () => {
	it('drops an empty-string tree double instead of coercing it to 0', () => {
		const { input, errors } = processInputWithError(
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
				}
			})
		);
		// Blank means "no value", as on the scalar path: dropped, never 0.
		expect(input.default).toEqual({ '{0}': [2.5] });
		expect(errors).toEqual([]);
	});

	it('drops an invalid tree boolean and surfaces it, instead of silently coercing to false', () => {
		const { input, errors } = processInputWithError(
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
				}
			})
		);
		expect(input.default).toEqual({ '{0}': [true] });
		expect(errors).toMatchObject([{ code: 'MALFORMED_DEFAULT' }]);
		expect(errors[0].message).toContain('maybe');
	});

	it('parses System.Single/Int64/Decimal tree items as numbers and rounds integral types', () => {
		const { input, errors } = processInputWithError(
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
				}
			})
		);
		expect(errors).toEqual([]);
		expect(input.default).toEqual({ '{0}': [1.5, 2.25, 8, 3] });
	});

	it('surfaces a locale-comma tree double instead of leaving a string in a number tree', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: {
					InnerTree: { '{0}': [{ type: 'System.Double', data: '1,5' }] }
				}
			})
		);
		expect(input.default).toEqual({ '{0}': [] });
		expect(errors).toMatchObject([{ code: 'MALFORMED_DEFAULT' }]);
		expect(errors[0].message).toContain('1,5');
	});
});

describe('array defaults', () => {
	it('keeps an array default instead of nulling it as MALFORMED_DEFAULT', () => {
		const { inputs, parseErrors } = processInputsWithErrors([
			createInputSchema({ paramType: 'Number', default: [1, 2, 3] })
		]);
		expect(parseErrors).toEqual([]);
		expect(inputs[0].default).toEqual([1, 2, 3]);
	});

	it('supports string-array defaults through processInput', () => {
		const input = processInput(createInputSchema({ paramType: 'Text', default: ['a', 'b'] }));
		expect(input.default).toEqual(['a', 'b']);
	});
});

describe('server-provided stepSize is honored', () => {
	it('uses schema.stepSize instead of the heuristic', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 1.5, stepSize: 0.5 })
		);
		expect(errors).toEqual([]);
		// The heuristic would derive 0.1 from the default's decimal precision.
		expect((input as NumericInputType).stepSize).toBe(0.5);
		expect(input.default).toBe(1.5);
	});

	it('honors stepSize for Integer and tree-access defaults too', () => {
		const { input: intInput } = processInputWithError(
			createInputSchema({ paramType: 'Integer', default: 4, stepSize: 2 })
		);
		expect((intInput as NumericInputType).stepSize).toBe(2);

		const { input: treeInput } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				stepSize: 0.25,
				default: { InnerTree: { '{0}': [{ type: 'System.Double', data: '1.5' }] } }
			})
		);
		expect((treeInput as NumericInputType).stepSize).toBe(0.25);
	});

	it('falls back to the heuristic when stepSize is absent or unusable', () => {
		const { input } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 1.5, stepSize: -1 })
		);
		expect((input as NumericInputType).stepSize).toBe(0.1);
	});
});

describe('scalar transformer edge cases', () => {
	it("rejects 'Infinity' and hex strings as numeric defaults with a parse error", () => {
		for (const bad of ['Infinity', '-Infinity', '0x10']) {
			const { input, errors } = processInputWithError(
				createInputSchema({ paramType: 'Number', default: bad })
			);
			expect(errors, bad).toMatchObject([{ code: 'VALIDATION_ERROR' }]);
			// Fallback, never Infinity/16 sneaking through.
			expect(input.default).toBe(0);
		}
	});

	it('surfaces a parse error for a locale-comma number instead of silent undefined', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: '1,5' })
		);
		expect(errors).toMatchObject([{ code: 'VALIDATION_ERROR' }]);
		expect(errors[0].message).toContain('1,5');
		expect(input.default).toBe(0);
	});

	it('still treats a blank numeric string as "no default" without an error', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: '   ' })
		);
		expect(errors).toEqual([]);
		expect(input.default).toBeUndefined();
	});

	it('trims boolean strings like the numeric transformer', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Boolean', default: ' true ' })
		);
		expect(errors).toEqual([]);
		expect(input.default).toBe(true);
	});

	it('filters a bad boolean array item like non-string junk instead of aborting the array', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Boolean', default: ['true', 'maybe'] })
		);
		expect(errors).toEqual([]);
		expect(input.default).toEqual([true]);
	});

	it('still surfaces a scalar invalid boolean as a parse error with the safe fallback', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Boolean', default: 'maybe' })
		);
		expect(errors).toMatchObject([{ code: 'VALIDATION_ERROR' }]);
		expect(input.default).toBe(false);
	});
});

describe('error reporting', () => {
	it('reports BOTH the malformed-default warning and the thrown parser error', () => {
		// Malformed default (no innerTree key) AND a ValueList without values:
		// normalization warns, then the parser throws. Both must surface.
		const { parseErrors } = processInputsWithErrors([
			createInputSchema({
				name: 'Pick',
				paramType: 'ValueList',
				values: undefined,
				default: { somethingElse: 1 }
			})
		]);
		expect(parseErrors.map((e) => e.code)).toEqual(['MALFORMED_DEFAULT', 'INVALID_INPUT']);
		expect(parseErrors.every((e) => e.inputName === 'Pick')).toBe(true);
	});

	it('reports the RAW declared paramType, not the canonicalized casing', () => {
		const { errors } = processInputWithError(
			createInputSchema({ paramType: 'boolean', default: 'maybe' })
		);
		// The input parses under the canonical 'Boolean' parser, but the error
		// echoes the casing the client sent.
		expect(errors.map((e) => e.paramType)).toEqual(['boolean']);
	});
});

describe('ValueList parsing', () => {
	it('returns the canonical-cased key on a case-insensitive default match', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({
				paramType: 'ValueList',
				values: { Alpha: '0', Beta: '1' },
				default: 'alpha'
			})
		);
		expect(errors).toEqual([]);
		// 'alpha' would miss values['alpha'] downstream: the canonical key must win.
		expect(input.default).toBe('Alpha');
	});

	it('surfaces an out-of-range default through parseErrors while still succeeding', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({
				name: 'Pick',
				paramType: 'ValueList',
				values: { Alpha: '0', Beta: '1' },
				default: 'Gamma'
			})
		);
		// The parse succeeds and keeps the default verbatim, but the oddity must
		// reach the client, not just the logger.
		expect(input.default).toBe('Gamma');
		expect(errors).toMatchObject([{ inputName: 'Pick', code: 'VALIDATION_ERROR' }]);
		expect(errors[0].message).toContain('not in available values');
	});

	it('rejects a non-string-able (tree/array) default with a parse error, not "[object Object]"', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({
				paramType: 'ValueList',
				treeAccess: true,
				values: { A: '0' },
				default: { InnerTree: { '{0}': [{ type: 'System.String', data: 'A' }] } }
			})
		);
		expect(errors).toMatchObject([{ code: 'VALIDATION_ERROR' }]);
		expect(input.default).toBeUndefined();
	});

	it('never fabricates a [undefined] default on the list-shaped fallback', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'ValueList', values: undefined, atMost: 5 })
		);
		expect(errors).toMatchObject([{ code: 'INVALID_INPUT' }]);
		expect(input.default).toBeUndefined();
	});

	it('drops a default that is provably absent from a missing values map', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'ValueList', values: undefined, default: 'x' })
		);
		expect(errors).toMatchObject([{ code: 'INVALID_INPUT' }]);
		expect((input as ValueListInputType).values).toEqual({});
		expect(input.default).toBeUndefined();
	});
});

describe('numeric fallback shape', () => {
	it('sets a stepSize on the fallback param (parse always does)', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'not-a-number' })
		);
		expect(errors).toMatchObject([{ code: 'VALIDATION_ERROR' }]);
		expect((input as NumericInputType).stepSize).toBe(0.1);

		const { input: intInput } = processInputWithError(
			createInputSchema({ paramType: 'Integer', default: 'not-a-number' })
		);
		expect((intInput as NumericInputType).stepSize).toBe(1);
	});

	it('clamps the safe default to schema.minimum when 0 would be below the floor', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'junk', minimum: 1, maximum: 10 })
		);
		expect(errors).toMatchObject([{ code: 'VALIDATION_ERROR' }]);
		expect(input.default).toBe(1);

		const { input: listInput } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'junk', minimum: 2, atMost: 5 })
		);
		expect(listInput.default).toEqual([2]);
	});

	it('keeps 0 when it is already within range', () => {
		const { input } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: 'junk', minimum: -5, maximum: 5 })
		);
		expect(input.default).toBe(0);
	});
});
