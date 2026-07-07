import { type InputParam, type InputParamSchema, processInput } from '@selvajs/compute';
import type { SchemaInput } from '@selvajs/schemas';

/**
 * Adapt a persisted `SchemaInput` (plus the user's chosen value) into the package's
 * raw `InputParamSchema`, then let `@selvajs/compute`'s own `processInput` produce the
 * typed `InputParam`. The package handles every paramType (Number/Integer/Text/Boolean/
 * ValueList/Geometry/File/Color), normalizes the lowercase UI paramType to its
 * PascalCase form, and falls back gracefully on underspecified inputs — so we no longer
 * maintain a parallel hand-rolled transform that silently coerced valueList/file/color
 * to Text and drifted from the package (and from the parapet app, which already delegates
 * here). `values`/`acceptedFormats` are absent on `SchemaInput` (they live on the layout
 * item's config), so valueList/file inputs fall back to carrying the selected value with
 * no option list — the same value that reaches Grasshopper.
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
		// Dynamic value lists ride the ValueList contract on the wire — the plugin's
		// GetDynamicValueListParameter deliberately reuses TypeName "ValueList" so the
		// compute fork's existing ValueList input case assigns it. processInput has no
		// dynamicValueList handler; without this mapping it falls back to Geometry with
		// a null default and TreeBuilder DROPS the input, so the user's selection never
		// reaches the definition (the param then solves on its own stale fallback).
		paramType: input.paramType === 'dynamicValueList' ? 'valueList' : input.paramType,
		treeAccess: input.inputStructure === 'tree',
		minimum: input.minimum ?? null,
		maximum: input.maximum ?? null,
		atLeast: 1,
		atMost: 1,
		stepSize: input.stepSize,
		// The user's selection wins; otherwise the schema default.
		default: value ?? input.default
	};

	const processed = processInput(raw);
	// processInput's default-normalization only understands scalars and innerTree
	// objects — a plain array default (multi-select widgets, e.g. a dynamic value
	// list checklist) is dropped as "malformed", which would omit the input from
	// the solve entirely. Restore it; TreeBuilder.appendFlat handles arrays natively.
	const effective = value ?? input.default;
	if (Array.isArray(effective) && processed.default == null) {
		(processed as { default: unknown }).default = effective;
	}
	return processed;
}
