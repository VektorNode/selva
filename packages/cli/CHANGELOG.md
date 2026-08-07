# @selvajs/cli

## 4.8.0-beta.9

### Patch Changes

- 544906b: `selva migrate` now shows every field it discards, and keeps `engines`.

  The rewrite replaces a deployment's `package.json` wholesale, which is deliberate — the directory is generated output. But the confirmation prompt only diffed `dependencies` and `scripts`, so `devDependencies`, `description`, and any other top-level field the operator had added disappeared without ever being shown. The diff now lists them, so a confirmed migration has no unadvertised losses. `selva doctor` was quiet about them too: `detectDrift` reported "layout is current" on a deployment `migrate` would strip.

  `engines` is now carried over rather than dropped. npm only enforces it under `engine-strict`, so an operator who pinned a Node floor did it deliberately — and removing it takes away a guard whose absence surfaces only under real traffic (the failure mode behind issue #176).

- 43bb98d: Fix `selva migrate` leaving a deployment down when `npm install` fails, and `selva keys rotate` crashing on a deployment with no `.env`.

  - **A failed migration can now recover.** `migrate` needs a clean install (a legacy lockfile pins the old package set across a major bump), so it deleted `node_modules` before running `npm install`. But `node_modules` is also where the deployment's pm2 lives, and the rollback has to restart the app — so when an install failed, the restart resolved no pm2, `spawnSync` set `error`, and the helper returned a bare `1` with nothing printed. The operator was left with a stopped app, no dependency tree, and no indication why. The old tree is now renamed aside rather than deleted (atomic, keeps the `.bin` symlinks intact) and restored along with `package-lock.json` if the install fails, so pm2 resolves again and the app comes back. A restart that still fails is now reported instead of swallowed.
  - **`migrate` no longer falls back to a global pm2.** It carried a private pm2 resolver that silently used whatever `pm2` was on `PATH` when the local one was missing — the version-skew source `pm2.js` exists to prevent, and which it refuses with an explicit error. Both now use the same strict resolver; the two call sites where a missing pm2 is legitimate (a legacy deployment has nothing to stop) handle it explicitly.
  - **`selva doctor` reports an interrupted migration.** A killed `migrate` leaves the stashed dependency tree behind; doctor now flags it and `--fix` removes it.
  - **`selva keys rotate` no longer crashes without an `.env`.** It read the file unconditionally when the runtime templates were absent, throwing a raw `ENOENT` on a deployment that has `ecosystem.config.cjs` but no `.env` — a state the CLI otherwise treats as valid and `selva init` already handled.
  - **`create` and `migrate` can no longer disagree about the deployment `package.json`.** They built it separately and had already drifted: `create` pinned pm2 exactly to avoid daemon skew while `migrate` rewrote it to a caret range. Both now use one builder. `.selva-version` also records the real CLI version instead of a hardcoded `0.1.0` that had been stale since the marker was introduced.

## 4.8.0-beta.8

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.

## 4.8.0-beta.7

## 4.8.0-beta.6

## 4.8.0-beta.5

## 4.8.0-beta.4

## 4.8.0-beta.3

## 4.8.0-beta.2

## 4.7.4-beta.1

## 4.7.4-beta.0

## 4.7.3

## 4.7.2

## 4.7.1

## 4.7.0

## 4.7.0-beta.6

## 4.7.0-beta.5

## 4.7.0-beta.4

## 4.7.0-beta.3

## 4.7.0-beta.2

## 4.6.21-beta.1

## 4.6.21-beta.0

## 4.6.20

## 4.6.19

## 4.6.18

## 4.6.17

## 4.6.16

## 4.6.15

## 4.6.14

## 4.6.13

## 4.6.12

## 4.6.11

## 4.6.10

## 4.6.9

## 4.6.8

## 4.6.7

## 4.6.6

## 4.6.5

## 4.6.4

## 4.6.3

## 4.6.2

## 4.6.1

## 4.6.0

## 4.6.0-beta.2

## 4.6.0-beta.1

## 4.6.0-beta.0

## 4.5.1

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
