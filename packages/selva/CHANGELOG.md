# @selvajs/selva

## 2.0.9

### Patch Changes

- **Gate Platform projects behind `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`.** The admin → Projects surface — instance-admin-owned projects granted to orgs or individual users — is now opt-in like the other platform flags, off by default. When off, the nav entry is hidden, the routes 404, the admin API rejects, platform-visibility projects are filtered out of every list, and the access rules treat them as inaccessible (instance_admin included). Existing rows are preserved; flipping the flag back on restores access.
  - `selva create` lists the new flag in the platform-flags multiselect, alongside `ALLOW_ORG_CREATION`, `ENABLE_SHARING`, etc.
  - `.env.example` documents the flag in the `PLATFORM FEATURE FLAGS` block.
  - Rule layer: `ProjectAccessInput` and `DefinitionAccessInput` carry a new `enablePlatformProjects` boolean. Off short-circuits every `canView` / `canSolve` / `canEdit` / `canManage` / `canEditProjectSettings` / `canEditDefinition` call against a platform-visibility project to `false` — single source of truth, so route and listing code can't drift.

  Existing deployments that want the feature: set `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS=true` in `.env` and restart.

## 2.0.8

### Patch Changes

- **Fix admin "Run Update" leaving the app offline.** The bash script driving the npm-mode update was being killed by PM2's tree-kill when it called `pm2 stop selva-compute` — Node's `{ detached: true }` only creates a new session/process group but does not change the parent-child relationship that tree-kill walks. Result: bash died right after stopping the app, `npm update` and `pm2 start` never ran, and the site stayed down until someone SSH'd in.

  The runner is now daemonized via `setsid bash … &` + `disown` + immediate launcher exit, so its PPID becomes 1 (init) before it does anything destructive. Tree-kill can no longer reach it.

  Additional hardening to the same code path:
  - **Pre-flight version check.** `npm view @selvajs/selva version` runs before any stop/install/start cycle. If the deployment is already on the latest version, the script exits clean without taking the app down.
  - **EXIT-trap safety net.** On any exit path (clean, crash, kill, npm hang) the runner checks `pm2 jlist` and, if selva-compute isn't reporting `online`, unconditionally starts it from `ecosystem.config.cjs`. The app should never stay dark after the runner exits.
  - **Start from ecosystem.config.cjs**, not `pm2 start selva-compute` by name — the latter fails when `pm2 update` has wiped the in-memory process list.
  - **PORT is read from `.env`** for the health probe, matching `scripts/update.sh` behavior.
  - **Frontend poll window** extended from 90s to 5min — npm update + pm2 cold start on slow VPS instances legitimately exceeds 90s.

## 2.0.7

### Patch Changes

- Fix admin Update aborting mid-flight right after `pm2 stop`, leaving selva-compute permanently stopped.

  The tee'd-log wrapper introduced in 2.0.5 didn't survive the SIGPIPE cascade that fires when `pm2 stop selva-compute` succeeds. Cascade was: pm2 kills selva-compute → the pipe between `tee` and the parent process breaks → `tee` gets SIGPIPE on its next stdout write and dies → bash's next write goes to the now-dead tee subprocess → bash gets SIGPIPE and exits. Net result: the script wrote `pm2 stop` output to the log file, then nothing — never reached `npm update` or `pm2 start`, leaving the deployment with selva-compute stopped and no clue from the UI (SSE was dead, log file truncated at the stop step).

  Fix: `tee --output-error=warn-nopipe` keeps tee alive when its stdout pipe breaks (file writes continue), `trap '' PIPE` makes bash ignore SIGPIPE, and `2>/dev/null` silences tee's now-irrelevant warning. The script now runs to completion regardless of whether the SSE consumer is still alive — which is exactly the property the log-file mechanism needs to be useful.

  Operators on 2.0.6 whose admin Update click left selva-compute stopped can recover with `./node_modules/.bin/pm2 start selva-compute --update-env`.

## 2.0.6

### Patch Changes

- Fix `pm2: command not found` in the admin Update endpoint when no global pm2 is installed.

  The endpoint spawned the update bash script with `PATH: process.env.PATH`, which on most servers doesn't include the deployment's `node_modules/.bin`. As soon as a host removed its global pm2 (recommended after 2.0.5 to prevent daemon/CLI version skew), every admin Update click failed at `pm2 stop` with "command not found" — silently leaving the running process untouched and exiting `[FATAL]` at `pm2 start`.

  Fix: prepend `${plan.cwd}/node_modules/.bin` to the spawned script's PATH so it resolves to the project-local pm2, mirroring the local-only resolution in `@selvajs/cli`'s `pm2Bin()`. The deployment now uses one consistent pm2 from every entry point — interactive shell, `selva start`, and the admin endpoint.

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

### Patch Changes

- **Fix: header-auth and OAuth deployments now seed a default org on first admin login.** Previously only the `/setup` password flow created the single-tenant default Organization + Project, so deployments using header-auth or OAuth callback landed without an org. Without an org, `actingOrgId` resolved to `undefined` and any org-scoped permissions (`manage_projects`, `manage_definitions`) assigned in the admin UI were silently dropped instead of persisted.

  The seed now runs inside `bootstrapUserSession`, self-heals existing deployments that are missing their org, and no-ops once an org exists.

## 2.0.3

## 2.0.2

### Patch Changes

- f49433c: **Env-driven provider wiring.** New deployments no longer ship a `selva.config.js` — provider selection moved into the runtime, driven by `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` in `.env`. Provider implementations remain bundled into `@selvajs/selva`; the only operator-facing files are `.env` and `ecosystem.config.cjs`.
  - `selva create` writes `.env` + `ecosystem.config.cjs` + `package.json`. The deployment `package.json` now lists only `@selvajs/cli`, `@selvajs/selva`, and `pm2`.
  - `selva migrate` detects existing deployments and (a) drops the now-bundled provider packages from `package.json`, (b) backs up and deletes any stale `selva.config.js`, and (c) rewrites `ecosystem.config.cjs` if it still points at `@selvajs/runtime`.
  - `selva doctor` checks for layout drift across all three of the above.
  - The escape hatch for custom providers is still `SELVA_CONFIG_PATH`: set it to a `.js` file exporting a `defineConfig()` result.

  Existing deployments: run `selva migrate` after updating. The CLI prints the full set of changes before applying them and saves `.bak` files for every file it touches.

## 2.0.1

## 2.0.0

### Minor Changes

- 9cd112b: **v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.
  - **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
  - **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
  - **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
  - **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

  See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.

## 0.10.0

### Minor Changes

- # 0.10.0

  A broad release covering platform foundations, a new drawing/PDF pipeline, unified drag-and-drop, schema-source-of-truth work, and a new forward-auth provider. Web apps and `@selvajs/ui` are aligned at 0.10.0; library packages move to the next minor in their respective tracks. The Grasshopper plugin ships as 0.10.0 (beta tag dropped).

  ## Apps & UI (`@selvajs/plugin-ui`, `@selvajs/selva`, `@selvajs/ui`)

  ### Plugin-UI
  - Unified drag-and-drop on `svelte-dnd-action` with a thin cross-type coordinator (replaces three coexisting systems).
  - Schema source-of-truth refactor: canonical/draft split, content-hash for safe save, removal of version/edit-intent state, eliminates drift between plugin `_embeddedSchema`, UI state, and localStorage.
  - New components: `ImageUploadField`, `DataTable`, mode toggle, resizable, scroll-area, search, select, separator, slider, sonner, switch, tabs, textarea, theme switcher.
  - `NumberWidgetConfig` gains `hideRange` for UI control.
  - External input handling with a UI toggle for input sources.
  - Resizable-handle styling, grid-item visibility + column positioning, dropzone active-state highlights.
  - Compute throttle + solving indicator; util reorganisation.

  ### Selva
  - Project-owner definition uploads with access-control tests.
  - Project visibility handling tightened in access-control logic.
  - StatCard refactor across project/team pages and updated project navigation.
  - Audit-log functionality with query support and UI integration.
  - API endpoints for managing platform projects and grants; reclaim functionality.
  - Email-link authentication.
  - Compute-server management refactored to support platform and org-private servers; permissions docs clarified for role scopes.

  ### Cross-cutting UI
  - WebSocket connection handling and schema-history management hardened.
  - Schema history + validation improvements.
  - `NotificationManager` interface + implementation for message handling.
  - Primitive imports and layout-structure refactor; component conventions normalised (see plugin-ui `lib/README`).

  ## Drawing system (`Selva.Drawing` + UI)
  - New SVG drawing components, dimensioning, curve creation, and export.
  - `GH_Page`, `GH_PathStyle` improvements; `RhinoViewportVisitor` rendering enhancements.
  - `DrawingView` / `GH_DrawingView` support multiple geometry elements with auto-fit.
  - New table/grid header-style + fill options.
  - Document layout + pagination logic refactor; `GridOverflow` class + `ComputeOverflows` method for multi-page output.
  - New icons and a page-flow plan for multi-page output.

  ## Schemas (`@selvajs/schemas`)
  - Modular Zod-based validation system for `UISchema`.
  - Custom `IGH_Goo` types for `ValueList`, `ThreeMaterial`, `FileData`, `UISchema` with serialization.
  - `SchemaArchiveSerializer` for schema + values archive serialization.

  ## Platform & providers
  - `@selvajs/header-auth-provider` (new): forward-auth via trusted upstream proxy. Identity verification from proxy headers, allowlist management for user entries.
  - `@selvajs/platform`: project-grant store + interfaces; reclaim flow; clearer role scopes.
  - `@selvajs/local-provider`: env-var handling refactor.

  ## Plugin (.NET / Grasshopper)
  - WebSocket message handling and validation overhauled.
  - Document synchronization and schema handling refactor.
  - Robust volatile + persistent parameter-value extraction.
  - Multi-target: net48 + net7.0 (Rhino 8), net9.0 (Rhino 9-wip) with separate `manifest-rh8.yml` / `manifest-rh9.yml`. Rhino 7 is not supported.
  - Grasshopper group import + enhanced grouping options.
  - `BinaryGeometryWriter` for optimized mesh delivery.
  - `ValueApplicator` + `ValueCollector` services replace ad-hoc plumbing in UIBuilder.
  - Install-directory resolution improvements in the update script.

  ## Tooling, infra, docs
  - Turborepo integration: `pnpm build` / `check` / `type-check` / `test` / `generate` orchestrated via turbo with caching (see `docs/Turborepo.md`).
  - New data-directory layout + setup script changes.
  - PM2 deployment: `--env-file` flag via `node_args` (replaces silently-ignored `env_file` on `pm2 start`).
  - `@selvajs/schemas` workspace dependencies normalised to `workspace:*`.
  - Grasshopper example definitions unignored.
  - Added CONTRIBUTING + changelog; TypeScript schema generation pipeline.

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.10.0
  - @selvajs/schemas@1.2.0
  - @selvajs/platform@0.2.0

## 0.9.0

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.9.0

## 0.8.4

### Patch Changes

- Refactor: extract solve/state logic into self-contained `ComputeApp` component
  - Add `ComputeApp.svelte` to `@selvajs/ui` — wraps all solve logic, throttling, solving indicator, definition switching, embed mode, custom primary color, and footer registration into one component
  - Add `showSaveButton`, `showLoadButton`, `stateManagerActions` props to `ComputeApp` and `AppLayout` for flexible state manager configuration
  - Add optional `header` and `children` snippets to `ComputeApp` for custom nav/layout
  - Extract `ActionButton` type to `shared/types/actionButton.ts` and `SolveFn`/`SolveResult` to `shared/types/solveFn.ts`
  - Move `hexToOklch` color utility from compute-app to `@selvajs/ui`
  - Slim `compute-app/+page.svelte` from ~280 lines to ~58 lines

- Updated dependencies
  - @selvajs/ui@0.8.4

## 0.8.3

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.8.3
