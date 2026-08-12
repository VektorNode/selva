import {
	DEFAULT_PAGE_LIMIT,
	MAX_PAGE_LIMIT,
	type ListOptions,
	type DefinitionListOptions,
	type Page
} from '@selvajs/platform';

type AnyListOptions = ListOptions | DefinitionListOptions;

/**
 * In-memory pagination for filesystem-backed adapters.
 * Cursor is an offset encoded as a string. Good enough for single-node local use.
 */
export function paginate<T>(items: T[], opts?: AnyListOptions): Page<T> {
	const limit = Math.min(Math.max(1, opts?.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
	// Clamp at 0: a negative cursor would hit `Array.slice(-n)` and serve the
	// tail instead of the head. Garbage parses to NaN, which `|| 0` already
	// maps to the first page.
	const offset = Math.max(0, opts?.cursor ? parseInt(opts.cursor, 10) || 0 : 0);
	const slice = items.slice(offset, offset + limit);
	const nextOffset = offset + slice.length;
	return {
		items: slice,
		nextCursor: nextOffset < items.length ? String(nextOffset) : undefined
	};
}

/**
 * Sort a list in place per ListOptions. Mutates the input.
 * Pass `keyFn` to customize how the comparison value is derived (e.g. nested
 * fields, case-folded strings).
 */
export function applyOrder<T>(
	items: T[],
	opts?: AnyListOptions,
	keyFn: (item: T, field: string) => unknown = (item, field) =>
		(item as Record<string, unknown>)[field]
): T[] {
	const field = opts?.orderBy ?? 'createdAt';
	const dir = opts?.orderDir ?? 'desc';
	const mul = dir === 'asc' ? 1 : -1;
	items.sort((a, b) => {
		const av = (keyFn(a, field) ?? '') as string | number;
		const bv = (keyFn(b, field) ?? '') as string | number;
		if (av < bv) return -1 * mul;
		if (av > bv) return 1 * mul;
		return 0;
	});
	return items;
}
