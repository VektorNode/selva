import { TreeBuilder, type DataTree } from '@selvajs/compute/grasshopper';
import { getInputItems, type UISchema } from '@selvajs/schemas';
import type { SolveInput } from '../shared/solve-input.js';
import { serverSourcedInputIds } from '../shared/server-sourced.js';

/**
 * What `SolveEngine.solve` takes as `inputs`, from a schema the host stored. The layout, not
 * `schema.inputs`, carries the number widgets' bounds and each input's source: without this,
 * nothing clamps and a `server` input takes the caller's value.
 */
export function solveInputsFromSchema(schema: UISchema): SolveInput[] {
	const bounds = new Map<string, { minimum?: number; maximum?: number }>();
	for (const item of getInputItems(schema)) {
		if (item.widgetType === 'number' && item.config) bounds.set(item.paramId, item.config);
	}
	const serverSourced = serverSourcedInputIds(schema);
	return schema.inputs.map((input) => {
		const widget = bounds.get(input.id);
		if (!widget && !serverSourced.has(input.id)) return input;
		return {
			...input,
			...(widget ? { minimum: widget.minimum, maximum: widget.maximum } : {}),
			...(serverSourced.has(input.id) ? { serverSourced: true } : {})
		};
	});
}

/**
 * Ids in `values` that set a server-sourced input. A host refuses a request carrying any: the
 * input tree would ignore them, and the caller should hear so rather than solve on the default.
 */
export function postedServerSourcedIds(
	inputs: SolveInput[],
	values: Record<string, unknown>
): string[] {
	return inputs
		.filter((input) => input.serverSourced && Object.hasOwn(values, input.id))
		.map((input) => input.id);
}

/**
 * The input tree a solve sends: each input's value, or its schema default when it has none. A
 * server-sourced input always takes its default.
 */
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
				value:
					(!input.serverSourced && Object.hasOwn(values, input.id)
						? values[input.id]
						: undefined) ?? input.default,
				minimum: input.minimum,
				maximum: input.maximum
			}))
	);
}
