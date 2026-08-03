import type { DefinitionStatus } from './definitions/types.js';

/**
 * Cursor-paginated list options. Adapters MUST provide sensible defaults
 * (limit=50, orderBy=createdAt desc) and clamp limit to a safe upper bound.
 *
 * Cursors are opaque — adapters may use row ids, offsets, or keyset
 * encodings. Callers must not inspect them.
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
	/**
	 * Include records with `status='pending'`. Default false — consumers don't
	 * see half-written state unless they explicitly opt in.
	 */
	includePending?: boolean;
	/**
	 * Include records with `status='archived'`. Default false — archived
	 * definitions are hidden from normal views; opt in for archive browsers.
	 */
	includeArchived?: boolean;
	/**
	 * Filter to specific editorial statuses. Omit for the default view (all
	 * non-pending, non-archived). Pass `['published']` for the runner home.
	 * When set, `includePending` / `includeArchived` are ignored.
	 */
	statuses?: DefinitionStatus[];
	/**
	 * Restrict to definitions in these projects. An empty array matches nothing
	 * (an empty page), which is distinct from omitting the filter.
	 *
	 * This is what lets visibility filtering happen *in* the query rather than
	 * over the fetched page: the caller resolves the accessible project-id set
	 * first, then passes it here so the adapter applies both the filter and the
	 * cursor. Filtering a fetched page afterwards makes `limit` and `nextCursor`
	 * describe pre-filter positions — a page of 50 can come back with 3 items.
	 */
	projectIds?: readonly string[];
}

export interface Page<T> {
	items: T[];
	nextCursor?: string;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;
