/** The parsed value, or `undefined` when `text` isn't JSON. */
export function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
