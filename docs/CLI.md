# Selva CLI

Two binaries ship with a Selva deployment:

- **`@selvajs/cli`** — scaffolds a new deployment. Run once with `npx`.
- **`selva`** — operates an existing deployment. Installed into `node_modules/.bin/` by the scaffold; also exposed as `npm run <name>` scripts.

This doc is the operator-facing reference. For development workflows (working on Selva itself), see [QuickStart.md](QuickStart.md). For shipping a fix to a live deployment, see [Hotfix-CLI-Runtime.md](Hotfix-CLI-Runtime.md).

---

## Quick tour

From zero to a running deployment:

```bash
# 1. Scaffold. Prompts for provider choice, secrets, ORIGIN, etc.
npx @selvajs/cli my-deployment
cd my-deployment

# 2. Sanity-check the install before starting.
npm run doctor

# 3. Start under PM2.
npm start

# 4. Tail the logs.
npm run logs
```

When a new version of `@selvajs/selva` ships:

```bash
npm run update          # bumps @selvajs/* and restarts under PM2
```

That's the full happy path. Everything below is the per-command reference for when something needs more attention.

---

## `npx @selvajs/cli <dir>`

Scaffolds a fresh deployment into `<dir>`. Walks an interactive prompt for provider choice (auth/data/storage), origin, tenancy, and provider-specific config; generates secrets; runs `npm install`; copies templates from the installed runtime.

```bash
npx @selvajs/cli my-deployment
npx @selvajs/cli my-deployment --force          # overwrite a non-empty dir
npx @selvajs/cli my-deployment --skip-install   # no npm install (you'll need to run it later)
```

What lands in `<dir>`:

| File                   | Purpose                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`                 | Merged from runtime's `.env.example` plus your prompt answers. Contains `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` — back this up before anything else. Provider selection lives here (`SELVA_AUTH_PROVIDER` etc.). |
| `ecosystem.config.cjs` | PM2 process definition.                                                                                                                                                                                           |
| `package.json`         | Pins `@selvajs/selva` + `@selvajs/cli` + `pm2`. Providers are bundled into `@selvajs/selva`.                                                                                                                      |
| `.selva-version`       | Marker for future CLI migrations.                                                                                                                                                                                 |

Notes:

- Secrets are generated **once**. `selva init` won't regenerate them; use `selva keys rotate` if you actually need to rotate.
- `npm install` here is the only place that creates `node_modules/`. If it fails, the scaffold prints the last 80 lines of npm output so you don't have to fish through `~/.npm/_logs/`.
- The CLI templates live inside `@selvajs/selva` — there's no separate template package to keep in sync.

For env-var documentation, see [packages/selva/.env.example](../packages/selva/.env.example) — it's the authoritative reference.

---

## `selva` reference

All commands must run from the deployment directory (the one containing `.env` and `package.json`). They refuse to run elsewhere with a clear error.

### `selva init`

Re-prompts for configuration and rewrites `.env`. Uses the existing `.env` as defaults, so re-running with all defaults is a no-op.

- Does **not** regenerate `SELVA_HMAC_KEY` / `SELVA_AT_REST_KEY` if they're already set. (Use `selva keys rotate` for that.)
- Does **not** touch `package.json` or run `npm install`. If you need to add a provider, install it manually first (`npm install @selvajs/<provider>`) and then run init.
- Restart afterwards: `selva restart`.

### `selva doctor`

Validates the deployment without starting it. Exits 0 on success, 1 on any red check.

Checks:

- `.env` and `ecosystem.config.cjs` exist
- Layout drift (legacy provider packages still listed, stale `selva.config.js`, `ecosystem.config.cjs` pointing at `@selvajs/runtime`)
- `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` are 32-byte hex (not the placeholder)
- `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` are valid combinations
- `SELVA_TENANCY` is `single` or `multi`
- `DATA_PATH` is writable (when local provider is in use)
- `SUPABASE_URL` is reachable (when supabase provider is in use; soft-fails to yellow on network errors)
- `@selvajs/selva` is installed
- `ORIGIN` is a valid URL (or yellow if unset; required behind a reverse proxy)
- Header-auth specifics: allowlist file, `HOST` binding, logout URL

Run it after editing `.env` or after a `selva update`. Treat any red as a hard failure — the runtime won't start cleanly.

### `selva start`

`pm2 start ecosystem.config.cjs`. Boots the selva app under PM2.

The first run also seeds PM2's process list. If PM2 itself isn't installed, the CLI tells you to `npm install pm2` in the deployment directory (a global install isn't required — it falls back to `node_modules/.bin/pm2`).

### `selva stop`

`pm2 stop selva-compute`.

### `selva restart`

`pm2 restart selva-compute --update-env`.

The `--update-env` flag is the whole reason this wrapper exists: a plain `pm2 restart` keeps the _old_ environment, which means your edits to `.env` silently don't apply. Always use `selva restart`, never raw `pm2 restart`.

### `selva logs`

`pm2 logs selva-compute`. Tails stdout and stderr. Extra args pass through to `pm2 logs` (e.g. `selva logs --lines 200`).

### `selva update`

Refreshes all `@selvajs/*` packages and restarts under PM2.

```
npm update --save @selvajs/cli @selvajs/selva @selvajs/platform \
                  @selvajs/local-provider @selvajs/supabase-provider \
                  @selvajs/header-auth-provider
pm2 restart selva-compute --update-env
```

Prints the runtime version before and after so you can tell whether anything actually changed. The admin UI's "Run Update" button runs the same list — if you maintain both, keep them in sync.

If the "before" and "after" runtime versions are identical despite a known new release, you've hit npm's stale-packument cache. The recovery is documented in [Hotfix-CLI-Runtime.md](Hotfix-CLI-Runtime.md#the-stale-packument-cache-trap) — short version:

```bash
npm cache clean --force
rm -rf node_modules package-lock.json
npm install --prefer-online
selva restart
```

### `selva keys rotate <hmac|at-rest>`

Generates a fresh secret and writes it back to `.env`. Always asks for confirmation — the blast radius is non-trivial.

| Target    | Env var             | What rotation breaks                                                                                                                                                |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hmac`    | `SELVA_HMAC_KEY`    | Logs every signed-in user out. Invalidates share-link / invite tokens that fell back to this key (only when `SHARE_LINK_SECRET` / `INVITE_TOKEN_SECRET` are unset). |
| `at-rest` | `SELVA_AT_REST_KEY` | Encrypted Rhino.Compute API key in `compute.config.json` becomes undecryptable. You'll have to re-enter it at `/admin/compute`.                                     |

Restart the app afterwards: `selva restart`.

### `selva help`, `selva --version`

Self-explanatory. `--version` reads from the installed `@selvajs/cli`'s own `package.json`.

---

## NPM script aliases

The scaffold writes shorter aliases into the deployment's `package.json` so you don't need to remember `./node_modules/.bin/selva`:

| `npm run …`       | Runs            |
| ----------------- | --------------- |
| `npm start`       | `selva start`   |
| `npm run stop`    | `selva stop`    |
| `npm run restart` | `selva restart` |
| `npm run logs`    | `selva logs`    |
| `npm run doctor`  | `selva doctor`  |
| `npm run update`  | `selva update`  |

`init` and `keys rotate` aren't aliased — they're rare enough that the explicit `selva` invocation keeps them visible.

---

## Where things live

- CLI source: [packages/cli/src/](../packages/cli/src/) (plain JS, no build step)
- Runtime templates (the files copied into a fresh deployment): [packages/selva/templates/](../packages/selva/templates/)
- Env-var reference: [packages/selva/.env.example](../packages/selva/.env.example)
- Operator deployment guide (Linux/GCE specifics, reverse proxy, troubleshooting): [deployment/GCE-Linux.md](deployment/GCE-Linux.md)
- Shipping a fix to a deployed CLI/runtime: [Hotfix-CLI-Runtime.md](Hotfix-CLI-Runtime.md)
