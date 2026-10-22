/**
 * Case-insensitive field reads for wire payloads.
 *
 * Rhino Compute branches serialize the same field in different casings. mcneel 8.x/9.x send the IO
 * schema PascalCase (`ParamType`, `Default`, `InnerTree`): those C# classes carry no
 * `[JsonProperty]`. The VektorNode fork sends camelCase, except inside the `default` DataTree
 * (`ParamName`, `InnerTree`), an external type it can't attribute. So one response can mix casings.
 * Read the fields you need through here and leave the rest verbatim: rewriting every key corrupts
 * user-authored ones such as value-list labels.
 */

/** Own keys only: a payload probed for `constructor` must not find `Object.prototype`'s. */
function findOwnKey(obj: unknown, name: string): string | undefined {
	if (!obj || typeof obj !== 'object') return undefined;
	if (Object.prototype.hasOwnProperty.call(obj, name)) return name;
	const lower = name.toLowerCase();
	return Object.keys(obj).find((key) => key.toLowerCase() === lower);
}

/**
 * Read `name` in any casing, preferring an exact-case match. `undefined` when no own key matches or
 * `obj` isn't an object.
 */
export function readField<T = unknown>(obj: unknown, name: string): T | undefined {
	const key = findOwnKey(obj, name);
	return key === undefined ? undefined : ((obj as Record<string, unknown>)[key] as T);
}

/** Whether `name` is present in any casing, even with a null or undefined value. */
export function hasField(obj: unknown, name: string): boolean {
	return findOwnKey(obj, name) !== undefined;
}
