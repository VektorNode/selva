import { getLogger } from '@/core';

/**
 * Coerce one raw default value to `T`, or return `null` when it can't be
 * coerced. Transformers never throw — the caller decides whether a `null`
 * is filtered (array items) or surfaced as a parse error (scalars).
 */
export type ValueTransformer<T> = (value: unknown) => T | null;

/**
 * Coerce a schema's `default`: array items are transformed and the rejected ones
 * filtered (none left → `undefined`); a rejected scalar becomes `undefined` when
 * `dropInvalidScalar`, else is kept verbatim for the parser to report.
 */
export function coerceDefault<T>(
	value: unknown,
	transform: ValueTransformer<T>,
	dropInvalidScalar: boolean
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
	return dropInvalidScalar ? undefined : value;
}

export const numericTransformer: ValueTransformer<number> = (value) => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		// `Number('')` is 0, so reject empty/whitespace before coercing — an empty
		// default should drop to null, not silently become 0.
		if (trimmed === '') return null;
		// `Number()` also accepts '0x10' and 'Infinity'; a Grasshopper numeric
		// default holds neither.
		if (/^[+-]?0[xbo]/i.test(trimmed)) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

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
