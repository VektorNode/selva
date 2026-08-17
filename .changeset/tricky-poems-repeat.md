---
'@selvajs/cli': patch
---

Scaffold Supabase deployments with `@selvajs/supabase-provider`, so the migration SQL reaches the deployment directory.

The provider's code is bundled into `@selvajs/selva`, and the CLI treated the package itself as legacy on that basis. Its SQL is not bundled: `@selvajs/selva` publishes only `build` and `templates`, while `supabase/migrations/` and the `selva-supabase` bin ship in the provider's own tarball. A Supabase deployment therefore had no migrations on disk — `npx selva-supabase sync-migrations` failed with a registry 404, and there was no supported way to apply the schema from the deployment host at all.

- `create` adds the dependency when any provider slot is `supabase`, and resolves its pin like the other `@selvajs/*` packages.
- `migrate` adds it to existing Supabase deployments (reading the provider slots from `.env`) and drops it again when a deployment moves off Supabase.
- `doctor` now reports a missing provider package as an error naming the fix, instead of skipping the migration-head check with a yellow note.
