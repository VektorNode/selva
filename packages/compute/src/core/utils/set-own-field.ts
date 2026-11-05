/**
 * `obj[key] = value` for a key taken from a wire payload. Assigning `__proto__` would call the
 * prototype setter and swap the object's prototype instead of storing the value.
 */
export function setOwnField(obj: object, key: string, value: unknown): void {
	if (key === '__proto__') {
		Object.defineProperty(obj, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true
		});
	} else {
		(obj as Record<string, unknown>)[key] = value;
	}
}
