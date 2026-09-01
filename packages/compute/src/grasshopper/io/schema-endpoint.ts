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
 * Use this rather than unwrapping the body by hand. The wrapper's casing varies
 * by server branch: mcneel serializes `FileName`/`Schemas`, the VektorNode fork
 * `fileName`/`schemas`. A fixed-key read silently yields `undefined` against
 * half the servers, and the endpoint answers 200 either way. The failure looks
 * like "this definition has no schemas", which sends you debugging the wrong
 * thing entirely.
 *
 * A blanket key-rewrite (the old `camelcaseKeys` approach) is not the fix: it
 * reaches inside the schemas and mangles user-authored names, `"Display3d"` →
 * `"display3d"`, value-list labels like `"Option A"` → `"optionA"`. Only the two
 * wrapper keys are read here; schema contents pass through untouched, which is
 * why `TSchema` is a pass-through type parameter this module never inspects.
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
