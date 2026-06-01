# Plan: move engine tables into a dedicated `selva` schema

Status: **parts 1–4 done 2026-05-31.** Engine-side schema move implemented +
conformance-verified (169/169 against a fresh `selva` DB from the committed
migrations); consumer README updated (exposed-schemas onboarding, cross-boundary
`selva.` guidance, clash caveat deleted); `minor` changeset written
(`@selvajs/supabase-provider` — pre-1.0, so breaking-but-minor, not major).
Remaining: **Parafa retrofit** (part 5), and the hosted-data-migration open
question below (no hosted deployment on the old layout exists yet, so deferred).

## Bootstrap finding (changed the config approach)

`config.toml`'s static `[api] schemas` is read at stack boot, **before**
migrations run. Listing `selva` there fails PostgREST's startup health check
(`schema "selva" does not exist`) and aborts `supabase start` entirely — the
migrations that would create `selva` never get a chance to run. Fix: leave
`config.toml` at `["public", "graphql_public"]` and expose `selva` **from the
initial migration** via `alter role authenticator set pgrst.db_schemas` +
`notify pgrst, 'reload {config,schema}'`, after the schema exists. Works on
local and hosted (hosted boots from a snapshot, but the migration path is
idempotent and re-asserts exposure).

## Bug found + fixed along the way (pre-existing, not caused by the move)

`definition_versions` had SELECT/INSERT/DELETE RLS policies but **no UPDATE
policy**, so `setVersionSchema` (schema caching, migration 0002) silently wrote
0 rows for any user-scoped caller. Present on `main` too. Added
"definition_versions: editors can update" (same authority as INSERT/DELETE).
The conformance test for it now passes; it was failing before this work on the
old `public` layout as well.

## Why

Every engine table currently lives in Postgres's `public` schema. A consuming
app that shares the same database (e.g. Parafa) therefore shares the `public`
namespace with the engine and must avoid the engine's table names — which is
why Parafa's work-package entity is `jobs`, not `projects` (`projects` is
already `public.projects`, owned by the engine). See parafa
`docs/adr/0003-data-spine.md` §"Job is a general work-package".

Moving engine objects into a dedicated `selva` schema removes the collision
permanently: `selva.projects` and a consumer's own `public.projects` can
coexist. The goal is long-term robustness for future shared-DB consumers, not
solving a problem Parafa has today (Parafa already named around it).

## Spike result (what's proven)

Generated the `selva`-schema migration mechanically and applied it to a live
DB. All risk points passed:

- Schema + all 13 tables + 12 functions + RLS policies create cleanly.
- The `handle_new_auth_user` `SECURITY DEFINER` trigger, living in `selva` and
  fired from `auth.users`, writes to `selva.user_profiles` on signup. **The
  scariest unknown works.**
- RLS helper functions (`selva.is_org_member`, etc.) evaluate cross-schema.
- A `public` app table can FK into `selva.orgs` and use `selva.is_org_member()`
  in its RLS policy — the exact Parafa cross-boundary pattern.

The **one catch**, also proven: PostgREST does not expose `selva` by default,
and supabase-js defaults to the `public` schema. Both must be told about
`selva` (details below). Without that you get `PGRST106 Invalid schema`, then
`PGRST205 schema cache` until a `notify pgrst, 'reload schema'`.

## The change has three coordinated parts

### 1. Migration — rewrite engine objects into `selva`

Mechanical: every `public.<engine-object>` becomes `selva.<engine-object>`.
`auth.*` (`auth.users`, `auth.uid()`) and `storage.*` (`storage.objects`,
bucket policies) are **left untouched** — they're not engine-owned.

- Prepend to the initial migration:
  ```sql
  create schema if not exists selva;
  grant usage on schema selva to anon, authenticated, service_role;
  alter default privileges in schema selva
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema selva
    grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema selva
    grant all on sequences to anon, authenticated, service_role;
  ```
- Every `SECURITY DEFINER` function's `set search_path = public` becomes
  `set search_path = selva, public, extensions` (so `gen_random_uuid()` etc.
  still resolve).
- Storage RLS policies (`storage.objects`) stay on `storage.objects` and keep
  referencing the `'selva-public'` / `'selva-private'` bucket-id **literals**
  (not schema refs). Add `drop policy if exists` guards so re-applying onto a
  DB that already has the old `public`-era storage policies is idempotent —
  the spike hit a duplicate-policy error here.

Files affected: the two migrations under
`packages/providers/supabase/supabase/migrations/`. (These are the same files
mid-rename to timestamped names on `main` — fold the schema rewrite into that
same rename so consumers re-diff once, not twice.)

### 2. PostgREST config — expose `selva`

- **Local dev:** `packages/providers/supabase/supabase/config.toml` →
  `[api] schemas = ["public", "graphql_public", "selva"]`.
- **Hosted:** the consumer must add `selva` to their project's exposed schemas
  (Dashboard → Project Settings → API → "Exposed schemas", or the
  `PGRST_DB_SCHEMAS` env). **This is a new required onboarding step** and must
  be documented — it slightly dents the "drop-in, `public` is yours" pitch but
  is one setting.
- PostgREST caches the schema; after the config change it needs
  `notify pgrst, 'reload schema'` (the CLI/hosted runtime does this on deploy,
  but note it for manual SQL-editor application).

### 3. Client — target the `selva` schema

Every data store uses bare `client.from('orgs')`, which defaults to `public`.
Set the schema at client construction. Three call sites in
`packages/providers/supabase/src/data/client.ts` (service, anon, per-request),
each gains:

```ts
createClient(url, key, {
	db: { schema: 'selva' },
	auth: { persistSession: false, autoRefreshToken: false }
	// ...existing global headers for the per-request client
});
```

**Not affected** (verified): the auth provider's clients
(`src/auth/SupabaseAuthProvider.ts`) only call `.auth.*` (GoTrue / `auth`
schema), never `.from()`. The storage provider targets the `storage` schema.
Leave both as-is.

Test helpers that do raw `.from()` for setup/teardown
(`src/data/__tests__/test-helpers.ts`, ~line 32 admin client and ~line 176
sign-in client) need the same `db: { schema: 'selva' }` or explicit
`.schema('selva')` on their queries.

## Consumer-facing documentation

- README "Applying the schema": note tables live in `selva`, not `public`.
- README "Consuming migrations in an external app": add the **exposed-schemas**
  step for hosted projects, and update the cross-boundary guidance — a
  consumer's app tables reference `selva.orgs` / `selva.is_org_member()`
  (qualified), which is more self-documenting than bare `public.`.
- The shared-`public` name-clash caveat is **deleted** — it no longer applies.

## Parafa retrofit (the only known existing consumer)

Real but mechanical, proven in the spike:

- Harvested engine migrations (`0001_initial.sql`, `0005_definition_version_schema.sql`)
  re-synced from the new `selva`-schema upstream.
- Parafa's own spine migrations (`0002_parafa_spine.sql`, `0004_pm_spine.sql`)
  change cross-boundary refs: `references public.orgs` → `references selva.orgs`,
  `public.is_org_member(org_id)` → `selva.is_org_member(org_id)`,
  `public.set_updated_at()` → `selva.set_updated_at()`,
  `public.is_instance_admin()` → `selva.is_instance_admin()`.
- Parafa's PostgREST config adds `selva` to exposed schemas.
- Parafa's `providers.server.ts` is unaffected (it constructs the provider via
  the published package; the schema lives inside the provider's client).
- Update parafa `docs/adr/0004-engine-drift-strategy.md` harvest table to the
  new upstream filenames + record the schema move.
- A coordinated release: bump `@selvajs/supabase-provider` (minor at least —
  this is a breaking schema change for anyone on the old layout; arguably a
  major), then Parafa bumps + applies the migration on a fresh `db reset`
  locally and a planned migration on any hosted env.

## Sequencing

1. Land the schema rewrite folded into the in-flight timestamped-filename
   rename (one re-diff for consumers).
2. Config + client schema option in the same PR (the three parts must ship
   together or REST breaks).
3. Update provider README + delete the clash caveat.
4. Version bump (decide minor vs major — leaning major: existing deployments
   need a real migration, not just an additive one).
5. Parafa retrofit PR, gated on the provider release.

## Open questions

- **Existing hosted deployments on the `public` layout.** A `public`→`selva`
  move is not additive — it's a table relocation. For a DB with live data this
  needs an `alter table ... set schema selva` migration path, not just the
  fresh-install SQL. The spike only tested fresh creation. **Before shipping,
  prove the data-preserving `set schema` path** (likely:
  `alter table public.orgs set schema selva;` for each table, then recreate the
  policies/grants). Parafa local can `db reset`; a hosted Parafa cannot.
- ~~**Major vs minor version.**~~ **Resolved:** `minor`. The package is pre-1.0
  (0.12.0); under semver a 0.x breaking change bumps the minor, and a changesets
  `major` would force 1.0 prematurely. The breaking nature is called out
  loudly in the changeset body instead.
- ~~**Whether to also gate this behind a config flag.**~~ **Resolved: hard-cut.**
  One consumer (Parafa), no hosted old-layout deployment, so a flag's doubled
  test matrix buys nothing.
