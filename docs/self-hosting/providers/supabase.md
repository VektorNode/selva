---
title: Supabase provider
order: 2
published: true
description: 'Auth, Postgres, and Storage on Supabase, with identity living in the provider.'
---

# Supabase provider

`@selvajs/supabase-provider` — Auth + Postgres + Storage in one. Reach for it in production, and for deployments serving several tenants: Postgres row-level security enforces who can see which rows, so one tenant's query cannot return another's data even if the app asks for it.

Use it when you run more than one app instance, need a real database, have several tenants sharing one database, or already run Supabase.

Credentials and identity live in Supabase `auth.users`; Selva holds only authorization data.

## Setup

1. Provision Supabase — hosted (supabase.com) or local (`cd packages/providers/supabase && npx supabase start`).
2. Apply the migrations shipped with the package (`supabase/migrations/`).
3. In `.env`, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. On Supabase CLI v2.95+ these are labelled "Publishable" (`sb_publishable_…`) and "Secret" (`sb_secret_…`); the secret key is server-only.
4. Point the slots at it — `SELVA_AUTH_PROVIDER=supabase` plus the data and storage vars — and restart.

The same code runs against a local Docker stack or a hosted project; only the URL and keys change.

`SELVA_AT_REST_KEY` is still required — it encrypts `compute_servers.api_key` before it reaches the database, and `SupabaseDataProvider` refuses to construct without it. `SELVA_HMAC_KEY` is read by the app to hash share-link and invite tokens; sessions here are Supabase JWTs, not HMAC tokens.

Optional knobs, all documented inline in [`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example): bucket overrides (`SUPABASE_PUBLIC_BUCKET` / `SUPABASE_PRIVATE_BUCKET`, defaulting to `selva-public` / `selva-private`), the proxy prefix for private files (`SUPABASE_PRIVATE_URL_PREFIX`), self-service signup (`SUPABASE_ENABLE_SELF_SIGNUP`, default off) and email-link signup (`SUPABASE_ALLOW_EMAIL_LINK_SIGNUP`), OAuth providers to surface on the login page (`SUPABASE_OAUTH_PROVIDERS`), and JWT verification mode (`SUPABASE_TOKEN_VERIFICATION`, `hybrid` by default, with the recheck window set by `SUPABASE_REVALIDATE_MS`).

### Finding the keys

**Local:** `npx supabase status` prints them — "Publishable" is `SUPABASE_ANON_KEY`, "Secret" is `SUPABASE_SERVICE_ROLE_KEY`.

**Hosted:** Dashboard → **Project Settings** → **API**.

The S3-compat keys under "Storage (S3)" are **not** what you want — those are for external S3 tooling, not for `@supabase/supabase-js`.

## Local development stack

Needs Docker Desktop running; the first run pulls ~1 GB of images.

```bash
cd packages/providers/supabase
npx supabase start
```

That brings up Postgres (54322), GoTrue/Auth (54321), Storage, Studio (54323), and Mailpit (54324 — a fake SMTP inbox for auth emails), and applies the migrations plus the bucket seed automatically. Studio at `http://127.0.0.1:54323` is a full admin UI for inspecting tables, rows, and RLS policies.

```bash
npx supabase status            # show URL + keys again
npx supabase db reset          # wipe DB + re-run migrations + seed
npx supabase stop              # stop containers, keep volumes
npx supabase stop --no-backup  # stop + wipe volumes
```

Then in your `.env`:

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

## Applying the schema

All Selva tables live in a dedicated `selva` schema, never `public`, so a consuming app's own `public.projects` and Selva's `selva.projects` coexist without a clash.

**Local:** `npx supabase db reset` applies everything on a fresh database.

**Hosted:**

```bash
cd packages/providers/supabase
npx supabase link --project-ref <your-project-ref>   # ref: Dashboard → Project Settings → General
npx supabase db diff                                  # review what will be applied
npx supabase db push                                  # apply
```

You can paste each `.sql` file into the Dashboard SQL Editor instead, but prefer the CLI — it records which migrations already ran, so re-running is safe.

`db push` keys on the version prefix recorded in `supabase_migrations.schema_migrations`, applies any file whose prefix isn't recorded yet in filename order, and skips the rest. So **upgrading is always: pull the new migrations, then `db push`.** Gaps and out-of-order prefixes are fine.

The initial migration tells PostgREST to expose the `selva` schema (`alter role authenticator set pgrst.db_schemas = '…, selva'`), so nothing further is needed locally. Do **not** list `selva` in `config.toml`'s `[api] schemas` — PostgREST reads that file at stack boot, before migrations run, and naming a not-yet-created schema there aborts `supabase start`. On a hosted project, confirm `selva` appears under Project Settings → **API** → **Exposed schemas** after the first push; without it every query fails with `PGRST106 Invalid schema` or `PGRST205 schema cache`.

## Production checklist

1. Create a project on [supabase.com](https://supabase.com), in a region close to your Selva deployment.
2. Apply migrations via the CLI (above).
3. Create the two storage buckets by running `supabase/seed.sql` in the Dashboard SQL Editor — `db push` does not run the seed on a hosted project.
4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the three `SELVA_*_PROVIDER=supabase` vars on your host, then deploy.
5. Register your Rhino.Compute server URL and API key at `/admin/compute`.
6. Bootstrap the first admin: open `/setup` once. Or add a user in the Dashboard and run
   `UPDATE selva.user_profiles SET platform_permissions = ARRAY['instance_admin']::text[] WHERE user_id = '<uuid>';`

Then:

- **Backups.** Supabase runs daily backups on paid plans; verify a restore before relying on it.
- **Rotate keys** if the secret key is ever logged or committed: Project Settings → API → Reset service_role key.
- **Row-level security is on for every table.** Disabling it on any table silently breaks the tenant boundary.
- **Email sender.** Configure SMTP under Authentication → Email templates before going live, or password-reset mail routes through Supabase's rate-limited dev sender.

## Installing the migrations in an external app

When you install `@selvajs/supabase-provider` in your own app rather than running it from this repo, the migration SQL ships inside the package. Sync it into your app's own migrations directory and let the Supabase CLI drive it alongside yours:

```bash
npx @selvajs/supabase-provider sync-migrations   # copies into ./supabase/migrations
npx supabase db push
```

Files copy **verbatim** — same timestamped filename, same bytes — because the filename is the migration's identity in the history table. `--dir <path>` targets a different directory; `--force` overwrites a same-named file whose content differs (without it the file is reported as a conflict and the command exits non-zero, leaving your copy untouched). Re-running is idempotent.

Upgrading is the same two commands: `pnpm up @selvajs/supabase-provider`, sync, push. The new file has a later timestamp so it sorts last, and `db push` applies only it — no renumbering, even if your app added migrations in between.

Two things to watch:

- **Reference engine objects by schema.** From your own migrations, write `references selva.orgs(id)`, `selva.is_org_member(org_id)`, `selva.is_instance_admin()`, `selva.set_updated_at()`. Qualified names can't accidentally resolve to a same-named object in your `public`.
- **Storage buckets aren't created by `db push` on a hosted project.** `seed.sql` is dev-only; run it once by hand in the SQL Editor after the first push.

Architecture, RLS internals, and conformance tests: [supabase-provider README](https://github.com/VektorNode/selva/blob/main/packages/providers/supabase/README.md).

## Next

- [Providers overview](./overview.md)
- [Get Started](../get-started/overview.md)
