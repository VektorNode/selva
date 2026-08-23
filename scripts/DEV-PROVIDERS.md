# Testing the three auth providers locally

No VMs. Two of the three run natively; the third needs a local Caddy.

```bash
pnpm dev:local       # filesystem JSON + password auth
pnpm dev:supabase    # Supabase CLI stack (needs Docker)
pnpm dev:header      # forward-auth — the code path Entra reaches (needs Caddy)
```

Each maps to a vite `--mode`, so vite layers `packages/selva/.env.dev-<provider>`
over the base `.env`. Every provider gets its own `DATA_PATH`, so switching never
leaves one provider reading another's store.

These do not replace `pnpm dev:selva`. That one stays the day-to-day server: your
own `.env`, your real compute server, and the `.selva-data/` you have been
building up. These three pin a provider and point at empty throwaway data, which
is what makes them useful for testing and useless for actual work.

The app runs on **`:5273`**, not vite's usual 5173, so it can run alongside
`dev:selva` and any other vite project without a fight. Both ports are
overridable if they still collide:

```bash
SELVA_DEV_PORT=5300 SELVA_DEV_PROXY_PORT=8090 pnpm dev:header
```

`dev:local` and `dev:selva` run the same provider — they differ only in whose
data they open. See [Where the data goes](#where-the-data-goes).

## Entra without Entra

`HeaderAuthProvider` does no crypto and validates no token. It reads three plain
headers — `SELVA-UserPrincipalName`, `SELVA-Email`, `SELVA-DisplayName` — and
trusts them, because in production a locked-down proxy is what sets them.

So there is nothing about Entra to reproduce locally. A Caddy that sets those
three headers exercises byte-for-byte the same code as Entra + oauth2-proxy.
`pnpm dev:header` starts that Caddy on `:8080` and the app on `:5273` — **open
:8080**, not :5273, or you arrive with no identity at all.

The generated `scripts/.dev-caddyfile` keeps production's directive order: strip
inbound `SELVA-*` at site scope, then inject. That ordering is itself a
production footgun (Caddy reorders `request_header` inside a `handle` block), so
the dev config validates it too.

### Installing Caddy

```powershell
winget install CaddyServer.Caddy     # Windows
```

```bash
brew install caddy                   # macOS
sudo apt install caddy               # Debian/Ubuntu
```

Then **open a new terminal** — winget adds Caddy to PATH, but an already-running
shell keeps its old copy of the variable and `pnpm dev:header` will still report
Caddy as missing. Confirm with `caddy version`.

No admin rights needed: the dev config binds `:8080`, and only ports below 1024
are privileged. Nothing is installed as a service and no certificate is issued —
plain HTTP, no ACME, because the dev site is a bare `:8080` with no hostname.

You don't write the Caddyfile. `scripts/dev-provider.mjs` generates
`scripts/.dev-caddyfile` from the chosen persona each run, so editing a persona
is the way to change the injected headers.

### Without Caddy

The script prints a ready-to-paste curl and exits. That works fine against the
app on `:5273` — it just skips the proxy-ordering check, so it exercises
`HeaderAuthProvider` but not the Caddyfile that feeds it:

```bash
curl -H "SELVA-UserPrincipalName: admin@dev.local" \
     -H "SELVA-Email: admin@dev.local" \
     -H "SELVA-DisplayName: Ada Admin" \
     http://localhost:5273/
```

To browse rather than curl, a header-injecting extension (ModHeader and friends)
does the same job. Worth saying once: with no proxy in front, the app trusts
those headers from anything that can reach the port — fine on loopback, and
exactly what the production Caddy exists to prevent.

Start the app for that mode with:

```bash
pnpm --filter @selvajs/selva exec vite dev --mode dev-header --port 5273
```

## Personas

Identities live in `scripts/dev-personas.json`; pick one with `--persona`:

```bash
node scripts/dev-provider.mjs header --persona member
```

`member` has a UPN that differs from its email (`member@dev.onmicrosoft.com` vs
`member@dev.local`) — the Entra shape where UPN ≠ mail, which exercises the
email-fallback and `rebindUpn` branch in `identifyFromHeaders`. `admin` matches
`BOOTSTRAP_INSTANCE_ADMIN_EMAIL` and becomes instance admin; `outsider` is in
neither, for testing rejection.

Caddy holds one persona for its lifetime — switching means restarting the script.

## Where the data goes

```
.selva-data/               ← your existing dev data, from `pnpm dev:selva`
├── auth-users.json
├── definitions/
├── dev-local/             ← pnpm dev:local
├── dev-header/            ← pnpm dev:header
└── dev-supabase/          ← pnpm dev:supabase (created but unused)
```

Each harness provider writes to its own subdirectory, so none of them can read or
corrupt the store you already have at the top level. Delete a subdirectory to
reset that provider to first-run; the app recreates it. `.selva-data/` is already
gitignored, subdirectories included.

`dev-supabase` exists only because `DATA_PATH` must be set — under Supabase every
store is Postgres-backed and the directory stays empty.

**The directory appears on first write, not at boot.** The local stores return
empty on a missing file and only `mkdir -p` when something is saved, so an empty
`.selva-data/dev-local/` after a browse-only session is normal, not a failure.

### What lives in each

Under `dev-local`, the same set as any local-provider deployment: `auth-users.json`
(emails + PBKDF2 hashes), `user-data.json`, org/project/definition JSON,
`compute.config.json`, `invites.json`, `share-links.json`.

Under `dev-header` the shape differs, because header-auth is an **auth-only**
provider with no data layer. Identity is split in two:

- `header-allowlist.json` — who may enter, keyed by UPN. Owned by header-auth.
- `user-data.json` — permissions and profile, keyed by the allowlist row's UUID.
  Owned by the local data provider paired with it.

There is no `auth-users.json`: no passwords exist, because the proxy already
authenticated. An allowlist row materializes on first visit from the headers, and
`email`/`displayName` are re-synced from them on every later visit — so
hand-editing those two fields does not survive the next request.

### DATA_PATH is relative to the CWD, not to the .env file

The harness sets `DATA_PATH=".selva-data/dev-local"` while the base `.env` uses
`"../../.selva-data"`. Both name the same directory, because they are read from
different working directories: `pnpm dev:selva` starts vite in `packages/selva`,
whereas `pnpm dev:local` starts it at the repo root.

Copying the `../../` form into a harness file resolves to `<parent of repo>/.selva-data`
— outside the repo and outside the gitignore. Use a repo-root-relative path in
these files.

## Supabase

`pnpm dev:supabase` runs `supabase start` first and waits for it. Studio is on
`:54423`, and magic-link emails land in Inbucket on `:54424` rather than being
sent.

The API port is **54421**, not the 54321 in Supabase's own docs — set in
`packages/providers/supabase/supabase/config.toml`. (`.env.example:210` and the
provider README still say 54321; they're wrong.)

## Keys

The keys in `.env.dev-*` are dev-only throwaways, and the Supabase ones are the
CLI's published deterministic local keys. They are committed on purpose so the
harness works on checkout. Nothing here is a secret, and nothing here should
ever reach a deployment.
