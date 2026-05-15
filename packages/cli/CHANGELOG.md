# @selvajs/cli

## 2.0.2

### Patch Changes

- f49433c: **Env-driven provider wiring.** New deployments no longer ship a `selva.config.js` — provider selection moved into the runtime, driven by `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` in `.env`. Provider implementations remain bundled into `@selvajs/selva`; the only operator-facing files are `.env` and `ecosystem.config.cjs`.
  - `selva create` writes `.env` + `ecosystem.config.cjs` + `package.json`. The deployment `package.json` now lists only `@selvajs/cli`, `@selvajs/selva`, and `pm2`.
  - `selva migrate` detects existing deployments and (a) drops the now-bundled provider packages from `package.json`, (b) backs up and deletes any stale `selva.config.js`, and (c) rewrites `ecosystem.config.cjs` if it still points at `@selvajs/runtime`.
  - `selva doctor` checks for layout drift across all three of the above.
  - The escape hatch for custom providers is still `SELVA_CONFIG_PATH`: set it to a `.js` file exporting a `defineConfig()` result.

  Existing deployments: run `selva migrate` after updating. The CLI prints the full set of changes before applying them and saves `.bak` files for every file it touches.

## 2.0.1

### Patch Changes

- 1e63ec5: Rename the bootstrap bin from `create` to `cli` so `npx @selvajs/cli <dir>` resolves without needing `-p`. Previously the package shipped two bins (`create` + `selva`) and neither matched the unscoped package name, so npx failed with "could not determine executable to run" unless invoked as `npx -p @selvajs/cli create`. The `selva` operator bin is unchanged.

## 2.0.0

### Patch Changes

- 9cd112b: **v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.
  - **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
  - **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
  - **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
  - **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

  See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.

> Renamed from `@selvajs/create` after 0.1.3. Earlier entries below were
> published under the old name.

## 0.1.3

### Patch Changes

- - `@selvajs/header-auth-provider`: new `BootstrapAllowlistPolicy` API and behavior change in `identifyFromHeaders`.
  - `@selvajs/selva`: new auto-bootstrap behavior and new page UI cases.
  - `@selvajs/cli`: CLI prompts and doctor improvements (no API surface change).
