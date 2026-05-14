/**
 * Pagination helpers shared across Supabase stores.
 *
 * The platform contract specifies cursor pagination (`ListOptions.cursor`).
 * Because Supabase/Postgres has no built-in opaque cursor format, we encode
 * an offset as the cursor — simple, correct for stable sorts, and good
 * enough for the volumes Selva deals with (admin/definition lists are
 * bounded; nothing is infinite scroll over millions of rows).
 *
 * Keyset pagination would be faster at scale if it ever matters.
 */

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@selvajs/platform';
import type { ListOptions } from '@selvajs/platform';

export interface RangeSpec {
	from: number;
	to: number;
	limit: number;
}

/** Decode an opaque cursor string. Returns 0 for missing/invalid cursors. */
export function decodeCursor(cursor: string | undefined): number {
	if (!cursor) return 0;
	const n = parseInt(cursor, 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function encodeCursor(offset: number): string {
	return String(offset);
}

/** Clamp limit + compute the PostgREST `range(from, to)` bounds. */
export function toRange(opts: Pick<ListOptions, 'limit' | 'cursor'> | undefined): RangeSpec {
	const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
	const from = decodeCursor(opts?.cursor);
	return { from, to: from + limit - 1, limit };
}

/**
 * Build the `nextCursor` from the count returned by PostgREST. Returns
 * undefined when there is no next page.
 */
export function nextCursorFromRange(
	range: RangeSpec,
	returnedCount: number,
	totalCount: number | null | undefined
): string | undefined {
	const consumed = range.from + returnedCount;
	if (totalCount != null) {
		return consumed < totalCount ? encodeCursor(consumed) : undefined;
	}
	// Without total, we can only infer "there might be more" if we got a full page.
	return returnedCount >= range.limit ? encodeCursor(consumed) : undefined;
}

/** Map `ListOptions.orderBy` to a Postgres column name. */
export function orderColumn(orderBy: ListOptions['orderBy'] | undefined): string {
	switch (orderBy) {
		case 'name':
			return 'name';
		case 'updatedAt':
			return 'updated_at';
		case 'createdAt':
		default:
			return 'created_at';
	}
}
