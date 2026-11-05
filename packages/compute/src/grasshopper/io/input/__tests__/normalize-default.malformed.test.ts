// One malformed input must degrade to a per-input `parseErrors` entry, never abort the whole
// definition-IO fetch.
import { describe, expect, it } from 'vitest';
import {
	processInputWithError,
	processInputsWithErrors
} from '@/grasshopper/io/input/input-processors';
import { createInputSchema } from '@tests/helpers/test-data-builders';

/** A tree-access default whose branch value is not an array. */
const nonArrayBranchDefault = {
	ParamName: 'Get Number',
	InnerTree: {
		'{0}': { type: 'System.Double', data: '42.5' } // object, not array
	}
};

describe('normalizeDefault — malformed tree-access branch', () => {
	it('degrades a non-array innerTree branch to a MALFORMED_DEFAULT error instead of throwing', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: nonArrayBranchDefault
			})
		);
		expect(input).toBeDefined();
		expect(input.default).toBeNull();
		expect(errors).toMatchObject([{ code: 'MALFORMED_DEFAULT' }]);
	});

	it('one malformed input does not abort the batch — the rest still parse', () => {
		const good = createInputSchema({ paramType: 'Number' });
		const bad = createInputSchema({
			paramType: 'Number',
			treeAccess: true,
			default: nonArrayBranchDefault
		});

		const { inputs, parseErrors } = processInputsWithErrors([bad, good]);
		expect(inputs).toHaveLength(2);
		expect(parseErrors.some((e) => e.code === 'MALFORMED_DEFAULT')).toBe(true);
	});
});

describe('normalizeDefault — already-flattened tree default', () => {
	it('keeps a branch-path map instead of dropping it as malformed', () => {
		const { input, errors } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: { '{0}': [1, 2] }
			})
		);
		expect(errors).toEqual([]);
		expect(input.default).toEqual({ '{0}': [1, 2] });
	});
});
