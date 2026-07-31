// Value transformers: coerce a schema's raw `default` to a typed value.

import { getLogger } from '@/core';

/**
 * Coerce one raw default value to `T`, or return `null` when it can't be
 * coerced. Transformers never throw — the caller decides whether a `null`
 * is filtered (array items) or surfaced as a parse error (scalars).
 */
export type ValueTransformer<T> = (value: unknown) => T | null;

/**
 * Coerce a schema's `default` through a transformer, mirroring the old
 * `processInputValue`: arrays map+filter (empty → undefined), scalars
 * transform-or-(undefined|preserve). Returns the new default value rather than
 * mutating.
 */
export function coerceDefault<T>(
	value: unknown,
	transform: ValueTransformer<T>,
	setUndefinedOnEmpty: boolean
): unknown {
	if (value === undefined || value === null) {
		return value;
	}

	if (Array.isArray(value)) {
		const processed = value.map(transform).filter((v): v is T => v !== null);
		return processed.length > 0 ? processed : undefined;
	}

	const transformed = transform(value);
	if (transformed !== null) {
		return transformed;
	}
	return setUndefinedOnEmpty ? undefined : value;
}

/**
 * @internal Shared with `normalize-default.ts` so tree-access items are parsed
 * with the exact same rules as scalar/array defaults (issue: the tree path used
 * to hand-roll `Number(data)`, turning a blank double into `0`).
 */
export const numericTransformer: ValueTransformer<number> = (value) => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		// `Number('')` is 0, so reject empty/whitespace before coercing — an empty
		// default should drop to null, not silently become 0.
		if (trimmed === '') return null;
		// `Number()` also accepts hex/binary/octal literals ('0x10' → 16) and
		// 'Infinity' — neither is a value a Grasshopper numeric default can
		// legitimately hold (Infinity even survives applyRounding). Only decimal
		// and exponent notation are accepted.
		if (/^[+-]?0[xbo]/i.test(trimmed)) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

/**
 * @internal Shared with `normalize-default.ts` (see {@link numericTransformer}).
 * Trims like the numeric transformer and follows the {@link ValueTransformer}
 * contract: `null` on a bad value, never a throw — bad array items are filtered
 * like non-string junk, and the boolean parser surfaces bad scalars itself.
 */
export const booleanTransformer: ValueTransformer<boolean> = (value) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const lower = value.trim().toLowerCase();
		if (lower === 'true') return true;
		if (lower === 'false') return false;
	}
	return null;
};

export const textTransformer: ValueTransformer<string> = (value) => {
	if (typeof value === 'string') {
		if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
			return value.slice(1, -1);
		// Unbalanced leading quote: strip only the quote, not the last character.
		if (value.startsWith('"')) return value.slice(1);
		return value;
	}
	return null;
};

export const colorTransformer: ValueTransformer<string> = (value) => {
	if (typeof value === 'string') {
		let cleaned = value.trim();
		if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
			cleaned = cleaned.slice(1, -1).trim();
		}
		return cleaned;
	}
	return null;
};

export function objectTransformer(inputName: string): ValueTransformer<object> {
	return (value) => {
		if (typeof value === 'object' && value !== null) return value;
		if (typeof value === 'string' && value.trim() !== '') {
			try {
				const parsed = JSON.parse(value);
				if (typeof parsed === 'object' && parsed !== null) return parsed;
				getLogger().warn(`Parsed value for input ${inputName} is not an object`);
				return null;
			} catch (err) {
				getLogger().warn(`Failed to parse object value "${value}" for input ${inputName}`, err);
				return null;
			}
		}
		return null;
	};
}
