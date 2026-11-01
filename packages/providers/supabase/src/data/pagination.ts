/**
 * `ListOptions.cursor` is meant to be opaque; here it's just an offset
 * encoded as a string. Simple and correct for stable sorts, fine at Selva's
 * scale (bounded admin/definition lists, not infinite scroll over millions
 * of rows). Keyset pagination would be faster if that ever changes.
 */

import { clampPageLimit, decodeOffsetCursor, encodeOffsetCursor } from '@selvajs/platform';
import type { ListOptions } from '@selvajs/platform';

export interface RangeSpec {
	from: number;
	to: number;
	limit: number;
}

export { decodeOffsetCursor as decodeCursor, encodeOffsetCursor as encodeCursor };

export function toRange(opts: Pick<ListOptions, 'limit' | 'cursor'> | undefined): RangeSpec {
	const limit = clampPageLimit(opts?.limit);
	const from = decodeOffsetCursor(opts?.cursor);
	return { from, to: from + limit - 1, limit };
}

export function nextCursorFromRange(
	range: RangeSpec,
	returnedCount: number,
	totalCount: number | null | undefined
): string | undefined {
	const consumed = range.from + returnedCount;
	if (totalCount != null) {
		return consumed < totalCount ? encodeOffsetCursor(consumed) : undefined;
	}
	// Without total, we can only infer "there might be more" if we got a full page.
	return returnedCount >= range.limit ? encodeOffsetCursor(consumed) : undefined;
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
