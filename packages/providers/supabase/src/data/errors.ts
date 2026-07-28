import { ProviderError } from '@selvajs/platform';

/**
 * Canonical PostgREST/Postgres error translation shared by every Supabase
 * store. Replaces the six near-identical private `mapError` copies that had
 * drifted into two variants (a "full" one preserving `details`/`hint`, and a
 * slimmer message-only one) and none of which handled `PGRST116`.
 *
 * Mapping:
 *  - `PGRST116` (single-row selector matched zero rows) → 404. PostgREST
 *    raises this when `.single()` finds nothing; treating it as "not found"
 *    is almost always what a store's caller wants.
 *  - `23505` (unique violation) / `23503` (foreign-key violation) → 409.
 *  - Anything else → a plain `Error` (500 downstream via `api-errors`), with
 *    `details`/`hint`/`code` preserved on the error object for logs.
 */

/** The subset of a `PostgrestError` this mapper inspects. */
interface PostgrestErrorShape {
	code?: string;
	message?: string;
	details?: string;
	hint?: string;
}

export function mapPostgrestError(e: unknown): Error {
	const pg = e as PostgrestErrorShape;
	switch (pg?.code) {
		case 'PGRST116':
			return new ProviderError(pg.message ?? 'Not found', 404);
		case '23505':
			return new ProviderError(pg.message ?? 'Duplicate record', 409);
		case '23503':
			return new ProviderError(pg.message ?? 'Foreign key violation', 409);
	}
	if (e instanceof Error) return e;
	if (e && typeof e === 'object') {
		const obj = e as PostgrestErrorShape;
		const msg = obj.message ?? obj.details ?? obj.hint ?? 'Unknown Postgres error';
		const err = new Error(obj.code ? `[${obj.code}] ${msg}` : msg);
		Object.assign(err, obj);
		return err;
	}
	return new Error(String(e));
}
