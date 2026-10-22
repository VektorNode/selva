import { TreeBuilder, type DataTree } from '@selvajs/compute/grasshopper';
import type { SolveInput } from '../shared/solve-input.js';

/** The input tree a solve sends: each input's value, or its schema default when it has none. */
export function buildSolveInputTree(
	inputs: SolveInput[],
	values: Record<string, unknown>
): DataTree[] {
	return TreeBuilder.fromValues(
		inputs
			.filter((input) => input.paramType)
			.map((input) => ({
				paramName: input.nickname,
				paramType: input.paramType,
				value: values[input.id] ?? input.default,
				minimum: input.minimum,
				maximum: input.maximum
			}))
	);
}
