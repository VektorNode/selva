import { type InputParam, type InputParamSchema, processInput } from '@selvajs/compute';
import type { SchemaInput } from '@selvajs/schemas';

/**
 * Adapt a persisted `SchemaInput` into `@selvajs/compute`'s raw `InputParamSchema`
 * and let its `processInput` produce the typed `InputParam`. `values`/`acceptedFormats`
 * are absent on `SchemaInput` (they live on the layout item's config), so
 * valueList/file inputs fall back to carrying the selected value with no option
 * list — the same value that reaches Grasshopper.
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
		default: value ?? input.default
	};

	const processed = processInput(raw);
	// Two cases where processInput drops a default we must carry anyway — a
	// dropped default means the input is omitted from the solve and the user's
	// selection never reaches Grasshopper:
	//  - a plain array default (multi-select widgets, e.g. a dynamic value list
	//    checklist) is dropped as "malformed".
	//  - the ValueList fallback drops a scalar default it can't validate against
	//    a `values` map — and `SchemaInput` never carries the option map (it
	//    lives on the layout item's config), so every app value-list selection
	//    lands here.
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
