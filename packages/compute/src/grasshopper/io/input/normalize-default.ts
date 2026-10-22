import { ErrorCodes, getLogger } from '@/core';
import { readField, hasField } from '@/core/utils/read-field';
import { isDataTreeDefault } from '../../data-tree/tree-path';
import { booleanTransformer, numericTransformer } from './transformers';
import type { ParserWarning } from './input-type-parsers';
import type { InputParamSchema } from '../../types';

/** Every numeric CLR type Grasshopper serializes, so no numeric item stays a string. */
const NUMERIC_ITEM_TYPES = new Set([
	'System.Double',
	'System.Single',
	'System.Decimal',
	'System.Int32',
	'System.Int64'
]);

/** Integral wire item types — rounded like the scalar Integer path. */
const INTEGER_ITEM_TYPES = new Set(['System.Int32', 'System.Int64']);

interface NormalizedDefault {
	schema: InputParamSchema;
	warning?: ParserWarning;
}

function dropDefault(input: InputParamSchema, message: string): NormalizedDefault {
	getLogger().warn(message);
	return {
		schema: { ...input, default: null },
		warning: { code: ErrorCodes.MALFORMED_DEFAULT, message }
	};
}

/**
 * Flatten a raw input's `default` DataTree into the shape the type parsers take.
 * Never mutates `input`. A default it can't interpret is dropped with a `warning`.
 */
export function normalizeDefault(input: InputParamSchema, label: string): NormalizedDefault {
	if (typeof input.default !== 'object' || input.default === null) {
		return { schema: input };
	}

	// Arrays and branch-path maps are already flattened: the per-type parsers take
	// both as-is, so neither may fall into the no-innerTree branch below.
	if (Array.isArray(input.default) || isDataTreeDefault(input.default)) {
		return { schema: input };
	}

	if (!hasField(input.default, 'innerTree')) {
		return dropDefault(
			input,
			`Input "${label}" default had an unrecognized shape (no innerTree key); the default was dropped.`
		);
	}

	const innerTree = readField<Record<string, unknown>>(input.default, 'innerTree') ?? {};
	if (Object.keys(innerTree).length === 0) {
		return { schema: { ...input, default: undefined } };
	}

	if (input.treeAccess || (input.atMost && input.atMost > 1)) {
		// Items go through the same transformers as scalar defaults.
		const tree: Record<string, unknown[]> = {};
		const invalidItems: string[] = [];
		for (const [branch, items] of Object.entries(innerTree)) {
			if (!Array.isArray(items)) {
				return dropDefault(
					input,
					`Input "${label}" default had a non-array innerTree branch ("${branch}"); the default was dropped.`
				);
			}
			const parsed: unknown[] = [];
			for (const item of items) {
				const data = readField(item, 'data');
				const type = readField<string>(item, 'type');
				if (type && NUMERIC_ITEM_TYPES.has(type)) {
					// Blank means "no value", as for a scalar default: dropped, never 0.
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
					const bool = booleanTransformer(data);
					if (bool === null) {
						invalidItems.push(`"${String(data)}" (${type})`);
						continue;
					}
					parsed.push(bool);
					continue;
				}
				// Only geometry is JSON-encoded on the wire. A `System.String` label like
				// `[1,2,3]` must stay a string: the fork's Newtonsoft rejects a non-string leaf.
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

		// The good values survive; the dropped ones are reported.
		if (invalidItems.length > 0) {
			const message = `Input "${label}" default contained ${invalidItems.length} tree value(s) that could not be parsed and were dropped: ${invalidItems.join(', ')}.`;
			getLogger().warn(message);
			return {
				schema: { ...input, default: tree },
				warning: { code: ErrorCodes.MALFORMED_DEFAULT, message }
			};
		}
		return { schema: { ...input, default: tree } };
	}

	const allValues: unknown[] = [];
	for (const items of Object.values(innerTree)) {
		if (!Array.isArray(items)) continue;
		for (const item of items) {
			if (item && typeof item === 'object' && hasField(item, 'data')) {
				allValues.push(readField(item, 'data'));
			}
		}
	}
	return { schema: { ...input, default: allValues.length > 1 ? allValues : allValues[0] } };
}
