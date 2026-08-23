import { ProviderError } from '@selvajs/platform';

/**
 * PostgREST/Postgres error translation shared by every Supabase store.
 *
 * `PGRST116` (the code `.single()` raises when a selector matches zero rows)
 * maps to 404 — that's almost always what a store's caller wants. Unique and
 * FK violations map to 409. Anything else becomes a plain `Error` (500
 * downstream via `api-errors`), with `details`/`hint`/`code` preserved on the
 * error object for logs.
 */
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
