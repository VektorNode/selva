# To Fix — header-auth deployment path

Bugs discovered while setting up Caddy + header-auth on a fresh GCE box. The deployment ended up working only after several manual workarounds; each item below is the underlying fix.

Ranked by impact.

---

## Must-fix

### 1. Stale `@selvajs/header-auth-provider` on npm — OBSOLETE on current layout

Was a real problem on the pre-migration deployment, where `@selvajs/header-auth-provider` was a direct dependency in the deployment's `package.json` and loaded from `node_modules/`. The published tarball was older than the repo source (wrong header defaults, missing `setBootstrapAllowlistPolicy`, missing `bootstrapAllowlistPolicy` branch in `identifyFromHeaders`).

**Status:** Moot on the env-driven layout. Verified that the built `@selvajs/selva` embeds the provider classes inline (`HeaderAuthProvider`, `HeaderProxyAuth`) with zero external `from '@selvajs/header-auth-provider'` imports — Vite bundles the workspace dep at build time. The standalone npm package is no longer loaded by current deployments. The standalone package is correctly marked `"private": true` in [packages/providers/header-auth/package.json](packages/providers/header-auth/package.json) and listed under `ignore` in [.changeset/config.json](.changeset/config.json), so changesets won't republish it either.

The operator-facing fix is `selva migrate` (which drops standalone provider packages from `package.json` — see [packages/cli/src/commands/migrate.js:46-55](packages/cli/src/commands/migrate.js#L46-L55)), then `pnpm install`. The next `@selvajs/selva` release will ship with up-to-date provider code baked in.

### 2. CLI scaffold imports a provider that isn't installed — OBSOLETE

The CLI no longer scaffolds a `selva.config.js` (see [packages/cli/src/commands/create.js](packages/cli/src/commands/create.js) — provider selection is now env-driven via `SELVA_AUTH_PROVIDER`). Provider implementations are bundled into the `@selvajs/selva` build, so a deployment only needs `@selvajs/selva` + `@selvajs/cli` + `pm2` on disk. Closed by `feat: migrate to env-driven provider wiring`.

---

## Should-fix

### 3. Scaffolded `.env` may be missing a trailing newline — FIXED

Appending with `echo >>` concatenated onto the last line, producing `HOST=127.0.0.1HEADER_AUTH_DATA_DIR=...` and a `getaddrinfo ENOTFOUND` crash.

**Fix:** [packages/cli/src/env.js](packages/cli/src/env.js) — `mergeEnv` now strips trailing blank lines and always emits a single `\n` terminator.

### 4. "Behind a reverse proxy" prompt doesn't wire the matching header names — OBSOLETE on current layout

Was a symptom of #1 — on the pre-migration layout the stale npm provider had different defaults from the README Caddyfile, so a deployment that didn't explicitly set `HEADER_AUTH_*_HEADER` ended up with mismatched names and `user:null`.

**Status:** the provider bundled into `@selvajs/selva` uses `SELVA-UserPrincipalName` / `SELVA-Email` / `SELVA-DisplayName` — matching the README Caddyfile by default. No need to scaffold the three env vars; the "Customize the trusted header names?" prompt at [packages/cli/src/prompts.js:336](packages/cli/src/prompts.js#L336) covers the explicit-override case.

### 5. `wireHeaderAuthBootstrap` silently no-ops on old provider builds — FIXED

[packages/selva/src/lib/server/auth-bootstrap.server.ts](packages/selva/src/lib/server/auth-bootstrap.server.ts) returned early when `setBootstrapAllowlistPolicy` was missing from the loaded provider. No log, no warning — operators saw `user:null` indefinitely with no signal.

**Fix:** when `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set AND the provider lacks `setBootstrapAllowlistPolicy`, the runtime now logs a startup warning naming the provider mismatch and the two recovery paths (upgrade, or hand-seed).

---

## Nice-to-have

### 6. Extend `selva doctor` to catch header-auth misconfig

`doctor` already checks env vars and file paths. Add:

- When `SELVA_AUTH_PROVIDER=header`:
  - Verify `header-allowlist.json` exists at `HEADER_AUTH_DATA_DIR ?? DATA_PATH`, or `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set
  - Verify the loaded provider exposes `setBootstrapAllowlistPolicy` (catches #1)
  - Print the *resolved* header names the provider will look for, so they can be compared against the proxy config

### 7. `defineConfig` subpath export missing from `@selvajs/selva`

The scaffolded `selva.config.js` imports

```js
import { defineConfig } from '@selvajs/selva/config';
```

but `@selvajs/selva/config` isn't a resolvable subpath in the installed package — boot fails with `ERR_MODULE_NOT_FOUND: '/.../node_modules/@selvajs/selva/config'`. The workaround was to drop `defineConfig` and use a plain arrow function export, which works because `defineConfig` is just an identity helper for types.

**Fix:** either

- add `"./config": "./dist/config.js"` to the package's `exports` map and ship the helper, or
- change the scaffold template to not import `defineConfig` (then `defineConfig` can be deleted entirely)

---

## Out of scope here (but related)

The cloud deployment story currently requires the operator to hand-edit Caddyfiles to a non-trivial degree. Consider shipping a `selva proxy-config caddy` subcommand that emits a known-good Caddyfile from the loaded env (strip-then-inject, header names, upstream port). Would also keep the docs and the runtime aligned by construction.

---

## Server-side cleanup (one-off, not a code fix)

Local to the test box, listed so they don't get lost:

- `~/selva/.env` has a duplicate `HEADER_AUTH_DATA_DIR` line (lines 351–352)
- `~/selva/node_modules/@selvajs/header-auth-provider/dist/HeaderAuthProvider.js` and `users.js` have debug `console.log`s patched in. Backups at `.bak`. Either restore from backup or run `pnpm install --force` to wipe.
- `~/selva/.selva-data/header-allowlist.json` was hand-seeded. After fix #1 lands, this can be deleted and `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` will handle first-admin creation.
