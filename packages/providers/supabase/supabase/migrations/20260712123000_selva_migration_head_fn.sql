-- ============================================================================
-- selva.migration_head() — app↔DB schema handshake (audit O3)
--
-- The app has no way to see whether the operator applied this package's
-- migrations: self-update only runs `npm install` + pm2 restart, and PostgREST
-- does not expose `supabase_migrations`. This SECURITY DEFINER function makes
-- the migration head queryable through the `selva` schema the app is pinned
-- to. The app compares it against its compiled-in EXPECTED_MIGRATION_HEAD at
-- boot and degrades /api/health on skew — which also makes the self-update
-- runner's health probe auto-roll-back an update whose migrations weren't
-- applied yet.
--
-- Bootstrapping is intentional: on a database that never applied THIS
-- migration the RPC itself is missing, which the app reads as "schema behind".
-- ============================================================================

create or replace function selva.migration_head()
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
	return coalesce(
		(select max(version) from supabase_migrations.schema_migrations),
		''
	);
exception
	-- A project where the CLI never pushed migrations has no
	-- supabase_migrations.schema_migrations table at all.
	when undefined_table then
		return '';
end;
$$;

revoke all on function selva.migration_head() from public;
grant execute on function selva.migration_head() to service_role;
