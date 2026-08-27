# @selvajs/local-provider

## 0.15.3

### Patch Changes

- f763878: Document that `GuidSchema` is the prototype-pollution guard for the definition stores.

  The stores index plain objects by guid (`config.definitions[guid]`), so the UUID regex is
  load-bearing beyond format validation: it is what keeps `__proto__` and `constructor` out of
  a key position. `LocalDefinitionStore.live()` does not stop a prototype lookup on its own —
  `definitions['__proto__']` returns `Object.prototype`, whose `deletedAt` is undefined, so it
  passes as a live record and the caller's `Object.assign` writes onto the prototype.

  Comments only; no behavior change. Both are noted at the point a future entry point would
  have to preserve the invariant.

- Updated dependencies [f763878]
  - @selvajs/platform@0.20.1

## 0.15.2

### Patch Changes

- Updated dependencies [4d16b79]
  - @selvajs/platform@0.20.0

## 0.15.1

### Patch Changes

- 66945ae: Close the six findings from the app security audit.

  **One setting needs an operator's hand — the code cannot apply it.**

  `ADDRESS_HEADER=X-Forwarded-For` and `XFF_DEPTH=<proxy count>` were already documented but unset. Without them `getClientAddress()` returns the socket peer, which behind a reverse proxy is `127.0.0.1` for every request from every user — so the login limiter had exactly one bucket. Five failed logins from anywhere returned 429 to everyone, and only a successful login clears a bucket, which nobody could then reach. Cheap unauthenticated denial of service against a whole instance, renewable indefinitely.

  Four changes cover the gap until an operator sets them. A per-account failure counter now runs alongside the per-IP one, keyed on the normalized email — per-IP bounds nothing against an attacker spread across source addresses, and per-account is what protects a targeted user. The app logs a warning the first time a login arrives from loopback with `ADDRESS_HEADER` unset. `selva doctor` reports the pair as red when `ORIGIN` is set (a proxy is in play) and `ADDRESS_HEADER` is not, and yellow when `X-Forwarded-For` is trusted without an `XFF_DEPTH` to say which hop is real. And `selva proxy` prints the two lines to add after it configures Caddy, since that is the moment the operator creates the condition.

  Doctor stays quiet when `ORIGIN` is unset. On a directly-reachable app these settings are a footgun — `X-Forwarded-For` is client-supplied, so trusting it there lets any caller choose their own rate-limit bucket.

  Caddy needs no change: `reverse_proxy` already sends the header. Only the app's willingness to trust it was missing.

  **The rest carry no deployment impact.**

  A compute `serverUrl` saved at `/admin/compute` is validated: `http`/`https` only, and never the link-local range. That URL is fetched server-side on every status probe and every solve, so an unfiltered one lets whoever holds `manage_compute` point the app at `http://169.254.169.254/latest/meta-data/` and read the host's own cloud credentials. Loopback and LAN addresses stay allowed, since running compute on `localhost` or an internal box is the ordinary self-hosted layout — blocking those would break working deployments and push operators toward disabling the guard entirely. `169.254.0.0/16` is the one range no legitimate compute server uses.

  `/admin/*`, `/setup` and `/login` are no longer framable. Selva apps are built for iframe embedding and app routes stay that way, but that tradeoff was being applied uniformly, leaving an authenticated instance admin open to UI-redress. `applySecurityHeaders` gained an opt-in `denyFraming` option — additive, so existing callers are unaffected.

  The OAuth callback checks a CSRF nonce before exchanging the code. It is a GET that mints a session cookie, and SvelteKit's origin check only covers form POSTs, so an attacker could capture a `?code=` from their own flow and induce a victim to load it — silently signing the victim into the attacker's account, where everything they then do is visible. Supabase does not expose the real OAuth `state` and `exchangeOAuthCode` takes only `code`, so the nonce is minted at `/auth/supabase/start`, carried on the callback URL, and compared against a short-lived cookie. Single-use, cleared on failure as well as success.

  `auth-users.json` and `compute.config.json` are written `0600` in a `0700` directory. The shared write helper set no mode, and `rename` preserves the temp file's umask bits, so PBKDF2 password hashes were landing world-readable — any other local user or co-tenant service on the host could copy and crack them offline. No-op on Windows.

  API 500s log through pino instead of raw `console.error`. Provider adapters stash connection details on `cause`, and handing that object to stdout puts it somewhere redaction never runs and erasure cannot follow.

  `SELVA_HMAC_KEY` now refuses the `.env.example` placeholder. At 41 characters it cleared the 32-char minimum, so an operator who copied the file without rotating booted with a session-signing key that is public in this repo — every token forgeable. `selva doctor` caught it, but nothing forces anyone to run doctor.

- Updated dependencies [6fa6b27]
  - @selvajs/platform@0.19.1

## 0.15.0

### Minor Changes

- e779034: Make the first-admin bootstrap atomic, so "first signer wins" is true under concurrency.

  `bootstrapUserSession` asked `hasInstanceAdmin()` and then called `set()` — two
  round-trips with nothing holding the gap. On a single-tenant install with no
  `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` configured, `shouldBootstrapAdmin` returns true
  for _any_ signer, so two different people signing in at the same moment both
  observed "no admin yet" and both were granted every platform permission,
  permanently. Permissions.md §2 promises the first signer wins; it was aspiration.

  `IPlatformPermissionStore` gains `claimFirstInstanceAdmin(ctx, userId,
permissions)`, which grants only if no enabled `instance_admin` exists and
  returns whether this call was the one that claimed it. It is the mirror of the
  sole-admin invariant already enforced in `set`: that one refuses to drop the
  _last_ admin, this one refuses to create a _second first_ admin.

  Supabase implements it as a `SECURITY DEFINER` RPC
  (`selva.claim_first_instance_admin`) taking a transaction-scoped advisory lock,
  then re-reading inside it. There is no row to lock — the whole point is that no
  admin row exists yet — so the `for update` approach used for the last-admin
  invariant does not apply here, and a bare `not exists` in the `UPDATE` predicate
  would not work either: under READ COMMITTED both racers read the snapshot taken
  when their statement began and both see an empty set. A caller that blocks on
  the advisory lock re-reads after the winner commits and correctly loses.

  Local shares the existing promise-chain mutex with `updatePermissionsGuarded`,
  deliberately: the two decide the same question from opposite ends, so they must
  not interleave with each other any more than with themselves.

  `platformPermissionStoreSuite` gains two cases — a sequential claim-then-refuse,
  and a four-way concurrent burst asserting exactly one admin results. Both
  adapters are pinned to the same contract.

  Supabase deployments need the new migration
  (`20260817200000_atomic_first_admin_claim.sql`); `EXPECTED_MIGRATION_HEAD` moves
  with it, so a stale database fails the startup check rather than silently
  running the old path.

- e779034: Make the sole-`instance_admin` invariant atomic in both providers.

  `set` checked the surviving-admin count and wrote in two steps with nothing
  holding the gap. Two admins demoting each other at the same moment each observed
  the other as "another admin exists", both passed, and both committed — leaving
  zero instance admins and an instance that can no longer be administered through
  the UI. Permissions.md §2 states the invariant as absolute; it was not.

  Supabase moves the check inside a `SECURITY DEFINER` RPC
  (`selva.set_platform_permissions`) that locks the target row and then the
  surviving admin rows with `for update`, so concurrent demotions serialize
  instead of racing. A bare `exists` in the `UPDATE` predicate is not sufficient
  under READ COMMITTED — the subquery reads the statement's snapshot — and the
  conformance suite fails without the explicit locks.

  Local serializes guarded permission writes through a promise-chain mutex and
  counts inside the critical section, matching the single-process boundary its
  load-once cache already assumes.

  `platformPermissionStoreSuite` gains two concurrency cases (a mutual demotion of
  two admins, and a four-way burst) so both adapters are pinned to the same
  contract: exactly one demotion wins and `hasInstanceAdmin` stays true.

### Patch Changes

- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
  - @selvajs/platform@0.19.0

## 0.14.1

### Patch Changes

- Updated dependencies [679a24f]
  - @selvajs/platform@0.18.0

## 0.14.0

### Minor Changes

- 4512068: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- 4512068: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- 4512068: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
  - @selvajs/platform@0.17.0

## 0.14.0-beta.3

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- Updated dependencies [39db6f5]
  - @selvajs/platform@0.17.0-beta.3

## 0.13.2-beta.2

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [a011c5e]
  - @selvajs/platform@0.16.1-beta.2

## 0.13.2-beta.1

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- Updated dependencies [0e2c428]
  - @selvajs/platform@0.16.1-beta.1

## 0.13.2-beta.0

### Patch Changes

- @selvajs/platform@0.16.1-beta.0

## 0.13.1

### Patch Changes

- Updated dependencies [efb003a]
  - @selvajs/platform@0.16.0

## 0.13.0

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

### Patch Changes

- Updated dependencies [5077fe9]
- Updated dependencies [b8607d4]
- Updated dependencies [243ae19]
- Updated dependencies [a8e1b47]
  - @selvajs/platform@0.15.0

## 0.13.0-beta.2

### Minor Changes

- 21124cb: Ship the `getServerApiKey` implementations on both compute-server stores
  (`SupabaseComputeServerStore`, `LocalComputeServerStore`).

  The method was added to `IComputeServerStore` and both provider sources in the
  same commit as the structured-logging work, but neither provider carried a
  changeset — so the published `@selvajs/supabase-provider@0.14.4-beta.1` and
  `@selvajs/local-provider@0.12.8-beta.1` tarballs (released three days earlier)
  predate it, while `@selvajs/platform@0.15.0-beta.2` now publishes the interface
  requiring it. Against the published providers, `@selvajs/selva` code paths that
  call `store.getServerApiKey(...)` (compute resolve, admin health/status/actions
  routes) fail with a runtime `TypeError`, and consumers fail to typecheck the
  store against the current platform interface. This release publishes provider
  builds that actually carry the method.

## 0.12.8-beta.1

### Patch Changes

- Updated dependencies
  - @selvajs/platform@0.15.0-beta.1

## 0.12.8-beta.0

### Patch Changes

- @selvajs/platform@0.14.3-beta.0

## 0.12.7

### Patch Changes

- @selvajs/platform@0.14.2

## 0.12.6

### Patch Changes

- @selvajs/platform@0.14.1

## 0.12.5

### Patch Changes

- Updated dependencies [fed3a9e]
  - @selvajs/platform@0.14.0

## 0.12.4

### Patch Changes

- Updated dependencies [8039673]
  - @selvajs/platform@0.13.0

## 0.12.3

### Patch Changes

- @selvajs/platform@0.12.3

## 0.12.2

### Patch Changes

- @selvajs/platform@0.12.2

## 0.12.1

### Patch Changes

- @selvajs/platform@0.12.1

## 0.12.0

### Minor Changes

- 9ded581: Cache each definition version's compute-extracted UI schema on the version row, and make schema extraction a hard upload gate.

  `DefinitionVersion` gains optional `schema` + `schemaExtractedAt`, and `IDefinitionStore` gains `setVersionSchema`. On upload, the schema is now extracted and validated against Rhino.Compute **before** any blob or version row is written — a compute outage or a definition with no valid `Schema` output rejects the upload (503 / 422) with nothing persisted. The render path reads the cached schema instead of re-fetching it from compute on every load, falling back to a live fetch (plus a temporary solve-time backfill) for versions uploaded before this change.

  `@selvajs/platform` now re-exports the `UISchema` type from `@selvajs/schemas` (types-only dependency). The Supabase provider adds a `0002` migration creating `definition_versions.schema` / `schema_extracted_at` (and the previously-missing `change_note`) columns.

### Patch Changes

- Updated dependencies [9ded581]
- Updated dependencies [9ded581]
  - @selvajs/platform@0.12.0

## 0.11.0

### Minor Changes

- Publish the platform interface package and its local + Supabase provider
  implementations to npm. These were previously workspace-private; they are now
  public so external apps can build on the Selva engine (provider interfaces +
  reference implementations) without vendoring the source.

### Patch Changes

- Updated dependencies [3e5ebe3]
- Updated dependencies
  - @selvajs/platform@0.11.0

## 0.2.0

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
  - @selvajs/platform@0.2.0
