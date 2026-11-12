// The embedded schema carries input values from the author's last schema sync. Compute's `/io`
// reads the values saved in the file, which can be newer, and those are what a form must start
// from. A version's bytes never change, so neither do its saved values.

import type { UISchema } from '@selvajs/schemas';

/** Each input's saved value, keyed by param id. */
export type SavedValues = ReadonlyMap<string, unknown>;

export function savedValuesFrom(
	inputs: ReadonlyArray<{ id?: string; paramType?: string; default?: unknown }>
): SavedValues {
	const values = new Map<string, unknown>();
	for (const input of inputs) {
		if (input.id === undefined || input.default === undefined) continue;
		values.set(input.id, input.paramType === 'Color' ? colorToHex(input.default) : input.default);
	}
	return values;
}

/** `schema` with each input's `default` replaced by its saved value, where it has one. */
export function applySavedValues(schema: UISchema, values: SavedValues): UISchema {
	return {
		...schema,
		inputs: schema.inputs.map((input) =>
			values.has(input.id) ? { ...input, default: values.get(input.id) } : input
		)
	};
}

// Compute sends colors as "r,g,b" or "a,r,g,b"; the color picker takes hex.
function colorToHex(value: unknown): unknown {
	const parts = String(value)
		.split(',')
		.map((s) => parseInt(s.trim(), 10));
	const hex = (n: number) => n.toString(16).padStart(2, '0');
	if (parts.length === 3) return `#${hex(parts[0])}${hex(parts[1])}${hex(parts[2])}`;
	if (parts.length === 4) return `#${hex(parts[1])}${hex(parts[2])}${hex(parts[3])}`;
	return value;
}
