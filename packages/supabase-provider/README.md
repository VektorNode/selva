# @selva/supabase-provider

Supabase (Auth + Postgres + Storage) implementation of the `@selva/platform` interfaces.

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
3. Apply the migrations from `packages/supabase-provider/supabase/migrations/` (the local CLI does this automatically on `db reset`).
4. Copy the three env vars into your compute-app `.env` (see below).
5. Edit [`selva.config.ts`](../../selva.config.ts) at the repo root to swap the local provider for the Supabase provider.
6. `pnpm dev` — the compute-app now reads and writes from Supabase.

---

## Environment variables

The Supabase provider reads three vars. Set them in the app's `.env` (not in the provider package).

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Project URL. Local: `http://127.0.0.1:54321`. Hosted: `https://<project-ref>.supabase.co`. |
| `SUPABASE_ANON_KEY` | ✅ | Public key used by the user-scoped browser/Node client. Safe to ship to the browser. CLI v2.95+ calls this the **Publishable** key. |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-only admin key that bypasses RLS. **Never** exposed to the browser. CLI v2.95+ calls this the **Secret** key. |
| `SUPABASE_PUBLIC_BUCKET` | optional | Bucket name for public files (covers, archives). Default: `selva-public`. |
| `SUPABASE_PRIVATE_BUCKET` | optional | Bucket name for authenticated-only files (`.gh` / `.ghx`). Default: `selva-private`. |
| `SUPABASE_PRIVATE_URL_PREFIX` | optional | App-internal URL prefix the compute-app serves private downloads at. Default: `/api/files`. |
| `SUPABASE_ENABLE_SELF_SIGNUP` | optional | `true` allows `passwordAuth.registerUser` via the `/signup` route. Default: `false` (invite-only). |

Platform-wide vars (already used by compute-app) still apply:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | **Not used** by the Supabase provider (sessions are Supabase JWTs). Harmless if left set. |

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

**Development (local-provider, default):**

```ts
import { defineConfig } from '@selva/platform/config';
import {
	LocalAuthProvider,
	LocalDataProvider,
	LocalStorageProvider,
	LocalUserProfileProvider
} from 'selva-local-provider';

export default defineConfig((env) => ({
	auth: LocalAuthProvider.fromEnv(env),
	data: LocalDataProvider.fromEnv(env),
	storage: LocalStorageProvider.fromEnv(env),
	userProfile: LocalUserProfileProvider.fromEnv(env)
}));
```

**Production or Supabase dev:**

```ts
import { defineConfig } from '@selva/platform/config';
import {
	SupabaseAuthProvider,
	SupabaseDataProvider,
	SupabaseStorageProvider,
	SupabaseUserProfileProvider
} from '@selva/supabase-provider';

export default defineConfig((env) => {
	const data = SupabaseDataProvider.fromEnv(env);
	// Share one ClientBundle across every provider — cheaper + consistent.
	const bundle = data.getClientBundle();
	return {
		auth: SupabaseAuthProvider.fromEnv(env),
		data,
		storage: SupabaseStorageProvider.fromEnv(env),
		userProfile: new SupabaseUserProfileProvider(bundle)
	};
});
```

**Environment-switched (pick at runtime):**

```ts
import { defineConfig } from '@selva/platform/config';
import * as local from 'selva-local-provider';
import * as supa from '@selva/supabase-provider';

export default defineConfig((env) => {
	if (env.SELVA_PROVIDER === 'supabase') {
		const data = supa.SupabaseDataProvider.fromEnv(env);
		return {
			auth: supa.SupabaseAuthProvider.fromEnv(env),
			data,
			storage: supa.SupabaseStorageProvider.fromEnv(env),
			userProfile: new supa.SupabaseUserProfileProvider(data.getClientBundle())
		};
	}
	return {
		auth: local.LocalAuthProvider.fromEnv(env),
		data: local.LocalDataProvider.fromEnv(env),
		storage: local.LocalStorageProvider.fromEnv(env),
		userProfile: local.LocalUserProfileProvider.fromEnv(env)
	};
});
```

---

## Applying the schema

The `supabase/migrations/` directory holds five ordered SQL files:

| File | What it installs |
|---|---|
| `0001_storage_buckets.sql` | RLS policies for `selva-public` / `selva-private` buckets |
| `0002_user_profiles.sql` | `user_profiles` table + `handle_new_auth_user` trigger that auto-seeds profile rows on signup |
| `0003_orgs_projects.sql` | `orgs`, `org_members`, `projects`, `project_members` + helper functions (`is_org_member`, `visible_project`, `has_org_permission`, …) + RLS |
| `0004_definitions.sql` | `definitions`, `definition_history`, and the atomic `increment_run_count(uuid)` RPC |
| `0005_invites_compute.sql` | `invites`, `compute_servers`, `compute_server_defaults`, `compute_server_platform_default` + RLS + `get_invite_by_token` SECURITY DEFINER RPC |

The `supabase/seed.sql` file creates the two storage buckets (`selva-public`, `selva-private`).

**Local:** `npx supabase db reset` applies everything on a fresh DB.

**Hosted:** link the CLI to your project, then push:

```bash
cd packages/supabase-provider

# One-time link. Reads the project-ref from Supabase Dashboard → Project Settings → General.
npx supabase link --project-ref <your-project-ref>

# Review what will be applied.
npx supabase db diff

# Apply migrations + seed.
npx supabase db push
```

Alternatively you can copy each `.sql` file into Supabase Dashboard → **SQL Editor** and run them in order. The CLI path is strongly preferred — it's idempotent and version-controlled.

---

## Development — local Supabase stack

Prerequisite: **Docker Desktop running.** First run pulls ~1 GB of images.

```bash
cd packages/supabase-provider
npx supabase start
```

This spins up Postgres (54322), GoTrue/Auth (54321), Storage, Studio (54323), and Mailpit (54324 — fake SMTP inbox for auth emails). Migrations and the bucket seed apply automatically.

Copy the printed **Publishable** and **Secret** keys into your `.env` at the compute-app or repo root:

```bash
# compute-app .env
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

1. Create a project on [supabase.com](https://supabase.com). Choose a region close to your compute-app deployment.
2. Dashboard → **Project Settings** → **API**. Copy the **Project URL**, **Publishable** key, and **Secret** key.
3. Apply migrations via the CLI:
   ```bash
   cd packages/supabase-provider
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
4. Create the two storage buckets by running `supabase/seed.sql` in the Dashboard → **SQL Editor** (the CLI's `db push` doesn't run the seed on a hosted project — it's dev-only).
5. Set the env vars on your compute-app host (Vercel, Fly.io, Docker, etc.):
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_...
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   ```
   After deploying, register your Rhino.Compute server URL (+ optional API key) via `/admin/compute`.
6. Deploy the compute-app with `selva.config.ts` wired to `@selva/supabase-provider`.
7. Bootstrap the first user:
   - Open `/setup` once — creates the first admin with `platform_admin`.
   - Or manually: Dashboard → **Authentication** → **Add user**, then in the SQL Editor: `UPDATE public.user_profiles SET platform_permissions = ARRAY['platform_admin']::text[] WHERE user_id = '<uuid>';`

### Operational checklist

- **Backups.** Supabase handles daily backups on paid plans; verify restore works before relying on it.
- **Rotate keys** if the Secret key is ever logged or committed. Dashboard → **Project Settings** → **API** → **Reset service_role key**.
- **Row-level security is on for every table.** Disabling it on any table silently breaks the tenant boundary.
- **Email sender.** Dashboard → **Authentication** → **Email templates** — configure an SMTP provider before going live, otherwise password-reset emails route through Supabase's rate-limited dev sender.

---

## Running the conformance tests

The package ships a full conformance suite that runs against a **live** Supabase stack. It proves the provider implements every interface the same way the local provider does.

```bash
cd packages/supabase-provider

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
- **`selva-private`** (private) — `.gh` / `.ghx` files. `getPublicUrl` returns `/api/files/{path}` which the compute-app's route handler must proxy after an auth check.

Images are transcoded to WebP (1200px cap, quality 85) via the shared `transcodeImageIfNeeded` helper from `@selva/platform/storage`. Same bytes out of both providers.

### Auth

`SupabaseAuthProvider.verifyLogin` wraps `supabase.auth.signInWithPassword`, returning the JWT directly as `sessionToken`. `verifyToken` calls `supabase.auth.getUser(token)` — GoTrue validates the signature for us. Platform permissions merge in from `user_profiles.platform_permissions` (auto-created by the signup trigger).

MFA methods on `IPasswordAuth` are currently undefined — MFA is deferred. If a user enrolls a factor via the Supabase dashboard, `signInWithPassword` returns an AAL1 session and routes that gate on AAL2 would fail; no route does today.

### Data + RLS

Every store goes through `ClientBundle.forRequest(ctx)`:

- `ctx.system` → service-role client (bypasses RLS)
- `ctx.adapterContext.sessionToken` → anon client with `Authorization: Bearer <jwt>` (RLS enforces per-user visibility)
- neither → service-role fallback (admin paths)

Helper SQL functions (`is_platform_admin`, `is_org_member`, `visible_project`, `has_org_permission`) are `SECURITY DEFINER` so they evaluate without looping through RLS.

### User profile

`user_profiles` is 1:1 with `auth.users`. The `handle_new_auth_user` trigger inserts a profile row on every signup so the provider never has to fence creation. `starDefinition` / `unstarDefinition` / `recordRun` do read-modify-write — OK for the expected scale; a SECURITY DEFINER RPC would close the race if concurrent starring ever matters.

### Atomic improvements over the local provider

- **`incrementRunCount`** uses a SQL function (`UPDATE … SET run_count = run_count + 1`) — atomic. The local provider does read-modify-write and can lose bumps under concurrent solves.

### Findings

Every abstraction-pressure point hit during implementation is logged in [FINDINGS.md](./FINDINGS.md). Short version: six items, none requiring platform contract changes beyond the Phase 0 set.

---

## Status

Every interface from `@selva/platform` is implemented with passing conformance tests:

- [x] `SupabaseStorageProvider` — 15 tests
- [x] `SupabaseAuthProvider` — 15 tests (incl. MFA-ready `LoginResult`)
- [x] `SupabaseOrgStore` — 12 tests (incl. ctxIsolation)
- [x] `SupabaseProjectStore` — 12 tests (incl. ctxIsolation)
- [x] `SupabaseDefinitionStore` — 18 tests (incl. atomic `incrementRunCount`)
- [x] `SupabaseInviteStore` — 7 tests
- [x] `SupabaseComputeServerStore` — 3 tests
- [x] `SupabaseUserProfileProvider` — 10 tests
- [x] `SupabaseDataProvider` — composition of all five data stores

**92/92 tests green** against a live local Supabase stack.
