/**
 * The migration head this build of the provider expects the database to be at
 * — the timestamp prefix of the newest file in `supabase/migrations/`.
 *
 * Compared against `selva.migration_head()` (a SECURITY DEFINER function over
 * `supabase_migrations.schema_migrations`) in
 * `SupabaseDataProvider.verifySchemaVersion` to drive the boot-time app↔DB
 * schema handshake (audit O3).
 *
 * MUST be bumped whenever a migration is added — `migration-head.test.ts`
 * asserts this constant matches the migrations directory, so CI catches drift.
 */
export const EXPECTED_MIGRATION_HEAD = '20260712123000';
