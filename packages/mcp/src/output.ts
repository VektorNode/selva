/** What a tool hands back: text for the model, and optionally the same data structured. */
export interface ToolOutput {
	text: string;
	structured?: Record<string, unknown>;
}

/** Roughly 5k tokens: enough for a page of records, small enough to leave room to think. */
export const DEFAULT_MAX_CHARS = 20_000;

export function truncate(text: string, maxChars = DEFAULT_MAX_CHARS, hint = ''): string {
	if (text.length <= maxChars) return text;
	const note = `\n… truncated ${text.length - maxChars} characters.${hint ? ` ${hint}` : ''}`;
	return text.slice(0, maxChars) + note;
}

/** A JSON body as output: pretty text, bounded, plus the object itself when it is one. */
export function jsonOutput(value: unknown, maxChars = DEFAULT_MAX_CHARS): ToolOutput {
	if (value === undefined) return { text: 'Done.' };
	const text = truncate(
		JSON.stringify(value, null, 2),
		maxChars,
		'Narrow the request, or page with `cursor`.'
	);
	const structured =
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	return { text, structured };
}

/** One line per item, for list tools that shouldn't spend tokens on whole records. */
export function listOutput<T>(
	items: T[],
	line: (item: T) => string,
	nextCursor?: string
): ToolOutput {
	const lines = items.length ? items.map(line) : ['Nothing found.'];
	if (nextCursor) lines.push(`More results: call again with cursor "${nextCursor}".`);
	return { text: lines.join('\n'), structured: { items, ...(nextCursor && { nextCursor }) } };
}
