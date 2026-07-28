/**
 * Small query-builder helpers shared across Supabase stores.
 */

/**
 * The slice of a PostgREST filter builder these helpers touch: an `.is()`
 * method that returns the same builder for chaining. Generic over the builder
 * type so the caller's concrete builder (and its row generic) flows through.
 */
interface DeletableQuery {
	is(column: string, value: null): this;
}

/**
 * Apply the soft-delete filter `deleted_at IS NULL`. The `.is('deleted_at', null)`
 * idiom is repeated across every store that soft-deletes; this names it.
 *
 *   let q = notDeleted(client.from('projects').select(COLS));
 */
export function notDeleted<Q extends DeletableQuery>(query: Q): Q {
	return query.is('deleted_at', null);
}
