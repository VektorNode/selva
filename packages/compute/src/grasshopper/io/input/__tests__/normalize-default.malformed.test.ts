/**
 * MALFORMED-DEFAULT ISOLATION for `normalizeDefault` / `processInputWithError` (issue 49).
 *
 * One malformed input must degrade to a per-input `parseErrors` entry, never abort the whole
 * definition-IO fetch. The tree-access branch used to `.map` over each innerTree branch with no
 * `Array.isArray` guard, and the normalizer ran before `processInputWithError`'s try — so a
 * branch value that wasn't an array threw a raw TypeError that escaped unwrapped.
 */
import { describe, expect, it } from 'vitest';
import {
	processInputWithError,
	processInputsWithErrors
} from '@/grasshopper/io/input/input-processors';
import { createInputSchema } from '@tests/helpers/test-data-builders';

/** A tree-access default whose branch value is not an array — the shape that used to throw. */
const nonArrayBranchDefault = {
	ParamName: 'Get Number',
	InnerTree: {
		'{0}': { type: 'System.Double', data: '42.5' } // object, not array
	}
};

describe('normalizeDefault — malformed tree-access branch', () => {
	it('degrades a non-array innerTree branch to a MALFORMED_DEFAULT error instead of throwing', () => {
		const { input, error } = processInputWithError(
			createInputSchema({
				paramType: 'Number',
				treeAccess: true,
				default: nonArrayBranchDefault as any
			})
		);
		expect(input).toBeDefined();
		expect((input as any).default).toBeNull();
		expect(error?.code).toBe('MALFORMED_DEFAULT');
	});

	it('one malformed input does not abort the batch — the rest still parse', () => {
		const good = createInputSchema({ paramType: 'Number' });
		const bad = createInputSchema({
			paramType: 'Number',
			treeAccess: true,
			default: nonArrayBranchDefault as any
		});

		const { inputs, parseErrors } = processInputsWithErrors([bad, good]);
		expect(inputs).toHaveLength(2);
		expect(parseErrors.some((e) => e.code === 'MALFORMED_DEFAULT')).toBe(true);
	});
});
