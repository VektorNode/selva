import { getLogger } from '@/core';
import { readField, hasField } from '@/core/utils/read-field';
import { booleanTransformer, numericTransformer } from './input-type-parsers';
import type { InputParamSchema } from '../../types';

/**
 * A non-fatal reason `normalizeDefault` could not (fully) interpret a raw
 * `default`. The schema is still returned (with `default` nulled, or with the
 * unparseable tree items dropped) so parsing continues; the caller folds this
 * into the client-visible `parseErrors`.
 */
export interface NormalizeDefaultWarning {
	code: 'MALFORMED_DEFAULT';
	message: string;
}

/**
 * Read an item's `data` / `type` case-insensitively. Items are lowercase
 * (`data`/`type`) on every known server branch — they carry `[JsonProperty]` —
 * but reading them defensively costs nothing and guards against future drift.
 */
function itemData(item: unknown): unknown {
	return readField(item, 'data');
}
function itemType(item: unknown): string | undefined {
	return readField<string>(item, 'type');
}

/**
 * Wire item types parsed as numbers in a tree-access default. Matches the
 * numeric CLR types Grasshopper serializes — the old code only handled
 * `Double`/`Int32`, leaving `Single`/`Int64`/`Decimal` items as strings inside
 * a `DefaultValue<number>` tree.
 */
const NUMERIC_ITEM_TYPES = new Set([
	'System.Double',
	'System.Single',
	'System.Decimal',
	'System.Int32',
	'System.Int64'
]);

/** Integral wire item types — rounded like the scalar Integer path. */
const INTEGER_ITEM_TYPES = new Set(['System.Int32', 'System.Int64']);

/**
 * @internal Shared, type-independent normalization of a raw input's `default`.
 *
 * This is the first step of the input-type parser pipeline: it flattens the
 * raw Grasshopper innerTree default into the shape the per-type parsers
 * expect, BEFORE type dispatch. The flat-vs-tree decision depends only on
 * `treeAccess` / `atMost`, never on the param type — which is why it lives here
 * as one shared step rather than inside each parser.
 *
 * Pure: returns a new schema with a normalized `default`; never mutates the
 * input. Replaces the old in-place `preProcessInputDefault`.
 *
 * ## Casing
 *
 * The `default` wrapper's keys are read case-insensitively via {@link readField}
 * because their casing depends on the server branch: the nested DataTree is
 * PascalCase (`ParamName` / `InnerTree`) on mcneel 8.x/9.x AND on VektorNode
 * Compute8 (the fork camelCases the surrounding IO schema but can't attribute
 * the external `Resthopper.IO.DataTree`). A previous version literal-matched
 * lowercase `innerTree`, which only worked because a now-removed global
 * `camelcaseKeys` pass had flattened the casing first — so once that pass was
 * dropped, every connected default silently collapsed to `null`. Reading the
 * field case-insensitively makes this robust across all three branches without
 * re-introducing the global camelCasing that corrupted value-list label keys.
 *
 * Behavior:
 * - Non-object / null / ARRAY default → returned unchanged (arrays are a
 *   supported `processInputs` input shape; `coerceDefault` handles them).
 * - Object without an innerTree key → default becomes `null` and a
 *   `MALFORMED_DEFAULT` warning is returned (this is a genuinely unexpected
 *   shape, not a casing quirk — the old code only logged and silently nulled,
 *   so the data-loss was invisible on the client).
 * - Empty innerTree → default becomes `undefined`.
 * - tree-access (`treeAccess` or `atMost > 1`) → default becomes a
 *   `Record<branch, parsed[]>` with per-item type-aware parsing that reuses the
 *   scalar value transformers: blank numeric items are dropped (never `0`),
 *   unparseable numeric/boolean items are dropped AND surfaced via a
 *   `MALFORMED_DEFAULT` warning, and integral items are rounded like the
 *   scalar Integer path.
 * - otherwise → flatten all branch items: 0 → `undefined`, 1 → the value,
 *   N → the array.
 *
 * Returns the normalized schema plus an optional `warning`. Callers that don't
 * need the warning channel read `.schema` off the result.
 */
export function normalizeDefaultWithWarning(input: InputParamSchema): {
	schema: InputParamSchema;
	warning?: NormalizeDefaultWarning;
} {
	if (typeof input.default !== 'object' || input.default === null) {
		return { schema: input };
	}

	// An array default is already in the shape the per-type parsers expect
	// (coerceDefault maps arrays) — `processInputs` is public and documents this
	// shape. It must NOT fall into the malformed branch below just because
	// `typeof [] === 'object'`.
	if (Array.isArray(input.default)) {
		return { schema: input };
	}

	if (!hasField(input.default, 'innerTree')) {
		const message = `Input "${input.name ?? 'unknown'}" default had an unrecognized shape (no innerTree key); the default was dropped.`;
		getLogger().warn('Unexpected structure in input.default:', input.default);
		return {
			schema: { ...input, default: null },
			warning: { code: 'MALFORMED_DEFAULT', message }
		};
	}

	const innerTree = readField<Record<string, unknown>>(input.default, 'innerTree') ?? {};

	// If innerTree is empty, set default to undefined
	if (Object.keys(innerTree).length === 0) {
		return { schema: { ...input, default: undefined } };
	}

	// If treeAccess is true or atMost > 1, preserve the tree structure
	if (input.treeAccess || (input.atMost && input.atMost > 1)) {
		// Convert each branch to an array of parsed data. Items are parsed with the
		// SAME transformers as scalar defaults (issue: this path used to hand-roll
		// `Number(data)` / `data === 'true'`, so a blank double became 0 and any
		// junk boolean silently became false).
		const tree: Record<string, any[]> = {};
		const invalidItems: string[] = [];
		for (const [branch, items] of Object.entries(innerTree)) {
			// Mirror the flatten path's Array.isArray guard: a non-array branch value must degrade to
			// a MALFORMED_DEFAULT warning, not a raw TypeError that aborts the whole definition-IO fetch.
			if (!Array.isArray(items)) {
				const message = `Input "${input.name ?? 'unknown'}" default had a non-array innerTree branch ("${branch}"); the default was dropped.`;
				getLogger().warn('Unexpected structure in input.default innerTree:', input.default);
				return {
					schema: { ...input, default: null },
					warning: { code: 'MALFORMED_DEFAULT', message }
				};
			}
			const parsed: any[] = [];
			for (const item of items as any[]) {
				const data = itemData(item);
				const type = itemType(item);
				if (type && NUMERIC_ITEM_TYPES.has(type)) {
					// Blank means "no value" — drop it silently, mirroring the scalar
					// path where a blank string default becomes `undefined`, never 0.
					if (typeof data === 'string' && data.trim() === '') continue;
					const num = numericTransformer(data);
					if (num === null) {
						invalidItems.push(`"${String(data)}" (${type})`);
						continue;
					}
					parsed.push(INTEGER_ITEM_TYPES.has(type) ? Math.round(num) : num);
					continue;
				}
				if (type === 'System.Boolean') {
					// Strict true/false parsing — 'maybe'/'1'/'' are dropped and
					// surfaced, not silently coerced to false.
					const bool = booleanTransformer(data);
					if (bool === null) {
						invalidItems.push(`"${String(data)}" (${type})`);
						continue;
					}
					parsed.push(bool);
					continue;
				}
				// Only geometry is JSON-encoded on the wire. A `System.String`
				// must stay a string: value-list labels routinely start with
				// `[`/`{` (e.g. `[1,2,3]`), and JSON-parsing them would put a
				// non-string into the leaf `data`, which the Rhino.Compute
				// fork's Newtonsoft reader rejects ("Unexpected character ... [").
				if (typeof data === 'string' && type?.startsWith('Rhino.Geometry')) {
					try {
						parsed.push(JSON.parse(data));
					} catch {
						parsed.push(data);
					}
					continue;
				}
				parsed.push(data);
			}
			tree[branch] = parsed;
		}

		// Unparseable items are dropped but NOT silently: the good values survive
		// in the tree, and the drop is surfaced through the warning channel so it
		// reaches the client's parseErrors.
		let warning: NormalizeDefaultWarning | undefined;
		if (invalidItems.length > 0) {
			const message = `Input "${input.name ?? 'unknown'}" default contained ${invalidItems.length} tree value(s) that could not be parsed and were dropped: ${invalidItems.join(', ')}.`;
			getLogger().warn(message);
			warning = { code: 'MALFORMED_DEFAULT', message };
		}
		return { schema: { ...input, default: tree }, ...(warning && { warning }) };
	}

	// Otherwise, flatten all values as before
	const allValues: any[] = [];
	for (const items of Object.values(innerTree)) {
		if (Array.isArray(items)) {
			items.forEach((item) => {
				if (item && typeof item === 'object' && hasField(item, 'data')) {
					allValues.push(itemData(item));
				}
			});
		}
	}
	if (allValues.length === 0) {
		return { schema: { ...input, default: undefined } };
	} else if (allValues.length === 1) {
		return { schema: { ...input, default: allValues[0] } };
	} else {
		return { schema: { ...input, default: allValues } };
	}
}
