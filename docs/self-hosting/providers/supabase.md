---
title: Supabase provider
order: 2
published: false
description: 'Auth, Postgres, and Storage on Supabase, with identity living in the provider.'
---

# Supabase provider

`@selvajs/supabase-provider`: Auth + Postgres + Storage in one. Reach for it in production, and for deployments serving several tenants: the database itself enforces who can see which rows, so one tenant's query cannot return another's data even if the app asks for it. Postgres calls this row-level security, or RLS.

## When to use it

- You run more than one app instance, or you need a real database.
- Several tenants share the database and must not see each other's rows.
- You already run Supabase (hosted or self-hosted).

## Setup at a glance

1. Provision Supabase, hosted (supabase.com) or local (`npx supabase start`).
2. Apply the migrations shipped with the package.
3. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
4. Set `SELVA_AUTH_PROVIDER=supabase` (and the data/storage vars) and restart.

The same code runs against a local Docker stack or a hosted project. Only the URL and keys change.

## Setting up a hosted project

Step 2 above — applying the migrations — is a manual step, and the one that catches people out. The CLI writes your credentials to `.env` and starts the app; it never creates tables. An app pointed at an empty database connects fine, then fails its health check, because it compares the database's migration head against the version it ships with and refuses to serve on a mismatch.

So do the schema first, then scaffold.

### 1. Collect the credentials

Supabase Dashboard → **Project Settings**:

| Value           | Where                                               | Goes to                     |
| --------------- | --------------------------------------------------- | --------------------------- |
| Project URL     | **Data API** (older dashboards: **API**)            | `SUPABASE_URL`              |
| Publishable key | **API Keys**                                        | `SUPABASE_ANON_KEY`         |
| Secret key      | **API Keys** → reveal                               | `SUPABASE_SERVICE_ROLE_KEY` |
| Reference ID    | **General** — also the subdomain of the project URL | `--project-ref`             |

The project URL is the bare origin: `https://<ref>.supabase.co`, no path. The Data API page displays it with `/rest/v1/` appended — that's the PostgREST endpoint, not this value. Include the suffix and every request doubles it up into `/rest/v1/rest/v1/…`.

The secret key bypasses row-level security, so it stays server-side. Never ship it to a browser.

### 2. Scaffold the deployment

```bash
npx @selvajs/cli my-deployment
cd my-deployment
```

Choose `supabase` for auth, data, and storage, and paste the three values when prompted. This writes `.env` and nothing else.

### 3. Apply the schema

Selecting a Supabase provider makes the scaffold depend on `@selvajs/supabase-provider`, which carries the migration SQL. Copy it into your deployment, then let the Supabase CLI apply it:

```bash
npx selva-supabase                   # copies into ./supabase/migrations
npx supabase link --project-ref <your-ref>
npx supabase db push
```

Substitute your own project ref for `<your-ref>` — the shell reads angle brackets as redirection and fails on them.

`selva-supabase` takes no subcommand — copying the migrations is all it does. It prints one line per file and ends with a count; re-running it is safe, since unchanged files are skipped.

#### Why this needs a second credential

The three keys in `.env` don't authenticate `db push`, and this catches most people out:

| Credential                                              | What it is                      | What it does                            |
| ------------------------------------------------------- | ------------------------------- | --------------------------------------- |
| `SUPABASE_URL` + `SUPABASE_ANON_KEY` + service-role key | **Project** keys, set by `.env` | Let the running app read and write data |
| `SUPABASE_ACCESS_TOKEN`                                 | An **account** credential       | Lets the Supabase CLI change schemas    |

The service-role key can't stand in for the account credential: `db push` connects over Postgres and records applied versions in a migration-history table, which a REST key cannot reach. So authenticate once, either way — they are alternatives, not steps:

```bash
npx supabase login                     # browser: prints a URL, you paste back a code
# ── or ──
export SUPABASE_ACCESS_TOKEN=sbp_...   # no browser; create at
                                       # https://supabase.com/dashboard/account/tokens
```

`supabase login` stores its credential in `~/.supabase`, **outside the deployment directory** — so it survives rescaffolding the deployment, and you only do it once per machine. Over SSH with no browser, either paste the printed URL into a browser on any other machine and type the code back, or use the token and skip the handshake.

`link` may then ask for the project's database password — set when the project was created, resettable under Dashboard → **Project Settings** → **Database**.

None of this has to run on the deployment host. `db push` connects to Supabase, not to your app, so a workstation with the repo checked out works just as well.

`Remote database is up to date` means the schema was already applied — success, not an error. You'll see it if you re-link a project you pushed to earlier.

If `npx selva-supabase` fails with a 404 from the npm registry, the package isn't installed — check `node_modules/@selvajs/supabase-provider` exists and run `npm install` if it doesn't.

### 4. Create the storage buckets

`db push` skips `seed.sql` on hosted projects — the seed is a local-dev convenience. Paste the contents of `node_modules/@selvajs/supabase-provider/supabase/seed.sql` into Dashboard → **SQL Editor** and run it once. It creates `selva-public` and `selva-private`, and re-running it is harmless.

Skip this and the app runs until someone uploads a file.

### 5. Verify the schema is exposed

Dashboard → **Project Settings** → **API** → **Exposed schemas**. `selva` should be listed next to `public`.

The initial migration sets this, so it's normally already correct. It's worth a look anyway: if the schema isn't exposed, every query fails with `PGRST106 Invalid schema` — a runtime error that looks nothing like its cause.

### 6. Start

```bash
npm run doctor
npm start
```

`doctor` checks the credentials and compares migration heads, so a green run confirms steps 3 through 5 landed. Then open `/setup` — the first user through becomes instance admin.

Two things `doctor` can't see: `ORIGIN` must match the URL you actually serve on or auth cookies won't persist, and `npm start` binds to `127.0.0.1:3000`, so a public deployment needs Caddy or nginx terminating TLS in front of it.

### Upgrading later

When a Selva upgrade ships new migrations, repeat the sync and push:

```bash
npx selva-supabase
npx supabase db push
```

`db push` applies only what the database hasn't recorded yet. `npm run doctor` is what tells you an upgrade is pending — it reports the expected head against the actual one.

Full setup, env vars, migrations, and RLS notes: [supabase-provider README](https://www.npmjs.com/package/@selvajs/supabase-provider).

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

## Next

- [Providers overview](./overview.md)
- [Get Started](../get-started/overview.md)
