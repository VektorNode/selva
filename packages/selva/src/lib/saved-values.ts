// A definition page renders before Compute has read the values saved in the file, so its form can
// start from the stored defaults. The page repeats its load until the saved values are in the
// schema, then puts them into the inputs the user has not changed.

import { getDefaultValue, type UISchema } from '@selvajs/schemas';

/** What the definition page's load `depends` on, and the page invalidates to repeat it. */
export const SAVED_VALUES_DEPENDENCY = 'selva:saved-values';

/**
 * Waits between repeated loads, about two minutes in all: the server gives a Compute read that
 * long before dropping it.
 */
export const SAVED_VALUES_RECHECK_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000];

/**
 * The saved values to load into a form built from `before`, now that `after` carries them: each
 * input whose default changed and whose value is still the one the form started with. An input
 * the user edited keeps its value, and so does a client-sourced input the form left empty.
 */
export function lateSavedValues(
	before: UISchema,
	after: UISchema,
	current: Readonly<Record<string, unknown>>
): Record<string, unknown> {
	const stored = new Map(before.inputs.map((input) => [input.id, input]));
	const late: Record<string, unknown> = {};
	for (const input of after.inputs) {
		const old = stored.get(input.id);
		if (!old || !(input.id in current)) continue;
		if (input.default === undefined || same(input.default, old.default)) continue;
		// How the solve session built the value it started with.
		const initial = old.default ?? getDefaultValue(old.paramType);
		if (same(current[input.id], initial)) late[input.id] = input.default;
	}
	return late;
}

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
