# @selvajs/supabase-provider

Supabase (Auth + Postgres + Storage) implementation of the `@selvajs/platform` interfaces.

Runs the Selva backend against **either** a managed Supabase project (production) or a local Supabase CLI stack in Docker (development). Same code — different `SUPABASE_URL` and keys.

---

## Table of contents

- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Wiring into `selva.config.ts`](#wiring-into-selvaconfigts)
- [Applying the schema](#applying-the-schema)
- [Development — local Supabase stack](#development--local-supabase-stack)
- [Production — hosted Supabase project](#production--hosted-supabase-project)
- [Running the conformance tests](#running-the-conformance-tests)
- [Architecture notes](#architecture-notes)

---

## Quick start

1. Install the package in the workspace (already listed in `pnpm-workspace.yaml`).
2. Provision Supabase — either local (`npx supabase start`) or hosted (supabase.com).
3. Apply the migrations from `packages/providers/supabase/supabase/migrations/` (the local CLI does this automatically on `db reset`).
4. Copy the three env vars into your selva app `.env` (see below).
5. Edit [`selva.config.ts`](../../../selva.config.ts) at the repo root to swap the local provider for the Supabase provider.
6. `pnpm dev` — the selva app now reads and writes from Supabase.

---

## Environment variables

All env vars are documented in [`packages/selva/.env.example`](../../selva/.env.example) — copy that file to `.env` and edit it. The Supabase provider needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; the optional bucket / private-URL / signup overrides are also listed there.

`SELVA_HMAC_KEY` is not used for sessions by the Supabase provider — those are Supabase JWTs. It's still consulted as the fallback secret for share-link / invite token hashing if `SHARE_LINK_SECRET` / `INVITE_TOKEN_SECRET` are unset. `SELVA_AT_REST_KEY` is local-provider-only and is ignored. Both are harmless if left set.

Rhino.Compute URL + API key are configured in `/admin/compute` and persisted in the `compute_config` table — unchanged by the provider choice.

### Finding the keys

**Local (`npx supabase status`):**

```
╭──────────────────────────────────────────────────╮
│ 🔑 Authentication Keys                            │
├─────────────┬────────────────────────────────────┤
│ Publishable │ sb_publishable_...                 │  ← SUPABASE_ANON_KEY
│ Secret      │ sb_secret_...                      │  ← SUPABASE_SERVICE_ROLE_KEY
╰─────────────┴────────────────────────────────────╯
```

**Hosted:** Supabase Dashboard → **Project Settings** → **API**.

> **The S3-compat keys under the "Storage (S3)" section are NOT what you want.** Those are for external S3 tooling (rclone, etc.), not for `@supabase/supabase-js`.

---

## Wiring into `selva.config.ts`

The repo's [`selva.config.ts`](../../selva.config.ts) is the single DI point — it picks which provider backs every interface. Switch between providers by changing imports:

```ts
import { defineConfig } from '@selvajs/platform';
import * as supa from '@selvajs/supabase-provider';

export default defineConfig((env) => ({
	tenancy: 'single' as const,
	flags: {
		ALLOW_CROSS_ORG_PUBLIC: false,
		ALLOW_ORG_COMPUTE_OVERRIDE: false,
		ALLOW_ORG_CREATION: false
	},
	auth: supa.SupabaseAuthProvider.fromEnv(env),
	data: supa.SupabaseDataProvider.fromEnv(env),
	storage: supa.SupabaseStorageProvider.fromEnv(env)
}));
```

To switch back to the local provider, swap the import and the three provider lines. See the commented example in [`selva.config.ts`](../../selva.config.ts).

---

## Applying the schema

> **All Selva tables live in a dedicated `selva` schema, not `public`.** This keeps the `public` namespace entirely free for a consuming app's own tables — `selva.projects` and your `public.projects` can coexist. The initial migration creates the schema, grants the standard Supabase roles access, and tells PostgREST to expose it (see [Exposing the `selva` schema to PostgREST](#exposing-the-selva-schema-to-postgrest) for what that means on a hosted project).

The `supabase/migrations/` directory holds timestamp-prefixed files, applied in filename order:

| File                                                 | What it installs                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260425155514_selva_initial.sql`                   | Everything: `user_profiles` (+ auto-seed trigger), `orgs` / `org_members` / `projects` / `project_members` (+ RLS helpers), `definitions` / `definition_versions` (+ deletion-protection FKs and the atomic `increment_run_count` RPC), `invites` (+ `get_invite_by_token` RPC), `compute_servers` (+ per-org/instance defaults, spec §3 BYO compute), `share_links` (+ `try_increment_share_link_solve_count` RPC, spec §7), and the `selva-public` / `selva-private` storage policies. |
| `20260529202220_selva_definition_version_schema.sql` | Adds `definition_versions.schema` + `schema_extracted_at` (cached compute-extracted UI schema) and the previously-missing `change_note` column. All `add column if not exists`, so it's safe to re-run.                                                                                                                                                                                                                                                                                  |

Future schema changes go in new timestamp-prefixed files: `<UTCtimestamp>_selva_<name>.sql` (e.g. `date -u +%Y%m%d%H%M%S` for the prefix). The `_selva_` infix and timestamp prefix let a consuming app's own migrations interleave by time without ever colliding with Selva's — see [Consuming migrations in an external app](#consuming-migrations-in-an-external-app).

The `supabase/seed.sql` file creates the two storage buckets (`selva-public`, `selva-private`).

**Local:** `npx supabase db reset` applies everything on a fresh DB.

**Hosted:** link the CLI to your project, then push:

```bash
cd packages/providers/supabase

# One-time link. Reads the project-ref from Supabase Dashboard → Project Settings → General.
npx supabase link --project-ref <your-project-ref>

# Review what will be applied.
npx supabase db diff

# Apply migrations + seed.
npx supabase db push
```

Alternatively you can copy each `.sql` file into Supabase Dashboard → **SQL Editor** and run them in order. The CLI path is strongly preferred — it's idempotent and version-controlled.

### Exposing the `selva` schema to PostgREST

Because the tables live in `selva` rather than `public`, PostgREST (the REST API supabase-js talks to) must be told to expose that schema, or every query fails with `PGRST106 Invalid schema` / `PGRST205 schema cache`.

The initial migration handles this for you: it runs `alter role authenticator set pgrst.db_schemas = '…, selva'` and notifies PostgREST to reload. **You do not list `selva` in `config.toml`'s `[api] schemas`** — PostgREST reads that file at stack boot, before migrations run, so naming a not-yet-created schema there aborts `supabase start`. The migration is the right place because it runs after the schema exists.

- **Local dev:** nothing to do — `db reset` / `db push` runs the migration, which exposes `selva` automatically.
- **Hosted:** the migration still does the work on `db push`. As a belt-and-braces check (or if you applied SQL by hand in the Editor), confirm the schema is exposed under Dashboard → **Project Settings** → **API** → **Exposed schemas** — `selva` should be listed alongside `public` and `graphql_public`. Add it there if it's missing.

### Upgrading an existing database

`supabase db push` keys on the version prefix recorded in the project's `supabase_migrations.schema_migrations` table. It applies any file whose prefix isn't recorded yet, in filename order, and skips the rest — so upgrading is always just **re-sync (external app) or re-pull (this repo), then `db push`**. Gaps and out-of-order prefixes are fine; only the lexical filename order matters.

No backfill step is required for the schema-caching migration: existing definition versions keep working (the app falls back to fetching their schema from Rhino.Compute), and each version's `schema` column is populated lazily the first time it's solved.

#### Migrated from the old `000N_` filenames?

Earlier releases shipped `0001_initial.sql` / `0002_definition_version_schema.sql`. These were renamed to timestamp-prefixed names (`20260425155514_selva_initial.sql`, `20260529202220_selva_definition_version_schema.sql`) so they slot into a consuming app's migration timeline without collisions. The **file contents are unchanged** — only the names.

To a database that already applied the `000N_` versions, the renamed files look like brand-new migrations. Both are idempotent (`create or replace`, `add column if not exists`), so a stray re-run is a harmless no-op, but you'd end up with duplicate history rows. To reconcile cleanly:

- **Local dev stack:** just `npx supabase db reset` — applies the renamed files from scratch.
- **Hosted project with the old versions applied:** tell the CLI the new versions are already present so it doesn't re-run them:
  ```bash
  npx supabase migration repair --status applied 20260425155514 20260529202220
  ```
  (Equivalent to inserting those version strings into `supabase_migrations.schema_migrations`.) Then future `db push` runs treat them as done.

### Consuming migrations in an external app

When you install `@selvajs/supabase-provider` in your own app (rather than running it from this repo), the migration SQL ships inside the package. The clean way to apply it is to **sync the files into your app's own `supabase/migrations/` directory** and let the Supabase CLI drive them alongside your app's own migrations:

```bash
# From your app root, after installing/upgrading the package:
npx selva-supabase sync-migrations          # copies into ./supabase/migrations
npx supabase db push                        # applies anything not yet recorded
```

`sync-migrations` copies each packaged migration **verbatim** (same timestamped filename, same bytes). That's deliberate: the filename is the migration's identity in the history table, so copying without renaming keeps every developer's and CI's history identical.

- **`--dir <path>`** — target a non-default migrations directory.
- **`--force`** — overwrite a same-named file whose content differs (otherwise it's reported as a conflict and the command exits non-zero, leaving your copy untouched).
- Re-running is idempotent: unchanged files are skipped.

**Upgrade flow** (running app, you bump the provider and it carries a new migration): `pnpm up @selvajs/supabase-provider`, then `npx selva-supabase sync-migrations` copies in the new file (later timestamp → sorts last), then `npx supabase db push` applies only that file and skips the ones already recorded. No renumbering, even if your app added its own migrations in between.

**Notes specific to consuming in an external app:**

- **Your tables stay in `public`; Selva's are in `selva`.** Because the engine owns a separate schema, there are no name clashes — your app can have its own `public.projects`, `public.orgs`, `public.definitions`, etc. without touching Selva's. Nothing to check before the first `db push`.
- **Referencing engine objects from your own migrations.** When your app's tables need to point at the engine (FKs, RLS helpers), qualify them with the `selva` schema: `references selva.orgs(id)`, `selva.is_org_member(org_id)`, `selva.is_instance_admin()`, `selva.set_updated_at()`. The qualified names are self-documenting and won't accidentally resolve to a same-named object in your `public`.
- **Expose `selva` in your app's PostgREST too.** If your app uses its own Supabase CLI project / `config.toml`, the synced initial migration exposes `selva` via `alter role authenticator …` when it runs — same mechanism as above. On a hosted project, verify it under Project Settings → API → Exposed schemas after the first push.
- **Storage buckets aren't created by `db push` on a hosted project.** `seed.sql` (which creates `selva-public` / `selva-private`) is dev-only. On a hosted project, run it once by hand in the SQL Editor after the first push — same as the [Production](#production--hosted-supabase-project) flow.

---

## Development — local Supabase stack

Prerequisite: **Docker Desktop running.** First run pulls ~1 GB of images.

```bash
cd packages/providers/supabase
npx supabase start
```

This spins up Postgres (54322), GoTrue/Auth (54321), Storage, Studio (54323), and Mailpit (54324 — fake SMTP inbox for auth emails). Migrations and the bucket seed apply automatically.

Copy the printed **Publishable** and **Secret** keys into your `.env` at the selva app or repo root:

```bash
# selva app .env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

Rhino.Compute server URL + API key are registered in `/admin/compute` after first boot.

Switch `selva.config.ts` to Supabase (snippet above), then:

```bash
pnpm dev
```

**Useful commands:**

```bash
npx supabase status         # show URL + keys again
npx supabase db reset       # wipe DB + re-run migrations + seed
npx supabase stop           # stop containers (keeps volumes)
npx supabase stop --no-backup  # stop + wipe volumes
```

Studio is a full admin UI at `http://127.0.0.1:54323`. Use it to inspect tables, rows, and RLS policies while developing.

---

## Production — hosted Supabase project

1. Create a project on [supabase.com](https://supabase.com). Choose a region close to your selva app deployment.
2. Dashboard → **Project Settings** → **API**. Copy the **Project URL**, **Publishable** key, and **Secret** key.
3. Apply migrations via the CLI:
   ```bash
   cd packages/providers/supabase
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
4. Create the two storage buckets by running `supabase/seed.sql` in the Dashboard → **SQL Editor** (the CLI's `db push` doesn't run the seed on a hosted project — it's dev-only).
5. Set the env vars on your selva app host (Vercel, Fly.io, Docker, etc.):
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_...
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   ```
   After deploying, register your Rhino.Compute server URL (+ optional API key) via `/admin/compute`.
6. Deploy the selva app with `selva.config.ts` wired to `@selvajs/supabase-provider`.
7. Bootstrap the first user:
   - Open `/setup` once — creates the first admin with `instance_admin`.
   - Or manually: Dashboard → **Authentication** → **Add user**, then in the SQL Editor: `UPDATE selva.user_profiles SET platform_permissions = ARRAY['instance_admin']::text[] WHERE user_id = '<uuid>';`

### Operational checklist

- **Backups.** Supabase handles daily backups on paid plans; verify restore works before relying on it.
- **Rotate keys** if the Secret key is ever logged or committed. Dashboard → **Project Settings** → **API** → **Reset service_role key**.
- **Row-level security is on for every table.** Disabling it on any table silently breaks the tenant boundary.
- **Email sender.** Dashboard → **Authentication** → **Email templates** — configure an SMTP provider before going live, otherwise password-reset emails route through Supabase's rate-limited dev sender.

---

## Running the conformance tests

The package ships a full conformance suite that runs against a **live** Supabase stack. It proves the provider implements every interface the same way the local provider does.

```bash
cd packages/providers/supabase

# 1. Make sure the stack is running.
npx supabase start

# 2. Create .env.test with the same three vars.
# (This is separate from your app's .env — it's gitignored and used only by tests.)
cat > .env.test <<EOF
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key>
EOF

# 3. Run.
pnpm test
```

When `.env.test` is missing the suite skips with a single explanatory test.

The suite wipes every table and every auth user between tests — **do not point it at a production project.**

---

## Architecture notes

### Storage

Two buckets:

- **`selva-public`** (public) — covers, archives. `getPublicUrl` returns the direct CDN URL.
- **`selva-private`** (private) — `.gh` / `.ghx` files. `getPublicUrl` returns `/api/files/{path}` which the selva app's route handler must proxy after an auth check.

Images are transcoded to WebP (1200px cap, quality 85) via the shared `transcodeImageIfNeeded` helper from `@selvajs/platform/storage`. Same bytes out of both providers.

### Auth

`SupabaseAuthProvider.verifyLogin` wraps `supabase.auth.signInWithPassword`, returning the JWT directly as `sessionToken`. `verifyToken` calls `supabase.auth.getUser(token)` — GoTrue validates the signature for us. Platform permissions merge in from `user_profiles.platform_permissions` (auto-created by the signup trigger).

MFA methods on `IPasswordAuth` are currently undefined — MFA is deferred. If a user enrolls a factor via the Supabase dashboard, `signInWithPassword` returns an AAL1 session and routes that gate on AAL2 would fail; no route does today.

### Data + RLS

Every client is constructed with `db: { schema: 'selva' }`, so a bare `client.from('orgs')` resolves to `selva.orgs`. Every store goes through `ClientBundle.forRequest(ctx)`:

- `ctx.system` → service-role client (bypasses RLS)
- `ctx.adapterContext.sessionToken` → anon client with `Authorization: Bearer <jwt>` (RLS enforces per-user visibility)
- neither → anon client (RLS active, no `auth.uid()`) — fail-closed. Service-role is opt-in via `ctx.system`, never derived from a missing session.

Helper SQL functions (`selva.is_instance_admin`, `selva.is_org_member`, `selva.visible_project`, `selva.has_org_permission`) are `SECURITY DEFINER` with `search_path = selva, public, extensions` so they evaluate without looping through RLS.

### User profile

`user_profiles` is 1:1 with `auth.users`. The `handle_new_auth_user` trigger inserts a profile row on every signup so the provider never has to fence creation. `starDefinition` / `unstarDefinition` / `recordRun` do read-modify-write — OK for the expected scale; a SECURITY DEFINER RPC would close the race if concurrent starring ever matters.

### Atomic improvements over the local provider

- **`incrementRunCount`** uses a SQL function (`UPDATE … SET run_count = run_count + 1`) — atomic. The local provider does read-modify-write and can lose bumps under concurrent solves.

### Findings

Every abstraction-pressure point hit during implementation is logged in [FINDINGS.md](./FINDINGS.md). Short version: six items, none requiring platform contract changes beyond the Phase 0 set.

---

## Status

Every interface from `@selvajs/platform` is implemented and exercised by the shared conformance suites against a live local Supabase stack:

- `SupabaseAuthProvider` (incl. MFA-ready `LoginResult`)
- `SupabaseStorageProvider`
- `SupabaseOrgStore`, `SupabaseProjectStore`, `SupabaseDefinitionStore` (atomic `incrementRunCount`), `SupabaseInviteStore`, `SupabaseShareLinkStore`, `SupabaseComputeServerStore`
- `SupabaseUserProfileProvider`
- `SupabasePlatformPermissionStore`
- `SupabaseDataProvider` — composition of the data stores

Run them with `pnpm test` (see [Running the conformance tests](#running-the-conformance-tests)).
