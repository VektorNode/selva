import { TreeBuilder, type DataTree } from '@selvajs/compute/grasshopper';
import { getInputItems, type UISchema } from '@selvajs/schemas';
import type { SolveInput } from '../shared/solve-input.js';

/**
 * What `SolveEngine.solve` takes as `inputs`, from a schema the host stored. The bounds live on
 * the number widgets in the layout, not on `schema.inputs`, so without them nothing clamps.
 */
export function solveInputsFromSchema(schema: UISchema): SolveInput[] {
	const bounds = new Map<string, { minimum?: number; maximum?: number }>();
	for (const item of getInputItems(schema)) {
		if (item.widgetType === 'number' && item.config) bounds.set(item.paramId, item.config);
	}
	return schema.inputs.map((input) => {
		const widget = bounds.get(input.id);
		return widget ? { ...input, minimum: widget.minimum, maximum: widget.maximum } : input;
	});
}

/** The input tree a solve sends: each input's value, or its schema default when it has none. */
export function buildSolveInputTree(
	inputs: SolveInput[],
	values: Record<string, unknown>
): DataTree[] {
	return TreeBuilder.fromValues(
		inputs
			// Stored schemas are validated at upload only, so an older one can lack `paramType`.
			.filter((input) => input.paramType)
			.map((input) => ({
				paramName: input.nickname,
				paramType: input.paramType,
				// `hasOwn`: an input id of `constructor` would read the inherited function.
				value: (Object.hasOwn(values, input.id) ? values[input.id] : undefined) ?? input.default,
				minimum: input.minimum,
				maximum: input.maximum
			}))
	);
}
