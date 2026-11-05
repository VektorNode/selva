import { readField } from '@/core/utils/read-field';

/** One entry of the schema endpoint's response, after wrapper-key normalization. */
export interface SchemaEndpointResult<TSchema = unknown> {
	/** Schemas embedded in that file. Absent when the file yielded none. */
	schemas?: TSchema[];
	/** Per-file diagnosis. Compute reports this and still answers 200. */
	error?: string;
}

/**
 * Read compute's `/grasshopper/schema` body: `[{ FileName, Schemas }]` per
 * uploaded file, or a bare object for a single file.
 *
 * Use this rather than unwrapping the body by hand: the wrapper keys' casing
 * varies by server branch, and a fixed-key read yields "no schemas" with a 200.
 * Only the two wrapper keys are read; schema contents pass through untouched.
 *
 * @typeParam TSchema - Your schema type (e.g. `UISchema`). Not inspected.
 */
export function readSchemaResults<TSchema = unknown>(
	raw: unknown
): SchemaEndpointResult<TSchema>[] {
	const entries = Array.isArray(raw) ? raw : [raw];
	return entries.map((entry) => ({
		schemas: readField<TSchema[]>(entry, 'schemas'),
		error: readField<string>(entry, 'error')
	}));
}
