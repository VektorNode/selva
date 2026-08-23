/**
 * Canonicalize a `/grasshopper/schema` body's key CASING.
 *
 * ## Why this exists
 *
 * Compute serializes the plugin's `UISchema` POCO, whose camelCase wire names
 * live in Newtonsoft `[JsonProperty]` attributes. `Selva.gha` ILRepack-merges
 * Newtonsoft into itself, so those attributes have type
 * `Selva!Newtonsoft.Json.JsonPropertyAttribute`. When the serializer that runs is
 * compute's OWN Newtonsoft assembly, it does not recognize that type as its own
 * attribute, reads no attributes at all, and falls back to raw CLR member names —
 * emitting `Inputs`/`Layout`/`SchemaVersion`.
 *
 * Nothing throws on the wire. Every consumer reads `schema.inputs` as
 * `undefined`, so the definition renders with no inputs, and `schemaVersion`
 * reads `undefined` — which also silently disables the newer-plugin version gate.
 *
 * This is the schema-body counterpart to {@link normalizeInputSchema}, which
 * solves the same split for the `/io` endpoint's param records.
 *
 * ## Why a casing rule, and not a key allowlist
 *
 * The wire names are the CLR names run through Newtonsoft's camelCase strategy,
 * so reproducing that strategy covers every key. An allowlist would have to
 * enumerate every structural key in `UISchema` and drift out of date each time
 * the schema gains a field, failing silently and in exactly this way again.
 *
 * ## What it does NOT touch
 *
 * `options`, `defaultOptions` and `values` hold USER-AUTHORED keys — dropdown
 * labels like `"Standart Beschichtung"`, `"Use 10 Elements instead"`, `"True"`.
 * Those maps are copied verbatim; only the key naming them is canonicalized.
 * Rewriting their contents is the exact regression that motivated deleting the
 * old global `camelcaseKeys` pass (see `read-field.ts`), which mangled
 * `"Option A"` into `"optionA"` and silently changed what a definition solved
 * with.
 *
 * Values are never inspected — only object keys are rewritten.
 */

/**
 * Maps whose KEYS are authored by the definition's author, not by the schema
 * format. Descending into these corrupts user data.
 */
const USER_AUTHORED_MAPS = new Set(['options', 'defaultOptions', 'values']);

const isUpper = (ch: string): boolean => ch >= 'A' && ch <= 'Z';

/**
 * Mirrors Newtonsoft's `CamelCaseNamingStrategy`, which is what the plugin's own
 * serializer would have produced: a leading run of capitals is lowercased whole,
 * except that the last capital stays if a lowercase word follows it. So
 * `Inputs` → `inputs`, `UV` → `uv`, `UVMapping` → `uvMapping`.
 *
 * A naive first-character-only rule yields `uVMapping`, a key nothing reads —
 * the same silent-undefined failure this module exists to prevent.
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
 * Returns a schema whose structural keys are camelCase, regardless of which
 * Newtonsoft serialized it. A body that is already camelCase passes through
 * unchanged in shape (it is still rebuilt, so the result is always a fresh
 * object the caller may mutate).
 *
 * Safe to call on any parsed JSON value; non-objects are returned as-is.
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
		// Copy the map verbatim: its keys are the author's, not the format's.
		out[canonical] = USER_AUTHORED_MAPS.has(canonical) ? child : normalizeValue(child);
	}
	return out;
}
