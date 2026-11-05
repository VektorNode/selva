import { readField } from '@/core/utils/read-field';
import type { InputParamSchema, OutputParamSchema } from '../types';

/**
 * Canonicalize a raw `/io` param record's field keys to camelCase, so the
 * parsers can read `schema.paramType` whichever casing the server sent. Values,
 * including `default` and the user-authored `values` map, pass through verbatim.
 *
 * A missing required field gets a fallback that keeps the type true: `paramType`
 * `''` surfaces as an unknown-type parse error, and `groupName` stays `null`
 * (not `''`) so "no group" differs from an empty group name.
 */
export function normalizeInputSchema(raw: unknown): InputParamSchema {
	const stepSize = readField<unknown>(raw, 'stepSize');
	return {
		id: readField<string>(raw, 'id') ?? '',
		name: readField<string>(raw, 'name') ?? '',
		nickname: readField<string | null>(raw, 'nickname') ?? null,
		description: readField<string>(raw, 'description') ?? '',
		paramType: readField<string>(raw, 'paramType') ?? '',
		treeAccess: readField<boolean>(raw, 'treeAccess') ?? false,
		minimum: readField<number | null>(raw, 'minimum') ?? null,
		maximum: readField<number | null>(raw, 'maximum') ?? null,
		atLeast: readField<number>(raw, 'atLeast') ?? 1,
		atMost: readField<number>(raw, 'atMost') ?? 1,
		stepSize: typeof stepSize === 'number' && Number.isFinite(stepSize) ? stepSize : undefined,
		default: readField(raw, 'default'),
		values: readField<Record<string, string>>(raw, 'values'),
		acceptedFormats: readField<string[]>(raw, 'acceptedFormats'),
		groupName: readField<string | null>(raw, 'groupName') ?? null
	};
}

export function normalizeOutputSchema(raw: unknown): OutputParamSchema {
	return {
		name: readField<string>(raw, 'name') ?? '',
		nickname: readField<string | null>(raw, 'nickname') ?? null,
		paramType: readField<string>(raw, 'paramType') ?? '',
		id: readField<string>(raw, 'id') ?? ''
	};
}
