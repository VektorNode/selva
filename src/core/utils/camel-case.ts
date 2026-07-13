import { getLogger } from './logger';

/**
 * Converts a string to camelCase.
 *
 * Handling of the awkward shapes (fixed 2026-07-12 — issue 109; behavior
 * change from the earlier version, which only lowercased the first character
 * and kept leading separators):
 *
 * - Leading/trailing separators are stripped: `'_foo'` → `'foo'`,
 *   `'__proto__'` → `'proto'` (the output can never contain `-`/`_`, so a
 *   camelCased key can never be `'__proto__'` — proto pollution via
 *   {@link camelcaseKeys} stays impossible).
 * - Leading acronym runs are lowercased as a unit: `'URLPath'` → `'urlPath'`,
 *   `'IDNumber'` → `'idNumber'`, `'URL'` → `'url'` (previously `'uRLPath'`,
 *   `'iDNumber'`, `'uRL'`).
 *
 * @param str - The string to convert
 * @param options - Options object
 *   - preserveSpaces: If true, spaces are preserved (default: false)
 */
export function toCamelCase(str: string, options: { preserveSpaces?: boolean } = {}): string {
	const { preserveSpaces = false } = options;
	const sep = preserveSpaces ? /[-_]+(.)?/g : /[\s\-_]+(.)?/g;
	let out = str.trim().replace(sep, (_, c: string | undefined) => (c ? c.toUpperCase() : ''));
	// Lowercase a leading acronym run in full — all uppercase letters up to
	// (but not including) one that starts a normal Word, or to the end.
	out = out.replace(/^[A-Z]+(?=[A-Z][a-z]|[^A-Za-z]|$)/, (m) => m.toLowerCase());
	return out.charAt(0).toLowerCase() + out.slice(1);
}

/** Plain object = prototype is `Object.prototype` or `null` (JSON-shaped data). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Recursively converts all object keys to camelCase.
 *
 * Only PLAIN objects (prototype `Object.prototype`/`null`) and arrays are
 * traversed; any other object — `Date`, `Map`, `Set`, `Uint8Array`/typed
 * arrays, class instances, … — is passed through untouched (previously deep
 * mode reduced a `Date` to `{}` and a `Uint8Array` to `{0: …, 1: …}`).
 *
 * When two keys camelCase to the same name (`inner_tree` + `innerTree`), the
 * LAST one in key order wins (matching plain object-spread semantics) and a
 * warning is logged naming both keys — the earlier value is silently
 * unreachable otherwise.
 *
 * @warning Do not use `deep: true` on Rhino Compute wire payloads: it
 * corrupts user-authored keys (value-list labels, item `data` JSON). Read the
 * specific fields you need case-insensitively with `readField`/`hasField` from
 * `core/utils/read-field` instead. Shallow (non-deep) use on wrapper keys is fine.
 *
 * @param obj - The object to process
 * @param options - Options object
 *   - deep: If true, process deeply
 *   - preserveSpaces: If true, spaces are preserved in keys
 * @returns The new object with camelCased keys
 * @internal
 */
export function camelcaseKeys(
	obj: unknown,
	options: { deep?: boolean; preserveSpaces?: boolean } = {}
): unknown {
	if (!obj || typeof obj !== 'object') {
		return obj;
	}

	if (Array.isArray(obj)) {
		return options.deep ? obj.map((item) => camelcaseKeys(item, options)) : obj;
	}

	// Non-plain objects (Date, Map, TypedArray, class instances, …) carry
	// behavior/internal slots that key-mapping would destroy — pass through.
	if (!isPlainObject(obj)) {
		return obj;
	}

	const result: Record<string, unknown> = {};
	for (const key of Object.keys(obj)) {
		const camelKey = toCamelCase(key, { preserveSpaces: options.preserveSpaces });
		if (Object.prototype.hasOwnProperty.call(result, camelKey)) {
			getLogger().warn(
				`camelcaseKeys: key '${key}' collides with an earlier key on '${camelKey}' — the earlier value is overwritten (last key wins).`
			);
		}
		const value = obj[key];
		result[camelKey] = options.deep ? camelcaseKeys(value, options) : value;
	}
	return result;
}
