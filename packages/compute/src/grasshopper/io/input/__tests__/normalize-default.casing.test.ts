// Every known server branch sends an input's `default` DataTree wrapper as PascalCase
// `ParamName` / `InnerTree`: it is the external `Resthopper.IO.DataTree`, which no fork
// can re-attribute.
import { describe, expect, it } from 'vitest';
import { processInputWithError } from '@/grasshopper/io/input/input-processors';
import { createInputSchema } from '@tests/helpers/test-data-builders';

/** A connected single-value Number default exactly as Compute8 / mcneel 8.x send it. */
const pascalCaseDefault = {
	ParamName: 'Get Number',
	InnerTree: {
		'{0}': [{ type: 'System.Double', data: '42.5', id: '00000000-0000-0000-0000-000000000000' }]
	}
};

describe('normalizeDefault — real wire casing (PascalCase InnerTree)', () => {
	it('parses a PascalCase single-value Number default instead of nulling it', () => {
		const { input } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: pascalCaseDefault })
		);
		expect(input.default).toBe(42.5);
	});

	it('parses a PascalCase tree-access default into a DataTreeDefault', () => {
		const { input } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: {
					ParamName: 'Get Number',
					InnerTree: {
						'{0}': [
							{ type: 'System.Double', data: '1.5' },
							{ type: 'System.Double', data: '2.5' }
						],
						'{1}': [{ type: 'System.Double', data: '3.5' }]
					}
				}
			})
		);
		expect(input.default).toEqual({ '{0}': [1.5, 2.5], '{1}': [3.5] });
	});

	it('treats an empty PascalCase InnerTree as undefined (not null)', () => {
		const { input } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: { ParamName: 'x', InnerTree: {} } })
		);
		expect(input.default).toBeUndefined();
	});

	it('still parses lowercase innerTree (forward-compatible if a branch camelCases it)', () => {
		const { input } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				default: {
					paramName: 'x',
					innerTree: { '{0}': [{ type: 'System.Double', data: '7' }] }
				}
			})
		);
		expect(input.default).toBe(7);
	});

	it('GUARD: a non-empty tree default must never collapse to null', () => {
		for (const wrapper of ['InnerTree', 'innerTree'] as const) {
			const { input } = processInputWithError(
				createInputSchema({
					paramType: 'Number',
					default: { [wrapper]: { '{0}': [{ type: 'System.Double', data: '9' }] } }
				})
			);
			expect(input.default).not.toBeNull();
			expect(input.default).toBe(9);
		}
	});

	it('keeps a bracket-leading System.String tree value as a string (no JSON.parse)', () => {
		// A multi-value Dynamic_ValueList sends string labels that can start with
		// `[`/`{`. Parsed into an array, the leaf `data` is rejected by the fork's
		// Newtonsoft reader.
		const { input } = processInputWithError(
			createInputSchema({
				paramType: 'Text',
				treeAccess: true,
				default: {
					ParamName: 'Values',
					InnerTree: {
						'{0}': [
							{ type: 'System.String', data: '[1,2,3]' },
							{ type: 'System.String', data: '{not json' },
							{ type: 'System.String', data: 'plain' }
						]
					}
				}
			})
		);
		expect(input.default).toEqual({ '{0}': ['[1,2,3]', '{not json', 'plain'] });
	});

	it('warns and nulls only a genuinely unknown shape (no tree key at all)', () => {
		const { input } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: { somethingElse: 1 } })
		);
		expect(input.default).toBeNull();
	});

	it('surfaces a MALFORMED_DEFAULT parse error for an unknown default shape', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({
				name: 'Weird',
				paramType: 'Number',
				default: { somethingElse: 1 }
			})
		);
		expect(input.default).toBeNull();
		expect(errors).toMatchObject([{ code: 'MALFORMED_DEFAULT', inputName: 'Weird' }]);
		expect(errors[0].message).toContain('Weird');
	});

	it('does NOT emit a parse error for a well-formed default', () => {
		const { errors } = processInputWithError(
			createInputSchema({ paramType: 'Number', default: pascalCaseDefault })
		);
		expect(errors).toEqual([]);
	});
});
