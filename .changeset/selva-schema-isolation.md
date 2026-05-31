---
'@selvajs/supabase-provider': minor
---

Move all engine tables into a dedicated `selva` Postgres schema instead of `public`.

A consuming app sharing the same database now keeps `public` entirely for its own tables — `selva.projects` and a consumer's `public.projects` can coexist, removing the name-clash that previously forced consumers to rename around the engine. The data clients are constructed with `db: { schema: 'selva' }`, the initial migration creates the schema, grants the standard roles, and exposes it to PostgREST via `alter role authenticator set pgrst.db_schemas` (done from the migration, not `config.toml`, to avoid the boot-before-migrations race).

**Breaking for existing databases on the old `public` layout.** This is a table relocation, not an additive change. A fresh install (`db reset` / first `db push`) just works. A database with live data on the old layout needs a data-preserving `alter table … set schema selva` migration path — not covered by the fresh-install SQL. Consumers referencing engine objects from their own migrations must qualify them with `selva.` (`references selva.orgs`, `selva.is_org_member()`, `selva.is_instance_admin()`, `selva.set_updated_at()`).

Also fixes a pre-existing missing UPDATE RLS policy on `definition_versions` that caused `setVersionSchema` to silently write 0 rows for user-scoped callers.
