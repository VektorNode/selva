import type { DefinitionStatus } from './definitions/types.js';

/**
 * Cursor-paginated list options. Adapters default to limit=50, orderBy=createdAt
 * desc, and clamp limit to `MAX_PAGE_LIMIT`.
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
}

export interface Page<T> {
	items: T[];
	nextCursor?: string;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
