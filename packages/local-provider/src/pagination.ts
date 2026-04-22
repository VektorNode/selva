import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, type ListOptions, type DefinitionListOptions, type Page } from '@selva/platform';

type AnyListOptions = ListOptions | DefinitionListOptions;

/**
 * In-memory pagination for filesystem-backed adapters.
 * Cursor is an offset encoded as a string. Good enough for single-node local use.
 */
export function paginate<T>(items: T[], opts?: AnyListOptions): Page<T> {
	const limit = Math.min(Math.max(1, opts?.limit ?? DEFAULT_PAGE_LIMIT), MAX_PAGE_LIMIT);
	const offset = opts?.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
	const slice = items.slice(offset, offset + limit);
	const nextOffset = offset + slice.length;
	return {
		items: slice,
		nextCursor: nextOffset < items.length ? String(nextOffset) : undefined
	};
}

type Orderable = { name?: string; createdAt?: string; updatedAt?: string; runCount?: number };

/** Sort a list in place per ListOptions. Mutates the input. */
export function applyOrder<T extends Orderable>(items: T[], opts?: AnyListOptions): T[] {
	const field = opts?.orderBy ?? 'createdAt';
	const dir = opts?.orderDir ?? 'desc';
	const mul = dir === 'asc' ? 1 : -1;
	items.sort((a, b) => {
		const av = a[field] ?? '';
		const bv = b[field] ?? '';
		if (av < bv) return -1 * mul;
		if (av > bv) return 1 * mul;
		return 0;
	});
	return items;
}
