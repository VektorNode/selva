/**
 * Cursor-paginated list options. All fields optional; adapters MUST provide
 * sensible defaults (limit=50, orderBy=createdAt desc).
 *
 * Cursors are opaque strings — adapters may use row ids, offsets, or
 * keyset encodings. Callers must not inspect or construct them.
 */
export interface ListOptions {
	/** Max items to return. Adapters should clamp to a safe upper bound (e.g. 200). */
	limit?: number;
	/** Opaque cursor from a previous page's `nextCursor`. */
	cursor?: string;
	/** Field to order by. Adapters declare which fields they support. */
	orderBy?: 'createdAt' | 'updatedAt' | 'name';
	/** Sort direction. Default: 'desc'. */
	orderDir?: 'asc' | 'desc';
}

/**
 * List options for definition queries. Extends ListOptions with
 * definition-specific filtering that has no meaning for other entities.
 */
export interface DefinitionListOptions extends ListOptions {
	/**
	 * Include records with status='pending' alongside 'ready'.
	 * Default false — consumers never see half-written state unless
	 * they explicitly opt in (admin/janitor tooling).
	 */
	includePending?: boolean;
}

export interface Page<T> {
	items: T[];
	/** Opaque cursor for the next page, or undefined if this is the last page. */
	nextCursor?: string;
}

/** Default cap adapters should apply when limit is not provided. */
export const DEFAULT_PAGE_LIMIT = 50;

/** Hard upper bound adapters should clamp limit to. */
export const MAX_PAGE_LIMIT = 200;
