# To Fix — header-auth deployment path

Bugs discovered while setting up Caddy + header-auth on a fresh GCE box. The deployment ended up working only after several manual workarounds; each item below is the underlying fix.

Ranked by impact.

---

## Must-fix

### 1. Stale `@selvajs/header-auth-provider` on npm

The published `dist/` is older than the repo source:

- Default UPN header is `SELVA-ID` (source / README say `SELVA-UserPrincipalName`)
- Default email/displayName headers may also differ — audit all three
- `setBootstrapAllowlistPolicy` is missing, so [`wireHeaderAuthBootstrap`](packages/selva/src/lib/server/auth-bootstrap.server.ts) silently no-ops
- `bootstrapAllowlistPolicy` branch in `identifyFromHeaders` is missing — operators must hand-seed `header-allowlist.json` instead of getting the documented `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` first-sight auto-allowlist

**Fix:** republish the package from current source. Verify by diffing [packages/providers/header-auth/src/HeaderAuthProvider.ts](packages/providers/header-auth/src/HeaderAuthProvider.ts) against the npm tarball.

### 2. CLI scaffold imports a provider that isn't installed

The scaffolded `selva.config.js` unconditionally does:

```js
import * as supa from '@selvajs/supabase-provider';
```

even when the user picked `local` / `header` at the prompts. `@selvajs/supabase-provider` isn't in the scaffolded `dependencies`, so the app crashes at boot with `ERR_MODULE_NOT_FOUND`.

**Fix:** in [packages/cli](packages/cli), either

- gate the import + the `case 'supabase':` branches behind the user's auth/data/storage choice, or
- always include `@selvajs/supabase-provider` in scaffolded `dependencies`

The first is cleaner — the scaffolded config shouldn't reference providers the user didn't choose.

---

## Should-fix

### 3. Scaffolded `.env` may be missing a trailing newline

Appending with `echo >>` concatenated onto the last line, producing `HOST=127.0.0.1HEADER_AUTH_DATA_DIR=...` and a `getaddrinfo ENOTFOUND` crash.

**Fix:** in the CLI's `.env` template writer, always end the file with `\n`.

### 4. "Behind a reverse proxy" prompt doesn't wire the matching header names

The CLI asks about reverse-proxy mode and sets `ORIGIN`, but doesn't write `HEADER_AUTH_UPN_HEADER` / `HEADER_AUTH_EMAIL_HEADER` / `HEADER_AUTH_DISPLAY_NAME_HEADER`. With the stale npm package (#1), the in-process defaults disagree with the README Caddyfile, and `user:null` is the only symptom.

**Fix:** either

- have the scaffold write those three env vars explicitly when `SELVA_AUTH_PROVIDER=header` is selected, or
- fix #1 so the defaults match the docs (preferred — fewer scaffolded knobs)

### 5. `wireHeaderAuthBootstrap` silently no-ops on old provider builds

[packages/selva/src/lib/server/auth-bootstrap.server.ts:114](packages/selva/src/lib/server/auth-bootstrap.server.ts#L114) returns early when `setBootstrapAllowlistPolicy` is missing from the loaded provider. No log, no warning — operators see `user:null` indefinitely with no signal.

**Fix:** when `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set AND the provider lacks `setBootstrapAllowlistPolicy`, log a startup warning like

```
[selva] BOOTSTRAP_INSTANCE_ADMIN_EMAIL is set but the installed @selvajs/header-auth-provider
        does not expose setBootstrapAllowlistPolicy. Upgrade the provider, or hand-seed
        header-allowlist.json.
```

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
