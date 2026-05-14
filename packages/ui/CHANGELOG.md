# @selvajs/ui

## 2.0.1

### Patch Changes

- @selvajs/schemas@2.0.1

## 2.0.0

### Patch Changes

- 9cd112b: **v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.
  - **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
  - **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
  - **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
  - **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

  See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.

- Updated dependencies [9cd112b]
  - @selvajs/schemas@2.0.0

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
  - @selvajs/schemas@1.2.0

## 0.9.0

### Minor Changes

- **WebDisplay: Layer input + Scene Manager rewrite**

  **Viewer refactor**
  - `Viewer.svelte` moved to `components/viewer/Viewer.svelte`; `index.ts` export updated accordingly
  - `Viewer` no longer accepts a `schema` prop — background color and feature flags are now passed via `viewerConfig`:
    - `showScreenshotButton`, `showFullscreenButton`, `showSceneManager`, `enableMeshClick`, `backgroundColor`
  - Mobile layout hides the scene manager panel by default (`showSceneManager: false`)

  **Scene Manager — full rewrite**
  - Layer-based grouping: meshes grouped by `userData.layer` (falls back to `userData.category` then `"Default"`)
  - Search bar to filter by layer name or mesh name
  - Collapsible layer groups with chevron toggle
  - Per-object and per-layer visibility toggle; partial-visibility state shown visually
  - Multi-select: `Ctrl+Click` (toggle), `Shift+Click` (range), bulk visibility toggle for selection

  **MeshMetadataDialog — new component**
  - Opens on mesh click; shows custom metadata key/value pairs
  - Filters internal keys (`name`, `layer`, `originalIndex`, `sourceComponentId`) from the table
  - Fullscreen-aware positioning via `data-viewer-fullscreen` attribute

  **Builder**
  - Visibility rules section now renders for both input and output items (was input-only)
  - `VisibilityRulesEditor` receives `isGroupCondition={true}` for output items

## 0.8.4

### Patch Changes

- Refactor: extract solve/state logic into self-contained `ComputeApp` component
  - Add `ComputeApp.svelte` — wraps all solve logic, throttling, solving indicator, definition switching, embed mode, custom primary color, and footer registration into one component
  - Add `showSaveButton`, `showLoadButton`, `stateManagerActions` props to `ComputeApp` and `AppLayout` for flexible state manager configuration
  - Add optional `header` and `children` snippets to `ComputeApp` for custom nav/layout
  - Extract `ActionButton` type to `shared/types/actionButton.ts` and `SolveFn`/`SolveResult` to `shared/types/solveFn.ts`
  - Move `hexToOklch` color utility from compute-app

## 0.8.3

### Minor Changes

- Pin dev dependencies so they resolve correctly in external projects
