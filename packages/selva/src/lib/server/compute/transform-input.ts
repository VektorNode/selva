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
		paramType: input.paramType,
		treeAccess: input.inputStructure === 'tree',
		minimum: input.minimum ?? null,
		maximum: input.maximum ?? null,
		atLeast: 1,
		atMost: 1,
		stepSize: input.stepSize,
		// The user's selection wins; otherwise the schema default.
		default: value ?? input.default
	};

	return processInput(raw);
}
