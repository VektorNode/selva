/**
 * Timestamp prefix of the newest file in `supabase/migrations/`. Bump this
 * whenever a migration is added — `migration-head.test.ts` asserts it
 * matches the migrations directory, so CI catches drift.
 */
export const EXPECTED_MIGRATION_HEAD = '20261113130000';

/**
 * The oldest head this build runs on; the handshake fails below it. Behind
 * {@link EXPECTED_MIGRATION_HEAD} only while a migration has to land after the
 * app: `20261113120000` takes every write away from sessions, which an older
 * build still writes with, so the app updates first and `db push` follows.
 * Raise it to the newest head once nothing needs that order.
 */
export const REQUIRED_MIGRATION_HEAD = '20261108140000';
