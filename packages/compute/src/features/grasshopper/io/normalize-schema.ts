import { readField } from '@/core/utils/read-field';
import type { InputParamSchema, OutputParamSchema } from '../types';

/**
 * @internal Canonicalize a raw `/io` param record's field CASING.
 *
 * ## Why this exists
 *
 * The Rhino Compute `/io` response is only partially camelCased, and how much
 * depends on the server branch:
 *
 * - mcneel 8.x/9.x and the upstream-tracking `8.x.selva` branch keep the IO
 *   schema close to the raw C# classes, which carry few/no `[JsonProperty]`
 *   attributes — so most per-param fields serialize PascalCase (`ParamType`,
 *   `Minimum`, `Name`, `Default`, …), with only `id` / `groupName` / `values`
 *   lowercased.
 * - The VektorNode Compute8 fork added `[JsonProperty("camelCase")]` to every
 *   field, so the same record arrives fully camelCase.
 *
 * The per-type parsers ({@link INPUT_TYPE_PARSERS}) and base-field extraction
 * read fields straight through (`schema.paramType`, `schema.minimum`, …). On a
 * PascalCase server those reads all miss, so every input parses as an unknown
 * type with a `null` default — the definition looks like it has no usable
 * inputs. Normalizing the casing ONCE here, at the parse boundary, lets the
 * whole downstream pipeline stay branch-agnostic without threading `readField`
 * through every parser.
 *
 * ## What it does NOT touch
 *
 * Only the top-level FIELD KEYS are canonicalized. The VALUES are passed through
 * verbatim — in particular `default` (the nested DataTree, whose `InnerTree` /
 * item casing is handled separately and case-insensitively by
 * `normalizeDefault`) and `values` (user-authored dropdown label keys like
 * "Option A", which a naive deep camelCase pass would mangle to "optionA" — the
 * exact regression that motivated removing the old global `camelcaseKeys`).
 *
 * ## Missing wire fields
 *
 * `InputParamSchema` declares several fields required, but a degraded server
 * response can omit any of them. Rather than casting a hole into the type
 * (`as string` on a possibly-`undefined` read), each required field gets an
 * honest fallback that keeps the declared type true AND lets the failure
 * surface where it can be reported:
 *
 * - `paramType` → `''`: an empty type is unknown to the parser registry, so
 *   the input degrades to a safe fallback WITH an unknown-paramType
 *   `parseErrors` entry — a missing required wire field becomes a visible
 *   per-input parse error instead of a downstream `undefined.toLowerCase()`.
 * - `name`/`id`/`description` → `''` (a blank name reports as `'unknown'`).
 * - `treeAccess` → `false`, `atLeast`/`atMost` → `1`: Grasshopper's
 *   item-access defaults.
 * - `groupName` → `null`, NOT `''`: the type is `string | null` precisely to
 *   distinguish "no group" from "empty group name".
 * - `stepSize` is optional; a non-numeric wire value is dropped rather than
 *   passed through typed as `number`.
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

/**
 * @internal Canonicalize a raw `/io` output record's field casing.
 *
 * Same rationale as {@link normalizeInputSchema}.
 */
export function normalizeOutputSchema(raw: unknown): OutputParamSchema {
	return {
		name: readField<string>(raw, 'name') ?? '',
		nickname: readField<string | null>(raw, 'nickname') ?? null,
		paramType: readField<string>(raw, 'paramType') ?? '',
		id: readField<string>(raw, 'id') ?? ''
	};
}
