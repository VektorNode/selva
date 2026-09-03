import { getLogger } from '@/core';
import { readField, hasField } from '@/core/utils/read-field';
import { booleanTransformer, numericTransformer } from './input-type-parsers';
import type { InputParamSchema } from '../../types';

/** A non-fatal reason normalizeDefault couldn't interpret a raw default. */
export interface NormalizeDefaultWarning {
	code: 'MALFORMED_DEFAULT';
	message: string;
}

/**
 * Read an item's `data` / `type` case-insensitively. Items are lowercase
 * (`data`/`type`) on every known server branch, since they carry `[JsonProperty]`,
 * but reading them defensively costs nothing and guards against future drift.
 */
function itemData(item: unknown): unknown {
	return readField(item, 'data');
}
function itemType(item: unknown): string | undefined {
	return readField<string>(item, 'type');
}

/**
 * Wire item types parsed as numbers in a tree-access default: every numeric
 * CLR type Grasshopper serializes, not just `Double`/`Int32`.
 */
const NUMERIC_ITEM_TYPES = new Set([
	'System.Double',
	'System.Single',
	'System.Decimal',
	'System.Int32',
	'System.Int64'
]);

/** Integral wire item types: rounded like the scalar Integer path. */
const INTEGER_ITEM_TYPES = new Set(['System.Int32', 'System.Int64']);

/**
 * Normalizes a raw input's `default` by flattening the innerTree structure.
 * Reads `default` keys case-insensitively (casing varies by server branch).
 * Returns the normalized schema plus an optional `warning` for malformed defaults.
 */
export function normalizeDefaultWithWarning(input: InputParamSchema): {
	schema: InputParamSchema;
	warning?: NormalizeDefaultWarning;
} {
	if (typeof input.default !== 'object' || input.default === null) {
		return { schema: input };
	}

	// An array default is already in the shape the per-type parsers expect
	// (coerceDefault maps arrays): `processInputs` is public and documents this
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

	if (Object.keys(innerTree).length === 0) {
		return { schema: { ...input, default: undefined } };
	}

	if (input.treeAccess || (input.atMost && input.atMost > 1)) {
		// Items are parsed with the SAME transformers as scalar defaults, so a blank
		// double doesn't become 0 and a junk boolean doesn't silently become false.
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
					// Blank means "no value": drop it silently, mirroring the scalar
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
					// Strict true/false parsing: 'maybe'/'1'/'' are dropped and
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
