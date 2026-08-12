/**
 * `ListOptions.cursor` is meant to be opaque; here it's just an offset
 * encoded as a string. Simple and correct for stable sorts, fine at Selva's
 * scale (bounded admin/definition lists, not infinite scroll over millions
 * of rows). Keyset pagination would be faster if that ever changes.
 */

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@selvajs/platform';
import type { ListOptions } from '@selvajs/platform';

export interface RangeSpec {
	from: number;
	to: number;
	limit: number;
}

/** Returns 0 for a missing or invalid cursor. */
export function decodeCursor(cursor: string | undefined): number {
	if (!cursor) return 0;
	const n = parseInt(cursor, 10);
	return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function encodeCursor(offset: number): string {
	return String(offset);
}

export function toRange(opts: Pick<ListOptions, 'limit' | 'cursor'> | undefined): RangeSpec {
	const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
	const from = decodeCursor(opts?.cursor);
	return { from, to: from + limit - 1, limit };
}

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
