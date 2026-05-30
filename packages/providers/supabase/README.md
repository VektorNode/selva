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

The `supabase/migrations/` directory holds numbered files, applied in order:

| File                                 | What it installs                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_initial.sql`                   | Everything: `user_profiles` (+ auto-seed trigger), `orgs` / `org_members` / `projects` / `project_members` (+ RLS helpers), `definitions` / `definition_versions` (+ deletion-protection FKs and the atomic `increment_run_count` RPC), `invites` (+ `get_invite_by_token` RPC), `compute_servers` (+ per-org/instance defaults, spec §3 BYO compute), `share_links` (+ `try_increment_share_link_solve_count` RPC, spec §7), and the `selva-public` / `selva-private` storage policies. |
| `0002_definition_version_schema.sql` | Adds `definition_versions.schema` + `schema_extracted_at` (cached compute-extracted UI schema) and the previously-missing `change_note` column. All `add column if not exists`, so it's safe to re-run.                                                                                                                                                                                                                                                                                  |

Future schema changes go in numbered files (`0003_…`, `0004_…`).

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

### Upgrading an existing database

If your project already has `0001_initial.sql` applied (any deployment created before the schema-caching release), you only need to apply the new migration:

- **CLI (preferred):** `npx supabase db push` from `packages/providers/supabase` applies any migrations not yet recorded in the project's migration history — it will pick up `0002` and skip `0001`.
- **SQL Editor:** paste the contents of `0002_definition_version_schema.sql` and run it. It uses `add column if not exists`, so running it on an already-migrated DB is a safe no-op.

No backfill step is required: existing definition versions keep working (the app falls back to fetching their schema from Rhino.Compute), and each version's `schema` column is populated lazily the first time it's solved.

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
   - Or manually: Dashboard → **Authentication** → **Add user**, then in the SQL Editor: `UPDATE public.user_profiles SET platform_permissions = ARRAY['instance_admin']::text[] WHERE user_id = '<uuid>';`

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

Every store goes through `ClientBundle.forRequest(ctx)`:

- `ctx.system` → service-role client (bypasses RLS)
- `ctx.adapterContext.sessionToken` → anon client with `Authorization: Bearer <jwt>` (RLS enforces per-user visibility)
- neither → service-role fallback (admin paths)

Helper SQL functions (`is_instance_admin`, `is_org_member`, `visible_project`, `has_org_permission`) are `SECURITY DEFINER` so they evaluate without looping through RLS.

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
