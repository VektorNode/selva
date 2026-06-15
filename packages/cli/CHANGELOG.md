# @selvajs/cli

## 4.5.0

## 4.4.0

## 4.3.5

## 4.3.4

## 4.3.3

## 4.3.2

## 4.3.1

## 4.3.0

## 4.2.1

## 4.1.0

### Minor Changes

- Bump `@selvajs/cli` onto the `4.x` line, aligned with the `@selvajs/selva`
  runtime.

  The CLI and runtime release as a `linked` group but had drifted (CLI at `3.x`,
  runtime at `4.x`) because the CLI carried no changeset during the runtime's
  `4.0` cycle. Operators reasonably expect `selva` (the CLI) and the app it
  manages to share a major, and `selva update` refreshes both packages together.
  This lands the CLI at `4.1.0` — `4.0.0` is already published and can't be
  reissued, so the minor is the lowest `4.x` we can ship.

  No breaking CLI behavior; the bump is purely to re-sync the major line.
  Functionality (`init`, `doctor`, `start/stop/restart/logs`, `update`,
  `migrate`, `keys rotate`) is unchanged.

## 3.0.0

## 2.0.11

## 2.0.10

### Patch Changes

- 74252bd: Warn during `selva` / `create` scaffolding when the user enters an `http://` ORIGIN. Plain HTTP origins are a silent footgun: session cookies are minted with `Secure` under `NODE_ENV=production`, so browsers drop them and login appears to succeed but every subsequent request is anonymous. The prompt now prints a yellow note pointing operators at the two fixes (put TLS in front, or set `ALLOW_INSECURE_COOKIES=true` for testing).

## 2.0.9

### Patch Changes

- **Gate Platform projects behind `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`.** The admin → Projects surface — instance-admin-owned projects granted to orgs or individual users — is now opt-in like the other platform flags, off by default. When off, the nav entry is hidden, the routes 404, the admin API rejects, platform-visibility projects are filtered out of every list, and the access rules treat them as inaccessible (instance_admin included). Existing rows are preserved; flipping the flag back on restores access.
  - `selva create` lists the new flag in the platform-flags multiselect, alongside `ALLOW_ORG_CREATION`, `ENABLE_SHARING`, etc.
  - `.env.example` documents the flag in the `PLATFORM FEATURE FLAGS` block.
  - Rule layer: `ProjectAccessInput` and `DefinitionAccessInput` carry a new `enablePlatformProjects` boolean. Off short-circuits every `canView` / `canSolve` / `canEdit` / `canManage` / `canEditProjectSettings` / `canEditDefinition` call against a platform-visibility project to `false` — single source of truth, so route and listing code can't drift.

  Existing deployments that want the feature: set `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS=true` in `.env` and restart.

## 2.0.8

## 2.0.7

## 2.0.6

## 2.0.5

### Patch Changes

- Fix admin Update hangs caused by PM2 daemon/CLI version skew, and recover lost log output during the post-restart blackout.

  **PM2 daemon/CLI sync.** The CLI scaffold previously installed `pm2: '^5.4.0'` (caret) and `pm2Bin()` fell back to a global pm2 if the local one was missing. Both choices made it possible for two pm2 binaries to manage the same daemon, producing `In-memory PM2 is out-of-date` warnings and stops/restarts that hung mid-flight. The fix:
  - Pin `pm2` to an exact version in scaffolded deployments (`5.4.3`).
  - `pm2Bin()` is now local-only — errors loudly if `node_modules/.bin/pm2` is missing instead of silently using a possibly-different global pm2.
  - New `ensurePm2InSync()` helper runs before every state-changing pm2 call (`selva start`/`stop`/`restart`/`update`); detects daemon/CLI skew and runs `pm2 update` to respawn the daemon under the local CLI before continuing.
  - Same skew detection added to the bash side of the admin update endpoint and `scripts/update.sh`, so the check runs even when the JS wrapper isn't on the call path.

  **Update log visibility.** The admin Update endpoint streams script output via SSE, but the SSE is served by `selva-compute` itself — so the moment `pm2 stop selva-compute` succeeds, the stream dies and the frontend goes blind. Anything that happened afterwards (npm update output, pm2 start result, health probe, rollback) was invisible, leaving operators with an infinite spinner and no diagnostics. The fix:
  - Bash wrapper tees all script stdout/stderr to `/tmp/selva-update.log`. The detached process keeps writing to the file even after SSE dies.
  - `GET /admin/api/system/update` returns the log file contents (admin-only).
  - During the post-restart wait, the frontend polls the log endpoint alongside `/api/health` and replaces the displayed logs with the full file content as soon as the new process is reachable — surfacing the entire blackout chunk in one shot.

  Operators on existing hosts that have a global pm2 installed alongside the project-local one should run `npm uninstall -g pm2` after upgrading, then `./node_modules/.bin/pm2 update` once to align the daemon. New scaffolds are unaffected.

## 2.0.4

## 2.0.3

### Patch Changes

- Fix `npx @selvajs/cli` and `selva` commands failing with `sh: 1: cli: not found`. The published 2.0.2 package declared `bin` entries pointing to `./bin/cli.js` and `./bin/selva.js`, but those shim files were never committed and the published tarball had no executables. Adds the missing shims and a parse-only test that prevents the regression.

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
