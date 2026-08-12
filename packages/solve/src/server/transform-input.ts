import { type InputParam, type InputParamSchema, processInput } from '@selvajs/compute/grasshopper';
import type { SchemaInput } from '@selvajs/schemas';

/**
 * `SchemaInput` has no `values`/`acceptedFormats` (those live on the layout item's config), so
 * valueList/file inputs here carry just the selected value with no option list.
 */
export function transformInputParameter(
	input: SchemaInput & { minimum?: number; maximum?: number; stepSize?: number },
	value: unknown
): InputParam {
	const raw: InputParamSchema = {
		id: input.id,
		name: input.nickname,
		nickname: input.nickname || null,
		description: input.description || '',
		// processInput has no dynamicValueList handler — the plugin's GetDynamicValueListParameter
		// reuses TypeName "ValueList" on the wire, so map it here or it falls back to Geometry with
		// a null default and TreeBuilder drops the input (Grasshopper solves on a stale fallback).
		paramType: input.paramType === 'dynamicValueList' ? 'valueList' : input.paramType,
		treeAccess: input.inputStructure === 'tree',
		minimum: input.minimum ?? null,
		maximum: input.maximum ?? null,
		atLeast: 1,
		atMost: 1,
		stepSize: input.stepSize,
		default: value ?? input.default
	};

	const processed = processInput(raw);
	// processInput drops a default in two cases we need to override, or the input is omitted from
	// the solve and the user's selection never reaches Grasshopper: a plain array default (e.g. a
	// dynamic value list checklist) is rejected as malformed; and ValueList drops a scalar default
	// it can't validate against a `values` map — which SchemaInput never carries, so every app
	// value-list selection hits this path.
	const effective = value ?? input.default;
	if (processed.default == null && effective != null) {
		if (Array.isArray(effective)) {
			(processed as { default: unknown }).default = effective;
		} else if (processed.paramType === 'ValueList' && typeof effective !== 'object') {
			// Restoring for other types would mean shipping a value the package rejected as
			// genuinely unparseable — scoped to ValueList only.
			(processed as { default: unknown }).default = effective;
		}
	}
	return processed;
}
