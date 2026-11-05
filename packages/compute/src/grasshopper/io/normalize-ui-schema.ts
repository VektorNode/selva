/**
 * Canonicalize a `/grasshopper/schema` body's key casing.
 *
 * Compute serializes the plugin's `UISchema`, whose camelCase wire names live in
 * Newtonsoft `[JsonProperty]` attributes. `Selva.gha` ILRepack-merges Newtonsoft,
 * so those attributes are `Selva!Newtonsoft.Json.JsonPropertyAttribute`. When
 * compute's OWN Newtonsoft serializes, it doesn't recognize them, reads no
 * attributes, and emits raw CLR names (`Inputs`, `SchemaVersion`). Nothing throws:
 * `schema.inputs` reads `undefined`, and so does the `schemaVersion` gate.
 *
 * A casing rule, not a key allowlist: the wire names are the CLR names run
 * through Newtonsoft's camelCase strategy, so reproducing it covers every key
 * without drifting each time `UISchema` gains a field.
 */

import { setOwnField } from '@/core/utils/set-own-field';

/** Maps keyed by the definition's author (dropdown labels): copied verbatim. */
const USER_AUTHORED_MAPS = new Set(['options', 'defaultOptions', 'values']);

/** Maps with author or hash keys whose entries are schema objects: keys verbatim, entries normalized. */
const USER_KEYED_OBJECT_MAPS = new Set(['optionMedia', 'assets']);

const isUpper = (ch: string): boolean => ch >= 'A' && ch <= 'Z';

/**
 * Newtonsoft's `CamelCaseNamingStrategy`: a leading run of capitals is lowercased
 * whole, except the last one when a lowercase word follows. `UV` → `uv`,
 * `UVMapping` → `uvMapping` (a first-character rule gives `uVMapping`).
 */
function toCamelCase(key: string): string {
	if (key.length === 0 || !isUpper(key[0])) return key;

	let run = 0;
	while (run < key.length && isUpper(key[run])) run++;
	// `UVMapping`: the `M` opens the next word, so it keeps its capital.
	if (run > 1 && run < key.length) run--;

	return key.slice(0, run).toLowerCase() + key.slice(run);
}

/**
 * Returns a schema whose structural keys are camelCase, whichever Newtonsoft
 * serialized it. Always a fresh object the caller may mutate; non-objects are
 * returned as-is.
 */
export function normalizeUISchemaCasing<T>(raw: T): T {
	return normalizeValue(raw) as T;
}

function normalizeValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalizeValue);
	if (value === null || typeof value !== 'object') return value;

	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const canonical = toCamelCase(key);
		const normalized = USER_AUTHORED_MAPS.has(canonical)
			? child
			: USER_KEYED_OBJECT_MAPS.has(canonical)
				? normalizeEntries(child)
				: normalizeValue(child);
		setOwnField(out, canonical, normalized);
	}
	return out;
}

function normalizeEntries(value: unknown): unknown {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		setOwnField(out, key, normalizeValue(child));
	}
	return out;
}
