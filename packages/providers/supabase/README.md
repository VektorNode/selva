# @selvajs/supabase-provider

Supabase (Auth + Postgres + Storage) implementation of the `@selvajs/platform` interfaces — `IAuthProvider`, `IDataProvider`, `IStorageProvider`.

Runs against **either** a managed Supabase project or a local Supabase CLI stack in Docker — same code, different `SUPABASE_URL` and keys.

**Operator setup — provisioning, env vars, migrations, production checklist:** [docs/self-hosting/providers/supabase.md](../../../docs/self-hosting/providers/supabase.md).

---

## Usage

```ts
import { defineConfig } from '@selvajs/platform';
import {
	SupabaseAuthProvider,
	SupabaseDataProvider,
	SupabaseStorageProvider
} from '@selvajs/supabase-provider';

export default defineConfig((env) => ({
	auth: SupabaseAuthProvider.fromEnv(env),
	data: SupabaseDataProvider.fromEnv(env),
	storage: SupabaseStorageProvider.fromEnv(env)
}));
```

The Selva app already bundles this wiring — it picks a provider per interface from `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` via `createSelvaProviders` ([create-selva-providers.ts](../../server/src/providers/create-selva-providers.ts)) over the registry in [providers.server.ts](../../selva/src/lib/server/providers.server.ts). For a provider not bundled in the app, point `SELVA_CONFIG_PATH` at an external `selva.config.js` — an actual `.js` file, since there's no TS compiler at runtime.

`SupabaseDataProvider.fromEnv` refuses to construct without `SELVA_AT_REST_KEY`; it encrypts `compute_servers.api_key` before it reaches the database.

---

## Migrations

`supabase/migrations/` holds timestamp-prefixed files applied in filename order. **That directory is authoritative** — don't expect a list here to stay current.

`20260425155514_selva_initial.sql` installs the foundation: the `selva` schema itself, `user_profiles` (+ the `handle_new_auth_user` auto-seed trigger), `orgs` / `org_members` / `projects` / `project_members` (+ RLS helpers), `definitions` / `definition_versions` (+ deletion-protection FKs and the atomic `increment_run_count` RPC), `invites` (+ `get_invite_by_token`), `compute_servers`, `share_links` (+ `try_increment_share_link_solve_count`), and the `selva-public` / `selva-private` storage policies. Everything after it layers on top — cached version schemas, solve metrics, org assets, definition status/audit, erasure functions.

New schema changes go in new files named `<UTCtimestamp>_selva_<name>.sql` (`date -u +%Y%m%d%H%M%S` for the prefix). The `_selva_` infix and timestamp prefix let a consuming app's own migrations interleave by time without ever colliding with Selva's.

`supabase/seed.sql` creates the two storage buckets. It is dev-only — the CLI does not run it on a hosted project.

**No backfill is required for the schema-caching migration.** Existing definition versions keep working (the app falls back to fetching their schema from Rhino.Compute), and each version's `schema` column fills in lazily the first time it's solved.

The packaged migrations reach a consuming app through the `selva-supabase` bin ([src/cli/sync-migrations.ts](src/cli/sync-migrations.ts)), which copies them verbatim into the app's own `supabase/migrations/`. See the [operator page](../../../docs/self-hosting/providers/supabase.md#installing-the-migrations-in-an-external-app) for the flow.

---

## Architecture notes

### Storage

Two buckets:

- **`selva-public`** (public) — covers, archives. `getPublicUrl` returns the direct CDN URL.
- **`selva-private`** (private) — `.gh` / `.ghx` files. `getPublicUrl` returns `/api/files/{path}`, which the selva app's route handler proxies after an auth check.

Images are transcoded to WebP (1200px cap, quality 85) via the shared `transcodeImageIfNeeded` helper from `@selvajs/platform/storage`. Same bytes out of both providers.

### Auth

`SupabaseAuthProvider.verifyLogin` wraps `supabase.auth.signInWithPassword`, returning the JWT directly as `sessionToken`. `verifyToken` calls `supabase.auth.getUser(token)` — GoTrue validates the signature for us. Platform permissions merge in from `user_profiles.platform_permissions`.

MFA methods on `IPasswordAuth` are currently undefined — MFA is deferred. If a user enrolls a factor via the Supabase dashboard, `signInWithPassword` returns an AAL1 session and routes that gate on AAL2 would fail; no route does today.

### Data + RLS

Every client is constructed with `db: { schema: 'selva' }`, so a bare `client.from('orgs')` resolves to `selva.orgs`. Every store goes through `ClientBundle.forRequest(ctx)` ([src/data/client.ts](src/data/client.ts)):

- `ctx.system` → service-role client (bypasses RLS)
- `ctx.adapterContext.sessionToken` → anon client with `Authorization: Bearer <jwt>` (RLS enforces per-user visibility)
- neither → anon client (RLS active, no `auth.uid()`) — fail-closed. Service-role is opt-in via `ctx.system`, never derived from a missing session.

Helper SQL functions (`selva.is_instance_admin`, `selva.is_org_member`, `selva.visible_project`, `selva.has_org_permission`) are `SECURITY DEFINER` with `search_path = selva, public, extensions` so they evaluate without looping through RLS.

### User profile

`user_profiles` is 1:1 with `auth.users`. The `handle_new_auth_user` trigger inserts a profile row on every signup so the provider never has to fence creation. `starDefinition` / `unstarDefinition` / `recordRun` do read-modify-write — OK for the expected scale; a SECURITY DEFINER RPC would close the race if concurrent starring ever matters.

### Atomic improvements over the local provider

- **`incrementRunCount`** uses a SQL function (`UPDATE … SET run_count = run_count + 1`) — atomic. The local provider does read-modify-write and can lose bumps under concurrent solves.
- **`try_increment_share_link_solve_count`** enforces a share link's cap in one statement, so concurrent solves can't overshoot it.

### Erasure

`SupabaseDataProvider.onUserDeleted(ctx, userId, { email })` scrubs what FK cascade doesn't reach: deletes `audit_events` the user authored (keyed by plain-text `actor_id`), deletes `invites` addressed to their email, redacts that email from surviving `invite.created` payloads (`redact_audit_event_email`), and tombstones `solve_metrics.actor_id` so capacity aggregates survive while the person doesn't. The caller must capture the email **before** `SupabaseAuthProvider.deleteUser` runs. Credentials live in Supabase `auth.users`, but the operator is still the data controller for everything above — see [CLAUDE.md](../../../CLAUDE.md#data-privacy).

---

## Conformance tests

The package ships the `@selvajs/platform` conformance suites running against a **live** Supabase stack. They prove this provider implements every interface the same way the local provider does.

```bash
cd packages/providers/supabase
npx supabase start

cat > .env.test <<EOF
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key>
EOF

pnpm test
```

`.env.test` is gitignored and separate from your app's `.env`. `vitest.config.ts` loads it if present and probes `SUPABASE_URL` before the run; if the file is missing or the stack is unreachable it strips the three vars so every suite takes its no-credentials skip path and prints a warning.

The suites wipe every table and every auth user between tests — **do not point them at a production project.**
