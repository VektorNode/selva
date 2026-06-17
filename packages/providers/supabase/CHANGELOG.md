# @selvajs/supabase-provider

## 0.14.1

### Patch Changes

- @selvajs/platform@0.14.1

## 0.14.0

### Minor Changes

- fed3a9e: Capture per-solve timing and outcome telemetry.
  - **platform**: new pluggable `ISolveMetricSink` provider (`SelvaConfig.solveMetrics`, defaults to `NoopSolveMetricSink`). A `SolveMetric` records the solve's wall-clock `durationMs`, `ok`, a `failureKind` (`timeout` | `client_abort` | `rate_limited` | `share_cap` | `too_large` | `compute_error` | `ok`), Grasshopper `errorCount`/`warningCount`, and attribution: `definitionId` + `versionId` (so timings compare across definition versions), `orgId`, and `channel`. Adds the `runSolveMetricSinkConformance` testing suite.
  - **supabase-provider**: `SupabaseSolveMetricSink` persists every solve to the new `selva.solve_metrics` table (with the triggering user in `actor_id`). Exposed off `SupabaseDataProvider` so it wires automatically when the Supabase data provider is selected. Includes the migration and a conformance test.
  - **selva**: the compute route now records one metric per solve attempt — including attempts rejected before the solve runs (rate limit, share-link cap) — and distinguishes a genuine solve timeout from a client disconnect. A successful solve of a local definition also bumps that definition's `solveCount` (the "N runs" stat shown on definition cards/lists), which was previously never incremented.

### Patch Changes

- Updated dependencies [fed3a9e]
  - @selvajs/platform@0.14.0

## 0.13.5

### Patch Changes

- 2655d2e: Soft-deleted projects no longer occupy their slug/name permanently. The schema's
  `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional,
  so a tombstoned project — invisible to every store read (which filter
  `deleted_at is null`) — still blocked recreating a project on the same slug/name
  (`createProject` hit 23505). Both guards are now partial unique indexes
  `where deleted_at is null`, matching the rest of the schema, so create-after-delete
  just works.
- Updated dependencies [8039673]
  - @selvajs/platform@0.13.0

## 0.13.5-beta.2

### Patch Changes

- 2655d2e: Soft-deleted projects no longer occupy their slug/name permanently. The schema's
  `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional,
  so a tombstoned project — invisible to every store read (which filter
  `deleted_at is null`) — still blocked recreating a project on the same slug/name
  (`createProject` hit 23505). Both guards are now partial unique indexes
  `where deleted_at is null`, matching the rest of the schema, so create-after-delete
  just works.

## 0.13.5-beta.1

### Patch Changes

- Roll beta prerelease.

## 0.13.5-beta.0

### Patch Changes

- 9712a7f: Fix soft-deleted projects permanently occupying their slug and name. The `(org_id, slug)` and `(org_id, lower(name))` uniqueness guards were unconditional, so a tombstoned project blocked re-creating a project with the same slug/name even though every store read filters `deleted_at is null`. Replaced both with partial unique indexes (`where deleted_at is null`), matching the rest of the schema, so create-after-delete works.

## 0.13.4

### Patch Changes

- @selvajs/platform@0.12.3

## 0.13.3

### Patch Changes

- @selvajs/platform@0.12.2

## 0.13.2

### Patch Changes

- @selvajs/platform@0.12.1

## 0.13.1

### Patch Changes

- 1f6afe3: Pin `selva.set_updated_at()` to an empty `search_path` via a new migration, resolving the Supabase linter `function_search_path_mutable` warning.

## 0.13.0

### Minor Changes

- e7d2adb: Move all engine tables into a dedicated `selva` Postgres schema instead of `public`.

  A consuming app sharing the same database now keeps `public` entirely for its own tables — `selva.projects` and a consumer's `public.projects` can coexist, removing the name-clash that previously forced consumers to rename around the engine. The data clients are constructed with `db: { schema: 'selva' }`, the initial migration creates the schema, grants the standard roles, and exposes it to PostgREST via `alter role authenticator set pgrst.db_schemas` (done from the migration, not `config.toml`, to avoid the boot-before-migrations race).

  **Breaking for existing databases on the old `public` layout.** This is a table relocation, not an additive change. A fresh install (`db reset` / first `db push`) just works. A database with live data on the old layout needs a data-preserving `alter table … set schema selva` migration path — not covered by the fresh-install SQL. Consumers referencing engine objects from their own migrations must qualify them with `selva.` (`references selva.orgs`, `selva.is_org_member()`, `selva.is_instance_admin()`, `selva.set_updated_at()`).

  Also fixes a pre-existing missing UPDATE RLS policy on `definition_versions` that caused `setVersionSchema` to silently write 0 rows for user-scoped callers.

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
