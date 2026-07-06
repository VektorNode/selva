# @selvajs/selva

## 4.6.3

### Patch Changes

- 7163966: Add full per-phase compute timing to pinpoint where solve latency goes. The per-solve `[Compute/browser]` log now breaks the round-trip into: network (request-send + latency), server (via a new `Server-Timing` response header — load / tree / solve / serialize sub-phases), download (payload transmission with size and effective MB/s), JSON decode, rhino3dm init, mesh extraction, and output mapping. This lets a "16s solve with cached compute" be attributed precisely — e.g. large-payload download vs. server serialization vs. mesh decode — instead of being a single opaque number. The server route also sets `Server-Timing` on every `/api/compute` response so the frontend can separate server work from network transfer without enabling server-side debug logging.

## 4.6.2

### Patch Changes

- 65176f7: Add per-segment compute timing logs. The browser now logs a concise round-trip + parse breakdown per solve (always on), and `SELVA_FLAG_COMPUTE_DEBUG` now also emits a `[Compute/server]` line timing the server-side phases the solve metric excludes (definition load, input tree build, response serialization). Together with the existing Rhino.Compute and cache logs, these let you decompose end-to-end solve latency across browser, Selva server, and compute server.

## 4.6.1

### Patch Changes

- 639c796: Patch release

## 4.6.0

### Minor Changes

- 2173bef: Organization assets & branding. Admins can now upload and manage per-org assets (including a logo) from the admin area, backed by a new asset-upload flow and org asset service. Served files are classified and gated by visibility/access-control checks on the `/api/files` route, and the owning org's logo is forwarded to the viewer as a branding watermark.
- 2173bef: Run or preview any historical definition version. The versioning tab's "Run" action can now open the runner against an arbitrary version — not just the live/draft channel pointer — via a `?version=` param, and the compute route accepts a matching `versionId`. Explicit-version runs are editor-only and never accessible through share tokens, and the runner shows a "vN preview" badge.

### Patch Changes

- 2173bef: Fix Supabase local port configuration and wire the solve-metric sink into the server test setup.

## 4.6.0-beta.2

### Patch Changes

- New beta release

## 4.6.0-beta.1

### Patch Changes

- 7a41015: New beta release

## 4.6.0-beta.0

### Minor Changes

- c7fd212: Add an admin-selectable **release channel** so instances can opt into beta builds and revert to stable.
  - **Admin → System → Release channel**: instance admins (`manage_updates`) choose **Stable** (npm `latest`) or **Beta** (npm `beta` dist-tag). The choice persists to `selva-channel.json` in the deployment dir so both the app and the update runner read it; absent/invalid ⇒ Stable (the historic default).
  - **Switch-only**: changing the channel doesn't update anything — the operator then runs **Application Update**, which installs `@selvajs/{cli,selva}` pinned to the chosen channel's dist-tag.
  - **Beta → Stable revert** works the same way and correctly downgrades: the update runner now `npm install`s the channel-tagged version instead of `npm update` (which can only move forward), so reverting from a beta lands on the older stable release. The existing health-probe + rollback still guards a bad install.
  - The update-availability check and badge on **Admin → System** now reflect the selected channel (beta-aware semver ordering surfaces `beta.1 → beta.2` and beta→stable promotions; stable-channel behavior is unchanged).

- 8a238c4: Surface more compute server info and make upload/solve limits visible and legible.
  - **Admin → Compute**: each reachable server now shows live **active children** (read passively — never spawns children, so an idle pool reads as 0) and **idle time** (seconds since the last child request), alongside the existing version/plugin tiles.
  - **Admin → System**: new read-only panel listing the resolved compute/upload limits (max solve duration, rate limits, file-size caps, request/response byte caps, remote-definition fetch limits, cache TTL) so operators can see what's enforced without reading `.env`.
  - **Definition upload**: oversized `.gh` uploads now fail with a clear "file too large" message. A new pre-read body-size guard returns the app's JSON error envelope instead of letting an opaque non-JSON 413 from adapter-node/proxy surface as a misleading "Compute server error".
  - **Fix**: server-side env-driven config (`MAX_SOLVE_DURATION_MS`, rate-limit, file-size caps, `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, `ALLOW_INSECURE_COOKIES`) now reads via SvelteKit's `$env/dynamic/private` instead of bare `process.env`. Under `vite dev`, Vite never mirrors `.env` into `process.env`, so every `.env` override was silently ignored in development and the hard-coded defaults were used regardless. An ESLint rule (`no-restricted-properties`) now warns on bare `process.env` in selva server code to prevent regressions; legit OS-level reads (`NODE_ENV`/`PATH`/`HOME`) opt out with a documented inline disable.
  - **Admin → System**: the "Compute rate limit" row now lists both env keys that drive it (`COMPUTE_RATE_LIMIT_MAX` and `COMPUTE_RATE_LIMIT_WINDOW_MS`) — previously the window var was invisible, so operators couldn't tell how to change the "/ 1.7 min" window.

## 4.5.1

### Patch Changes

- 33ac5e0: Fix `redirect()` (and other SvelteKit control-flow throws) surfacing as an "[Unhandled error]" 500 instead of redirecting. The monorepo resolved `@sveltejs/kit` against two Vite majors, splitting it into multiple module instances and breaking SvelteKit's `instanceof Redirect`/`HttpError` checks. The shared Vite config now dedupes `@sveltejs/kit`, `svelte`, and `vite` to a single physical copy.

## 4.5.0

### Minor Changes

- fed3a9e: Capture per-solve timing and outcome telemetry.
  - **platform**: new pluggable `ISolveMetricSink` provider (`SelvaConfig.solveMetrics`, defaults to `NoopSolveMetricSink`). A `SolveMetric` records the solve's wall-clock `durationMs`, `ok`, a `failureKind` (`timeout` | `client_abort` | `rate_limited` | `share_cap` | `too_large` | `compute_error` | `ok`), Grasshopper `errorCount`/`warningCount`, and attribution: `definitionId` + `versionId` (so timings compare across definition versions), `orgId`, and `channel`. Adds the `runSolveMetricSinkConformance` testing suite.
  - **supabase-provider**: `SupabaseSolveMetricSink` persists every solve to the new `selva.solve_metrics` table (with the triggering user in `actor_id`). Exposed off `SupabaseDataProvider` so it wires automatically when the Supabase data provider is selected. Includes the migration and a conformance test.
  - **selva**: the compute route now records one metric per solve attempt — including attempts rejected before the solve runs (rate limit, share-link cap) — and distinguishes a genuine solve timeout from a client disconnect. A successful solve of a local definition also bumps that definition's `solveCount` (the "N runs" stat shown on definition cards/lists), which was previously never incremented.

## 4.4.0

### Minor Changes

- 8039673: Harden and extend the compute server. SSRF protection on compute requests is
  substantially stronger: URL validation now rejects a wider range of internal,
  loopback, and metadata-endpoint targets before any outbound fetch. Compute
  request/response limits were updated, the `/api/compute` route was simplified,
  and file-import now accepts URLs with improved error handling. The
  WebSocket solve driver gained richer logging and dynamic asset loading, and
  display handling supports non-mesh display items and preview geometry.

## 4.3.5

### Patch Changes

- a52aed3: Fix premature "back online" verdict after an admin update. The update poller declared the app online as soon as `/api/health` reported a fresh `instanceId`, but that lightweight endpoint answers a beat before the app can serve real routes through the proxy — so an immediate health-check click could race a 502. The poller now additionally requires the heavier `/admin/api/system/health` route to answer 200 before reporting "back online" (gated on HTTP reachability, not its verdict, so a degraded-but-up instance still counts as online).

## 4.3.4

### Patch Changes

- a315803: Admin dashboard: show the installed `@selvajs/selva` version instead of the Selva repo's git commit.

  The General admin page had a "Web app build" card populated from build-time `__GIT_*__` constants — i.e. the last commit of the Selva monorepo when the package was published, not anything the operator controls. On an npm deployment that showed confusing values like "Merge pull request #82…". Replaced it with an "Installed version" card sourced from the deployment's own `@selvajs/selva` package version, and removed the now-dead git-info plumbing (vite `define`, `app.d.ts` globals, eslint globals).

## 4.3.3

### Patch Changes

- e9579b9: Admin updater: npm-only, with an "update available" indicator.
  - The admin update runner no longer reports "online" before the new process is actually serving. `/api/health` now returns a per-boot `instanceId`; the post-restart poller waits for it to change, which reliably distinguishes a fresh process (the old git-commit fingerprint was always null under npm, so the poller fell back to a race that latched onto the dying old process — a reload then hit a 503).
  - Removed the git/`scripts/update.sh` self-update path from the admin endpoint. Deployments update via npm (`npm update @selvajs/*`) exclusively; the dead `commit` field is gone from `/api/health`.
  - The System page now checks the npm registry on load and shows an "update available — vX → vY" badge when a newer `@selvajs/selva` is published. Degrades silently if the registry is unreachable.

## 4.3.2

### Patch Changes

- 448e52e: Fix: the admin update runner no longer reports "online" before the new process is actually serving.

  The post-restart poller keyed on a git commit hash from `/api/health` to detect the new process. In npm-mode deployments there's no git repo, so the hash was `null` on both old and new processes — the check fell back to "two successful health checks = online", which the still-running old process satisfied moments before PM2 killed it. Result: the UI declared success (without a version transition), but a reload hit a 503 until the new process finished booting. `/api/health` now returns a per-boot `instanceId` (and the installed `version`); the poller waits for the `instanceId` to change, which works in every deployment shape and correctly distinguishes a fresh process — including same-version rollbacks/reinstalls.

## 4.3.1

### Patch Changes

- 88660fa: Fix: extract a definition's schema on the compute server the upload selects, not the org/global default.

  `POST /api/compute/schema` resolved a server without a definition pin, so the pre-upload schema preview always ran on the org default → global default. If the upload dialog selected a non-default server, the schema was extracted on a different server than the one that later solves the definition — masking server-specific differences (e.g. block-instance support in the VektorNode Compute fork). The endpoint now accepts a `computeServerId` query param and threads it as the resolution pin, mirroring `POST /api/definitions`. The Add Definition dialog sends the selected server and re-validates when that selection changes.

## 4.3.0

### Minor Changes

- 7db97cb: Raise the `/api/compute` request body cap to fit `file` widget uploads. A file input embeds its geometry as base64 inside `values`, inflating the raw bytes by ~4/3, so a worst-case body for the 150 MB client file cap is ~200 MB. `COMPUTE_REQUEST_MAX_BYTES` now defaults to 210 MB (was 5 MB), and the `BODY_SIZE_LIMIT` guidance in `.env.example` is updated to `210M` to stay above it. Both remain overridable via env.

## 4.2.1

### Patch Changes

- 4b2fa03: Fix production build crashing when runtime secrets are absent.

  Provider wiring in `providers.server.ts` previously instantiated auth/data/storage
  providers at module-import time, which calls `*.fromEnv()` and validates required
  secrets (e.g. `SELVA_HMAC_KEY`). Because `vite build` loads the SSR bundle, this made
  **building** the app require a full runtime environment — CI builds without those vars
  crashed with `Missing required env var: SELVA_HMAC_KEY`.

  Provider instantiation is now lazy and memoized via `resolveProviders()`: it runs on the
  first request rather than at import. Importing the module is side-effect free, so builds
  no longer need deployment secrets. Internal value exports (`tenancy`, `branding`,
  `flags`, `definitionService`) became accessor functions (`getTenancy()`, `getBranding()`,
  `flag()`, `getDefinitionService()`); the `providers` export is kept as a lazy proxy for
  backward compatibility.

## 4.0.0

### Minor Changes

- 9ded581: Cache each definition version's compute-extracted UI schema on the version row, and make schema extraction a hard upload gate.

  `DefinitionVersion` gains optional `schema` + `schemaExtractedAt`, and `IDefinitionStore` gains `setVersionSchema`. On upload, the schema is now extracted and validated against Rhino.Compute **before** any blob or version row is written — a compute outage or a definition with no valid `Schema` output rejects the upload (503 / 422) with nothing persisted. The render path reads the cached schema instead of re-fetching it from compute on every load, falling back to a live fetch (plus a temporary solve-time backfill) for versions uploaded before this change.

  `@selvajs/platform` now re-exports the `UISchema` type from `@selvajs/schemas` (types-only dependency). The Supabase provider adds a `0002` migration creating `definition_versions.schema` / `schema_extracted_at` (and the previously-missing `change_note`) columns.

## 3.0.0

### Patch Changes

- 3e5ebe3: Prep the render path for server-resolved `bound` inputs.

  Extracted the `library/[guid]` render path into a reusable `loadDefinitionForRender` helper so the bound-input solve path has a single home. The boot-time integrity check now fires on the first request instead of at module load, so test files importing the route-classification helpers no longer trip provider lookups before their fakes are wired.

- 3e5ebe3: Remove the temporary forward-auth debug instrumentation from the login flow now that header-auth deployments have stabilized.

  Removed the `/login` miss header dump in the SvelteKit hook layer and the original debug `Debug: request headers` block. The login page now distinguishes "proxy forwarded no identity headers" from "headers arrived but the user isn't allowlisted", and shows a redacted request-header snapshot in both forward-auth failure cases as a stabilization aid.

## 2.0.11

### Patch Changes

- ac63500: Add temporary debug logging of incoming request headers to diagnose forward-auth header forwarding on fresh deployments.
  - `@selvajs/header-auth-provider`: `identifyFromHeaders` now logs every header received whenever identification fails (no UPN, disabled entry, or UPN not in the allowlist). Logs are tagged `[HeaderAuth][debug]` for easy grepping and run per-request, not once per process, so operators can compare attempts back-to-back. Exports two helpers — `dumpHeaders(headers)` and `snapshotHeaders(headers)` — so callers can reuse the same format.
  - `@selvajs/selva`: the SvelteKit hook layer dumps full request headers on every `/login` miss under proxy-auth, and `/login` itself now renders a collapsible `Debug: request headers` block listing every header name and value when `hasProxyAuth` is true. This lets operators verify forward-auth wiring without server log access.
  - `@selvajs/platform`: `IProxyAuth.hasNoIdentityHeaders` and `IProxyAuth.configuredHeaderNames` are no longer optional. The only implementer (`HeaderAuthProvider`) already supplied both, and making them required removes the `?.` fallbacks at the hook layer.

  These are intentionally noisy and intended to be removed once header-auth deployments stabilize. Search the codebase for `[HeaderAuth][debug]` and `DEBUG (temporary, remove after deployment stabilizes)` to find every site.

## 2.0.10

### Patch Changes

- 48c6886: Improve forward-auth diagnostics on the login page.
  - If a user is already authenticated (cookie session OR forward-auth headers) when they land on `/login`, they're now redirected to `?redirectTo=` or `/library` instead of seeing the confusing "your proxy didn't forward the identity headers" fallback message that was rendered even when forward-auth was working correctly.
  - The header-auth provider now emits a one-shot `[HeaderAuth]` warning on the first request that arrives with none of the configured `SELVA-*` identity headers, naming the expected headers and pointing operators at the README. A second one-shot warning fires when `/login` is hit and proxy identification fails, distinguishing "no headers arrived at all" (proxy bypassed or misconfigured) from "headers arrived but UPN missing or user not allowlisted". Throttled per-process so anonymous traffic doesn't spam the logs.

- 74252bd: Skip the header-auth bootstrap-wiring (and its stale-provider warning) when the configured auth provider doesn't expose `proxyAuth`. Previously, deployments using `LocalAuthProvider` or `SupabaseAuthProvider` that also set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` would see a misleading `[selva] BOOTSTRAP_INSTANCE_ADMIN_EMAIL is set but the installed @selvajs/header-auth-provider does not expose setBootstrapAllowlistPolicy…` warning on boot, even though the env var is correctly consumed by the OAuth/password bootstrap path. The warning is now only emitted when the active provider is actually a proxy-style auth provider that's out of date.

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
