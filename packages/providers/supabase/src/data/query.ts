/** Minimal PostgREST filter-builder slice these helpers need, generic so the caller's row type flows through. */
interface DeletableQuery {
	is(column: string, value: null): this;
}

/** `deleted_at IS NULL`, named once instead of repeated across every soft-deleting store. */
export function notDeleted<Q extends DeletableQuery>(query: Q): Q {
	return query.is('deleted_at', null);
}
