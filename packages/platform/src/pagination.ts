import type { DefinitionStatus } from './definitions/types.js';

/**
 * Cursor-paginated list options. Adapters default to limit=50 and clamp limit to
 * `MAX_PAGE_LIMIT`. Order is `createdAt` desc unless a store says otherwise: local
 * definitions default to `name` asc, and the Supabase member, invite and token
 * lists have one fixed order and ignore `orderBy`.
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

/** Definition-specific filtering on top of `ListOptions`. */
export interface DefinitionListOptions extends Omit<ListOptions, 'orderBy'> {
	orderBy?: 'createdAt' | 'updatedAt' | 'name' | 'solveCount';
	/** Include `status='pending'` records. Default false. */
	includePending?: boolean;
	/** Include `status='archived'` records. Default false. */
	includeArchived?: boolean;
	/**
	 * Filter to specific editorial statuses. Omit for the default view (all
	 * non-pending, non-archived). When set, `includePending` / `includeArchived`
	 * are ignored.
	 */
	statuses?: DefinitionStatus[];
	/**
	 * Restrict to definitions in these projects. An empty array matches nothing,
	 * distinct from omitting the filter.
	 *
	 * Applying this in the adapter query — rather than filtering a fetched page
	 * afterwards — is what keeps `limit` and `nextCursor` accurate: filtering
	 * post-fetch can return a page of 50 with 3 items.
	 */
	projectIds?: readonly string[];
	/** Only definitions whose `sourceDocumentId` equals this lowercase GUID. */
	sourceDocumentId?: string;
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

/** The effective page size for a requested limit. */
export function clampPageLimit(limit: number | undefined): number {
	const requested = limit ?? DEFAULT_PAGE_LIMIT;
	if (!Number.isFinite(requested)) return DEFAULT_PAGE_LIMIT;
	return Math.min(Math.max(1, Math.floor(requested)), MAX_PAGE_LIMIT);
}
