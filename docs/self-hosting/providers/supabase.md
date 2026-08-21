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
5. For email-link sign-in, point Supabase at an SMTP sender and fix its mail templates.

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

### 6. Set up email sign-in

Skip this if nobody signs in by email link. If they do, it needs both a mail sender and two template edits — the defaults produce a link Selva cannot read.

#### Custom SMTP

Supabase's built-in sender only delivers to your own project members and is capped at a few messages an hour, so production needs your own. Any transactional provider works; Resend is used here.

Verify your sending domain with the provider first — add its SPF and DKIM records to your DNS and wait for the domain to go green. Until then every send is rejected.

Then Dashboard → **Authentication** → **Emails** → **SMTP Settings** → enable custom SMTP:

| Field        | Value                                                       |
| ------------ | ----------------------------------------------------------- |
| Sender email | `no-reply@your-domain.com` — must be at the verified domain |
| Sender name  | `Selva`                                                     |
| Host         | `smtp.resend.com`                                           |
| Port         | `465`, or `587` for STARTTLS                                |
| Username     | `resend`                                                    |
| Password     | your API key                                                |

**Username is the provider's fixed SMTP login, not your sender name or address.** Resend wants the literal string `resend`; SendGrid wants `apikey`. Put anything else there and the send fails AUTH, which reaches Selva as `AuthRetryableFetchError: Error sending magic link email` — a 500 with no hint that a username is at fault. Supabase's **Logs → Auth Logs** shows the underlying `535`.

Enabling custom SMTP also unlocks the template editor, which the next part needs.

#### Redirect URLs

Dashboard → **Authentication** → **URL Configuration**:

- **Site URL** — the origin you serve on, matching `ORIGIN` in `.env`
- **Redirect URLs** — add `https://your-domain.com/auth/email/callback`

GoTrue drops any `emailRedirectTo` not on this list and falls back to Site URL, so a missing entry sends every user to the default landing page instead of the one they asked for.

#### Templates

Dashboard → **Authentication** → **Emails** → **Templates**. Edit **Magic Link**, and switch the Body to **Source**:

```html
<h2>Your sign-in link</h2>
<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink">Sign in</a></p>
```

Do the same for **Confirm signup** with `type=signup` and **Invite user** with `type=invite`. All three land on the same callback and fail the same way if left alone.

Two details in that one line, both of which fail silently:

**`{{ .TokenHash }}`, not `{{ .ConfirmationURL }}`.** The default template uses `ConfirmationURL`, which routes through GoTrue's own `/auth/v1/verify` and lands on your callback with the token in the URL _fragment_ — `#access_token=…`. Fragments never reach the server, so the callback sees no token and returns "This sign-in link is invalid or has expired" for a link that is perfectly valid. Handing over the token hash instead lets the callback exchange it directly.

**`{{ .RedirectTo }}`, not `{{ .SiteURL }}`.** Selva appends `?redirectTo=/library` to the callback URL so the user lands where they were headed before signing in. `RedirectTo` carries that whole URL through; `SiteURL` is the bare origin and discards it. It already includes the path, so append `?token_hash=` straight onto it.

#### Verify

Sign in by email. The link should arrive pointing at `/auth/email/callback?redirectTo=…&token_hash=pkce_…&type=magiclink` — query parameters, no `#`. A `#access_token=` means the template did not save, or the mail predates the change.

### 7. Start

```bash
npm run doctor
npm start
```

`doctor` checks the credentials and compares migration heads, so a green run confirms steps 3 through 5 landed. Then open `/setup` — the first user through becomes instance admin.

Three things `doctor` can't see: the email setup in step 6 — a broken template only shows up when someone clicks a link — `ORIGIN`, which must match the URL you actually serve on or auth cookies won't persist, and that `npm start` binds to `127.0.0.1:3000`, so a public deployment needs Caddy or nginx terminating TLS in front of it.

### Upgrading later

**Migrate first, then update the app.** The updater refuses to finish against a database that is behind: the new version boots, reports `degraded`, fails its health probe for 30 seconds, and rolls back. The site stays up, but you get an outage window and no upgrade.

The migration SQL ships inside `@selvajs/supabase-provider`, so the newer provider has to be on disk before the sync has anything new to copy:

```bash
npm install --prefer-online @selvajs/supabase-provider@latest
npx selva-supabase
npx supabase db push
```

Then run the update.

Skipping the first line is the trap: `selva-supabase` copies from whatever provider version is installed, so with the old one still pinned it reports `0 copied` and `db push` says `Remote database is up to date` — both look like success, and neither did anything.

`db push` applies only what the database hasn't recorded yet, and `npm run doctor` tells you an upgrade is pending — it reports the expected head against the actual one. Running the migrations while the older app is still serving is safe; they are additive.

A sync may report `conflict` on a file you already have. It is refusing to overwrite an already-applied migration, which is correct — rewriting one would break the history it is recorded under. Diff the two copies before reaching for `--force`; a difference that is only comments or whitespace is harmless.

Full setup, env vars, migrations, and RLS notes: [supabase-provider README](https://www.npmjs.com/package/@selvajs/supabase-provider).

## Local development stack

Needs Docker Desktop running; the first run pulls ~1 GB of images.

```bash
cd packages/providers/supabase
npx supabase start
```

That brings up Postgres (54322), GoTrue/Auth (54321), Storage, Studio (54323), and Mailpit (54324 — a fake SMTP inbox for auth emails), and applies the migrations plus the bucket seed automatically. Studio at `http://127.0.0.1:54323` is a full admin UI for inspecting tables, rows, and RLS policies.

Auth emails go to Mailpit rather than a real inbox, so magic-link sign-in works locally with no SMTP setup. The template traps from step 6 still apply, and `config.toml` ships no template overrides — a link clicked out of Mailpit fails exactly as it would in production. To exercise the real flow locally, add the template and callback URL to `config.toml` under `[auth.email.template.magic_link]` and `additional_redirect_urls`, then `npx supabase stop && npx supabase start` to reload it.

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
