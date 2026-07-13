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
	// Two cases where processInput drops a default we must carry anyway (the
	// default IS what TreeBuilder puts on the wire; a dropped default means the
	// input is omitted from the solve and the user's selection never reaches
	// Grasshopper):
	//  - a plain array default (multi-select widgets, e.g. a dynamic value list
	//    checklist) is dropped as "malformed"; TreeBuilder.appendFlat handles
	//    arrays natively.
	//  - since @selvajs/compute 3.1.0-beta.5, the ValueList fallback drops a
	//    scalar default it can't validate against a `values` map — and
	//    `SchemaInput` never carries the option map (it lives on the layout
	//    item's config), so every app value-list selection lands here.
	const effective = value ?? input.default;
	if (processed.default == null && effective != null) {
		if (Array.isArray(effective)) {
			(processed as { default: unknown }).default = effective;
		} else if (processed.paramType === 'ValueList' && typeof effective !== 'object') {
			// Scoped to ValueList: for other types a dropped scalar default means
			// the package rejected it as unparseable — restoring it would ship
			// garbage to Grasshopper.
			(processed as { default: unknown }).default = effective;
		}
	}
	return processed;
}
