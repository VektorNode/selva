# White-Label Plan

Roadmap for turning Selva into a deployable white-label platform — companies install it, brand it, run it without touching repo source.

## Status

- [x] **B1 — Runtime config loading.** `providers.server.ts` honors `SELVA_CONFIG_PATH` at boot for an externally-loaded `selva.config.js`. Bundled config remains the default so dev workflows are unchanged. Done.
- [x] **B2 + B3 + A2 — Brand plumbing.** Every visible "Selva" string is config-driven via `SELVA_BRAND_NAME` / `SELVA_BRAND_COPYRIGHT_NAME` / `SELVA_BRAND_TAGLINE` / `SELVA_BRAND_DESCRIPTION`. Done.
- [x] **Runtime-package build script.** `@selvajs/runtime` builds + packs cleanly. `pnpm run build:runtime` produces a publishable tarball with prebuilt compute-app, compiled config template, and PM2/env templates. Done.
- [ ] **CLI (`@selvajs/create` + `selva` operator commands).** Pending — next.

## Why this order

The CLI is the visible artifact, but it's ~30% of the work. The other 70% is making the runtime genuinely white-labelable. If the CLI ships first, it generates a prebuilt app that still says "Selva" in the header and can't be reconfigured post-build — a slick demo that breaks on the first real customer.

Each step below unblocks the next. Skipping ahead doesn't save time; it produces something that doesn't work.

---

## Step 1 — Runtime config loading (done)

[providers.server.ts](../packages/compute-app/src/lib/server/providers.server.ts) checks `SELVA_CONFIG_PATH` at module load:

- **Unset (default):** the bundled `selva.config.ts` from the repo root is statically imported, exactly as before. Dev workflows and existing builds unaffected.
- **Set:** the path is `await import()`'d dynamically (with `@vite-ignore` so Vite doesn't try to pre-resolve). The runtime can be prebuilt once and pointed at any external config.

The override path must be a `.js` file — there's no TS compiler at runtime. Step 3's build script will compile `selva.config.ts` → `selva.config.js` so deployments have something real to point at.

## Step 2 — Brand plumbing (done)

Every customer-visible "Selva" string is now driven by config, with sensible "Selva" defaults so existing deployments are unaffected.

### Config surface

New `SelvaBranding` block on `SelvaConfig` ([packages/platform/src/config.ts](../packages/platform/src/config.ts)):

```ts
export interface SelvaBranding {
  name?: string;            // Header, page titles, "{brand} staff" copy
  copyrightName?: string;   // Footer (defaults to name)
  tagline?: string;         // Landing-page subtitle
  description?: string;     // Meta description
}
```

Read in [selva.config.ts](../selva.config.ts) from env (`SELVA_BRAND_NAME` etc.) and exposed by [providers.server.ts](../packages/compute-app/src/lib/server/providers.server.ts) as `branding: Required<SelvaBranding>` with built-in defaults. The root [+layout.server.ts](../packages/compute-app/src/routes/+layout.server.ts) puts it on `$page.data.branding` so any route or component can read it.

### UI plumbing

[AppShell](../packages/ui/src/lib/components/layout/AppShell.svelte) gained `brandName` and `copyrightName` props and forwards them into [PageHeader](../packages/ui/src/lib/components/layout/PageHeader.svelte) and [PageFooter](../packages/ui/src/lib/components/layout/PageFooter.svelte). All three default to `'Selva'` so callers outside compute-app don't break.

[AppHeader.svelte](../packages/compute-app/src/lib/components/AppHeader.svelte) reads `page.data.branding` and forwards into `AppShell`.

### Strings replaced

| File | What changed |
|---|---|
| [+layout.svelte](../packages/compute-app/src/routes/+layout.svelte) | `<title>` and meta description from `data.branding` |
| [+page.svelte](../packages/compute-app/src/routes/+page.svelte) | Homepage h1 + tagline from `page.data.branding` |
| [login/+page.svelte](../packages/compute-app/src/routes/login/+page.svelte) | `<title>` |
| [setup/+page.svelte](../packages/compute-app/src/routes/setup/+page.svelte) | `<title>` |
| [accept-invite/+page.svelte](../packages/compute-app/src/routes/accept-invite/+page.svelte) | `<title>` |
| [auth/email/sent/+page.svelte](../packages/compute-app/src/routes/auth/email/sent/+page.svelte) | `<title>` |
| [team/compute/+page.svelte](../packages/compute-app/src/routes/team/compute/+page.svelte) | 5 strings: "Selva staff", "this Selva instance", "Ask a Selva admin", etc. |
| [admin/+page.svelte](../packages/compute-app/src/routes/admin/+page.svelte) | "this Selva instance" |

### Intentionally left alone

- **"Selva Plugin" label** in [admin/compute/+page.svelte:363](../packages/compute-app/src/routes/admin/compute/+page.svelte#L363) and the plugin-manifest read in [admin/api/compute/status/+server.ts:41](../packages/compute-app/src/routes/admin/api/compute/status/+server.ts#L41) — these refer to the literal `.gha` plugin name, a technical identifier shared by all installs regardless of branding.
- **Favicons** in [static/favicon/](../packages/compute-app/static/favicon/) — operators replace files at install time. Documented in `.env.example`.
- **`apple-mobile-web-app-title`** in [app.html](../packages/compute-app/src/app.html) — SvelteKit can't interpolate `app.html` at runtime; left as `Selva`. Customers who care can override `app.html` in their fork.
- **Source-code comments** mentioning "Selva staff" — not user-visible.

### Env vars added

Documented in [packages/compute-app/.env.example](../packages/compute-app/.env.example):

- `SELVA_BRAND_NAME`
- `SELVA_BRAND_COPYRIGHT_NAME`
- `SELVA_BRAND_TAGLINE`
- `SELVA_BRAND_DESCRIPTION`

### Verification

`type-check` ✓, `svelte-check` ✓ (0 errors, 0 warnings, 5504 files), production build with `ADAPTER=node` ✓.

---

## Step 3 — Runtime-package build script (done)

Built as [packages/runtime/](../packages/runtime/). `pnpm run build:runtime` invokes [scripts/build.js](../packages/runtime/scripts/build.js), which:

1. Builds `@selvajs/compute-app` with `ADAPTER=node`.
2. Copies `packages/compute-app/build/` → `packages/runtime/build/`.
3. Compiles `selva.config.ts` → `templates/selva.config.example.js` via esbuild, keeping provider imports external so they resolve against the operator's installed packages.
4. Writes `templates/ecosystem.config.cjs` (PM2, cwd-relative paths, `SELVA_CONFIG_PATH=./selva.config.js`).
5. Copies `compute-app/.env.example` → `templates/.env.example` verbatim so operators have the authoritative reference without a source checkout.

### What didn't need to be built

The plan called for hand-flattening `package.json` (resolve `workspace:*` and `catalog:` specs to real versions). pnpm 10 does this on `pnpm pack` and `pnpm publish` natively — verified by extracting `package.json` from the tarball and seeing every spec rewritten. We removed that step from `build.js` to avoid drift between the editable source and the published artifact.

### Deployment shape (operator-facing)

```
my-deployment/
├── package.json              # depends on @selvajs/runtime
├── selva.config.js           # copied from runtime/templates/selva.config.example.js
├── .env                      # see runtime/templates/.env.example
├── ecosystem.config.cjs      # copied from runtime/templates/
└── node_modules/
    └── @selvajs/runtime/
        ├── build/            # SvelteKit node output
        └── templates/
```

Start under PM2: `pm2 start ecosystem.config.cjs`. Upgrades: `npm update @selvajs/runtime` + `pm2 restart selva-compute --update-env`.

### Required follow-ups before first publish

- **Provider packages.** `@selvajs/local-provider` and `@selvajs/supabase-provider` were flipped from `"private": true` to `publishConfig.access=public` and licensed MIT — done as part of this step. They (and `@selvajs/platform`, `@selvajs/ui`, `@selvajs/schemas`) need an actual `pnpm publish` before `@selvajs/runtime` can be `npm install`ed.
- **Provider extensibility.** Customers wiring a custom auth provider `npm install` their own package and reference it from `selva.config.js`. The runtime's loader does a dynamic import — anything implementing `@selvajs/platform` interfaces works. Worth a docs note when the CLI lands.

### Decisions for revisit

- **Versioning.** `@selvajs/runtime` semvers independently from the monorepo today. Lockstep with `compute-app` would be more honest but adds release coordination. Stick with independent semver until it bites.
- **Public npm vs private registry.** Shipping public npm initially. Customers who want a private registry can republish or use `.npmrc` overrides.

---

## Step 4 — CLI

**Goal:** `npx @selvajs/create my-app` → working Selva deployment in seconds.

### Shape

Single npm package `@selvajs/create`, published with a bin entry. Subcommands:

- `npx @selvajs/create <dir>` — interactive scaffolder. Prompts for provider, tenancy, flags, brand name, admin email. Generates secrets. Writes `.env`, `selva.config.js`, `ecosystem.config.cjs`, `package.json`. Runs `npm install`.
- `selva init` (post-install, run inside a deployment dir) — same prompts, but reconfigures an existing install. Never regenerates `SELVA_HMAC_KEY` / `SELVA_AT_REST_KEY` once set (rotating those invalidates sessions and at-rest encryption).
- `selva doctor` — validates every env var, tries to load each provider, checks DATA_PATH writable, pings Supabase URL. Prints a green/red checklist.
- `selva start` / `selva stop` / `selva restart` / `selva logs` — thin PM2 wrappers, hide `pm2 restart selva-compute --update-env` footguns.
- `selva update` — `npm update @selvajs/runtime` + `pm2 restart`.
- `selva keys rotate <hmac|at-rest>` — generate + replace, warning about what it invalidates.

### Prompt flow for `npx @selvajs/create`

1. "What's your deployment called?" → directory name
2. "Brand name?" → `SELVA_BRAND_NAME`
3. "Tenancy: single org per deployment, or multi-tenant?" → `SELVA_TENANCY`
4. "Auth backend: local (filesystem) or Supabase?" → `SELVA_AUTH_PROVIDER`
   - If Supabase: prompt for URL, anon key, service role key. Validate by hitting the URL.
   - If local: prompt for `DATA_PATH`.
5. (For each storage / data, if not already locked by auth choice) → `SELVA_*_PROVIDER`
6. "First admin email?" → `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`
7. "Behind a reverse proxy?" → prompts for `ORIGIN`, prints a Caddy/nginx snippet
8. Generates `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` (32 random bytes hex each).
9. Writes everything. Runs `npm install`.
10. Prints next steps: "cd my-app && pm2 start ecosystem.config.cjs" (or "selva start").

### Idempotency rules

- Refuse to overwrite a non-empty target directory without `--force`.
- `selva init` in an existing install: reads current `.env`, lets user edit, never regenerates secrets if they're already set.
- Write a `.selva-version` marker so future CLI versions can migrate config schema cleanly.

### Estimated effort

3–5 days for `init` + `doctor` + the PM2 wrappers. Each subsequent command (`update`, `keys rotate`) is small.

---

## Out of scope (for now)

- **Runtime-mutable admin UI for flags/branding.** Deferred — needs permissions/audit-log design. Once enough operators ask, build it.
- **Multi-language i18n.** White-label customers may want German/French copy. Out of scope until requested.
- **Per-org branding (orgs override the instance brand).** Multi-tenant feature; out of scope for the single-tenant white-label path.
- **Theme switching at runtime.** The CSS variables exist; surfacing a theme picker in admin is deferrable.
- **Building `.gha` plugin from the CLI.** The Rhino Grasshopper plugin is a separate distribution; not part of the web-runtime story.

## Decision points along the way

The plan above commits to several choices. Worth flagging the ones most likely to need revision:

1. **`.env` as the source of truth for config.** Currently agreed. If we discover operators want a single TOML/YAML file instead, this changes `.env` → `selva.config.toml` (provider plumbing already supports a factory function, so the change is contained).
2. **`@selvajs/runtime` as a published npm package.** Alternative: ship as a tarball download from GitHub Releases. npm is simpler day-to-day; releases handle versioning slightly more cleanly. Stick with npm unless we hit a publishing constraint.
3. **PM2 as the default process manager.** Existing memory note flags pm2 env-loading footguns. Could ship a systemd unit template instead. Recommend PM2 for v1, add systemd later.
4. **Compile `selva.config.ts` → `.js` at build time.** Alternative: ship a tsx/ts-node runtime loader. Compilation is simpler and lighter, but means the deployment has a `.js` file instead of the operator's friendly `.ts`. Mitigation: ship `selva.config.example.ts` as a comment-heavy reference even though the runtime loads `.js`.
