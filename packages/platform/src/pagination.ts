/**
 * Cursor-paginated list options. Adapters default `limit` to `DEFAULT_PAGE_LIMIT` and
 * clamp it to `MAX_PAGE_LIMIT` (`clampPageLimit`). Order is `createdAt` desc unless the
 * store documents another; a store with one fixed order may ignore `orderBy`.
 *
 * Cursors are opaque — adapters may use row ids, offsets, or keyset encodings.
 * Callers must not inspect them.
 */
export interface ListOptions {
	limit?: number;
	cursor?: string;
	orderBy?: 'createdAt' | 'updatedAt' | 'name';
	/** Default: 'desc'. */
	orderDir?: 'asc' | 'desc';
}

export interface Page<T> {
	items: T[];
	nextCursor?: string;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** For adapters paging by offset. Junk and negatives read as the first page. */
export function decodeOffsetCursor(cursor: string | undefined): number {
	const offset = cursor ? parseInt(cursor, 10) : 0;
	return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

export function encodeOffsetCursor(offset: number): string {
	return String(offset);
}

type PageFetcher<T> = (page: { limit: number; cursor?: string }) => Promise<Page<T>>;

/**
 * Every page of a list, in order. One call stops at `MAX_PAGE_LIMIT` without saying so, which is
 * fatal for a read that must see every row. Break out of the loop to stop reading.
 */
export async function* walkPages<T>(fetchPage: PageFetcher<T>): AsyncGenerator<Page<T>> {
	let cursor: string | undefined;
	do {
		const page = await fetchPage({ limit: MAX_PAGE_LIMIT, cursor });
		yield page;
		cursor = page.nextCursor;
	} while (cursor);
}

/** Every row of a list, across all its pages. */
export async function listAll<T>(fetchPage: PageFetcher<T>): Promise<T[]> {
	const items: T[] = [];
	for await (const page of walkPages(fetchPage)) items.push(...page.items);
	return items;
}

/** The effective page size for a requested limit. */
export function clampPageLimit(limit: number | undefined): number {
	const requested = limit ?? DEFAULT_PAGE_LIMIT;
	if (!Number.isFinite(requested)) return DEFAULT_PAGE_LIMIT;
	return Math.min(Math.max(1, Math.floor(requested)), MAX_PAGE_LIMIT);
}
