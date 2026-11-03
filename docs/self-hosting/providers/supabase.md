---
title: Supabase provider
order: 2
published: false
description: 'Auth, Postgres, and Storage on Supabase, with identity living in the provider.'
---

# Supabase provider

`@selvajs/supabase-provider`: Auth + Postgres + Storage in one. Reach for it in production, with more than one app instance, and for deployments serving several tenants: the database itself enforces who can see which rows, so one tenant's query cannot return another's data even if the app asks for it. Postgres calls this row-level security, or RLS.

## Setting up a hosted project

Applying the migrations (step 3) is manual, and the step that catches people out. The CLI scaffolds the deployment and writes your credentials to `.env`; it never creates tables and doesn't start the app. An app pointed at an empty database connects fine, then fails its health check, because it compares the database's migration head against the version it ships with and refuses to serve on a mismatch.

### 1. Collect the credentials

Supabase Dashboard → **Project Settings**:

| Value           | Where                                               | Goes to                     |
| --------------- | --------------------------------------------------- | --------------------------- |
| Project URL     | **Data API** (older dashboards: **API**)            | `SUPABASE_URL`              |
| Publishable key | **API Keys**                                        | `SUPABASE_ANON_KEY`         |
| Secret key      | **API Keys** → reveal                               | `SUPABASE_SERVICE_ROLE_KEY` |
| Reference ID    | **General** (also the subdomain of the project URL) | `--project-ref`             |

The project URL is the bare origin: `https://<ref>.supabase.co`, no path. The Data API page displays it with `/rest/v1/` appended; that's the PostgREST endpoint, not this value. Include the suffix and every request doubles it up into `/rest/v1/rest/v1/…`.

The secret key bypasses row-level security, so it stays server-side. Never ship it to a browser.

### 2. Scaffold the deployment

```bash
npx @selvajs/cli my-deployment
cd my-deployment
```

Choose `supabase` for auth, data, and storage, and paste the three values when prompted. The scaffold writes `package.json`, `.env` and `ecosystem.config.cjs`, then runs `npm install`.

### 3. Apply the schema

Selecting a Supabase provider makes the scaffold depend on `@selvajs/supabase-provider`, which carries the migration SQL. Copy it into your deployment, then let the Supabase CLI apply it:

```bash
npx selva-supabase                   # copies into ./supabase/migrations
npx supabase link --project-ref <your-ref>
npx supabase db push
```

Substitute your own project ref for `<your-ref>`: the shell reads angle brackets as redirection and fails on them.

`selva-supabase` takes no subcommand; copying the migrations is all it does. It prints a line per copied or conflicting file and ends with a count. Unchanged files are skipped silently, so re-running is safe.

#### Why this needs a second credential

The three keys in `.env` are **project** keys: they let the running app read and write data. `db push` needs an **account** credential to change schemas, and this catches most people out. The service-role key can't stand in for it: `db push` connects over Postgres and records applied versions in a migration-history table, which a REST key cannot reach. Authenticate once, either way; they are alternatives, not steps:

```bash
npx supabase login                     # browser: prints a URL, you paste back a code
# ── or ──
export SUPABASE_ACCESS_TOKEN=sbp_...   # no browser; create at
                                       # https://supabase.com/dashboard/account/tokens
```

`supabase login` stores its credential in `~/.supabase`, **outside the deployment directory**, so it survives rescaffolding the deployment, and you only do it once per machine. Over SSH with no browser, either paste the printed URL into a browser on any other machine and type the code back, or use the token and skip the handshake.

`link` may then ask for the project's database password (set when the project was created, resettable under Dashboard → **Project Settings** → **Database**).

None of this has to run on the deployment host. `db push` connects to Supabase, not to your app, so a workstation with the repo checked out works just as well.

`Remote database is up to date` means the schema was already applied: success, not an error. You'll see it if you re-link a project you pushed to earlier.

If `npx selva-supabase` fails with a 404 from the npm registry, the package isn't installed. Check `node_modules/@selvajs/supabase-provider` exists and run `npm install` if it doesn't.

### 4. Create the storage buckets

`db push` skips `seed.sql` on hosted projects: the seed is a local-dev convenience. Paste the contents of `node_modules/@selvajs/supabase-provider/supabase/seed.sql` into Dashboard → **SQL Editor** and run it once. It creates `selva-public` and `selva-private`, and re-running it is harmless.

Skip this and the app runs until someone uploads a file.

### 5. Verify the schema is exposed

Dashboard → **Project Settings** → **API** → **Exposed schemas**. `selva` should be listed next to `public`.

The initial migration sets this, so it's normally already correct. It's worth a look anyway: if the schema isn't exposed, every query fails with `PGRST106 Invalid schema`, a runtime error that looks nothing like its cause.

### 6. Set up email sign-in

Skip this if nobody signs in by email link. If they do, it needs both a mail sender and two template edits: the defaults produce a link Selva cannot read.

#### Custom SMTP

Supabase's built-in sender only delivers to your own project members and is capped at a few messages an hour, so production needs your own. Any transactional provider works; Resend is used here.

Verify your sending domain with the provider first: add its SPF and DKIM records to your DNS and wait for the domain to go green. Until then every send is rejected.

Then Dashboard → **Authentication** → **Emails** → **SMTP Settings** → enable custom SMTP. The sender email must be an address at the verified domain, such as `no-reply@your-domain.com`. For Resend, the host is `smtp.resend.com`, the port `465` (or `587` for STARTTLS), and the password your API key.

**Username is the provider's fixed SMTP login, not your sender name or address.** Resend wants the literal string `resend`; SendGrid wants `apikey`. Put anything else there and the send fails AUTH, which reaches Selva as `AuthRetryableFetchError: Error sending magic link email`, a 500 with no hint that a username is at fault. Supabase's **Logs → Auth Logs** shows the underlying `535`.

Enabling custom SMTP also unlocks the template editor, which the next part needs.

#### Redirect URLs

Dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: the origin you serve on, matching `ORIGIN` in `.env`, with no trailing slash
- **Redirect URLs**: add `https://your-domain.com/auth/email/callback`

GoTrue drops any `emailRedirectTo` not on this list and falls back to Site URL, so a missing entry sends every user to the default landing page instead of the one they asked for.

#### Templates

Dashboard → **Authentication** → **Emails** → **Templates**. Edit **Magic Link**, and switch the Body to **Source**:

```html
<h2>Your sign-in link</h2>
<p>Follow the link below to sign in. This link expires shortly and can only be used once.</p>
<p>
	<a href="{{ .SiteURL }}/auth/email/callback?token_hash={{ .TokenHash }}&type=magiclink"
		>Sign in</a
	>
</p>
```

Do the same for **Confirm signup** with `type=signup`. Both land on the same callback and fail the same way if left alone. Selva mints its own invites and never calls Supabase's invite endpoint, so **Invite user** needs no edit.

Two details in that one line, both of which fail silently:

**`{{ .TokenHash }}`, not `{{ .ConfirmationURL }}`.** The default template uses `ConfirmationURL`, which routes through GoTrue's own `/auth/v1/verify` and lands on your callback with the token in the URL _fragment_: `#access_token=…`. Fragments never reach the server, so the callback sees no token and returns "This sign-in link is invalid or has expired" for a link that is perfectly valid. Handing over the token hash instead lets the callback exchange it directly.

**`{{ .SiteURL }}`, not `{{ .RedirectTo }}`.** Selva passes its callback URL as `emailRedirectTo`, and that URL already carries `?redirectTo=<page>` whenever the user was sent to sign in from another page (always from `/setup`). `{{ .RedirectTo }}?token_hash=…` then has a second `?`, so `token_hash` lands inside the `redirectTo` value and the callback finds no token. Appending with `&` breaks the plain `/login` link instead. `SiteURL` is the bare origin, so the link has one shape in every case. The cost: the user lands on `/library` rather than the page they were headed to. Unverified: whether GoTrue keeps the query string in `{{ .RedirectTo }}`.

#### Verify

Sign in by email. The link should arrive pointing at `/auth/email/callback?token_hash=pkce_…&type=magiclink`: query parameters, no `#`. A `#access_token=` means the template did not save, or the mail predates the change.

### 7. Start

```bash
npm run doctor
npm start
```

`doctor` checks the credentials and compares migration heads, so a green run confirms the keys work and the schema from step 3 is at the expected head. Then open `/setup`: the first user through becomes instance admin.

Three things `doctor` can't see: the buckets from step 4; the email setup in step 6 (a broken template only shows up when someone clicks a link); and `ORIGIN`, which must match the URL you serve on, or form posts get a 403 and email callbacks point at the wrong host.

`npm start` binds `0.0.0.0` unless the scaffold set `HOST=127.0.0.1` (it does when you give an origin, or choose header auth). Set `HOST=127.0.0.1` yourself otherwise, keep port 3000 closed in the firewall, and put Caddy or nginx terminating TLS in front ([Reverse proxy](../deployment/reverse-proxy.md)).

### Upgrading later

**Migrate first, then update the app.** Against a database that is behind, the new version boots `degraded`: `/api/health` returns 503 and writes that need the new schema fail. The admin center's **Run update** rolls back after 30 seconds of failed health probes. `npm run update` keeps the new version running and exits with the migration commands to run.

The migration SQL ships inside `@selvajs/supabase-provider`, so the newer provider has to be on disk before the sync has anything new to copy:

```bash
npm install --prefer-online @selvajs/supabase-provider@latest
npx selva-supabase
npx supabase db push
```

On the beta channel, install `@selvajs/supabase-provider@beta` instead. `latest` is the stable line and ships none of the beta's migrations.

Then run the update.

Skipping the first line is the trap: `selva-supabase` copies from whatever provider version is installed, so with the old one still pinned it reports `0 copied` and `db push` says `Remote database is up to date`. Both look like success, and neither did anything.

`db push` applies only what the database hasn't recorded yet, and `npm run doctor` tells you an upgrade is pending: it reports the expected head against the actual one.

The migrations are not all additive. The `20261101*` set revokes `EXECUTE` on `selva` functions, revokes `UPDATE` on `invites` and `SELECT` on `compute_servers` (re-granting only some columns), replaces RLS policies, and makes the owner column on `orgs`, `projects` and `definitions`, and the uploader column on `definition_versions`, nullable with `ON DELETE SET NULL`. An older app that relies on a privilege or policy this removes fails until it is updated. Run `db push` right before the app update, or schedule a short window.

A sync may report `conflict` on a file you already have. It is refusing to overwrite an already-applied migration, which is correct: rewriting one would break the history it is recorded under. Diff the two copies before reaching for `--force`; a difference that is only comments or whitespace is harmless.

Full setup, env vars, migrations, and RLS notes: [supabase-provider README](https://www.npmjs.com/package/@selvajs/supabase-provider).

## API tokens

Row security only sees a signed-in user, and an API-token request has no session. For each one, Selva signs a session for the token's owner that lasts the solve deadline (`COMPUTE_SOLVE_DEADLINE_MS`) plus a minute, after checking the owner is still enabled and still a member of the token's org. That needs a signing key the project trusts. Without one, API tokens answer 503 and can't be created; browser sign-in keeps working. **Admin → System** shows whether the key works.

**The key is a root credential.** It can sign a `service_role` token that bypasses every policy, so store it like `SUPABASE_SERVICE_ROLE_KEY`: server-only, never in a client bundle, rotated if it leaks.

### Hosted project

1. Generate a key: `npx supabase gen signing-key --algorithm ES256`. Keep the printed JWK in your secret store.
2. In the dashboard, **Settings → JWT signing keys**, import it as a standby key.
3. **Rotate** to it. Supabase only trusts a standby key after the rotation, and from then on it also signs every user session. Key changes are throttled for about five minutes.
4. Put the JWK on one line in `SUPABASE_JWT_SIGNING_KEY` and restart Selva.

To rotate later: import the new key and rotate to it, update `SUPABASE_JWT_SIGNING_KEY` and restart, and only then revoke the old key. Revoking first turns API tokens off until Selva has the new key.

### Self-hosted stack

Run `sh utils/add-new-auth-keys.sh --update-env`, then `sh run.sh recreate`. Copy the `"kty": "EC"` entry from `JWT_KEYS` into `SUPABASE_JWT_SIGNING_KEY`. Regenerating the keys signs everyone out, so rotate in a maintenance window and update Selva in the same one.

### Legacy HS256 secret

A project that never moved to signing keys can set `SUPABASE_JWT_SECRET` to its legacy JWT secret instead. It stops working the moment the project revokes that secret, which Supabase's own migration guide tells you to do, so treat it as a stopgap. The local CLI stack runs on it.

## Local development stack

For contributors: `npx supabase start` in `packages/providers/supabase` (Docker required). `pnpm dev:supabase` and the ports are in [DEV-PROVIDERS.md](https://github.com/VektorNode/selva/blob/main/scripts/DEV-PROVIDERS.md). The API is on `http://127.0.0.1:54421`, not Supabase's default 54321.

Auth emails go to Mailpit (port 54424) instead of a real inbox. `config.toml` ships no template overrides, so the template traps from step 6 still apply: a link clicked out of Mailpit fails exactly as it would in production. To exercise the real flow, add the template under `[auth.email.template.magic_link]` and the callback URL under `additional_redirect_urls` in `config.toml`, then `npx supabase stop && npx supabase start` to reload it.

## Next

- [Providers overview](./overview.md)
- [Get Started](../get-started/overview.md)
