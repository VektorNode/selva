# @selvajs/ui

## 4.6.2-beta.1

### Patch Changes

- fa64d0e: Scene manager now labels line geometry as "Curve" instead of the internal Three.js class name
  (`Line2`/`LineSegments2`), which read as a 2D type. The relabel applies to both the object label
  fallback and the type column.

## 4.6.2-beta.0

### Patch Changes

- 8505304: Roll beta prerelease for @selvajs/ui.

## 4.6.1

### Patch Changes

- a196044: Update `@selvajs/compute` peer dependency to 2.0.0.

## 4.6.0

### Minor Changes

- 7db97cb: Support dynamic value lists in the preview runtime, plus a client-side file-size guard.
  - `buildDynamicValueListOptions` now takes the whole `UISchema` (was just `outputs`) and collects every `dynamicValueList` source from both `schema.outputs[]` and the layout. The layout pass is back-compat defense for schemas persisted by an older plugin that did not mirror dynamic outputs into `outputs[]`; for current schemas it finds nothing new. `TabLayout` is updated to pass the schema.
  - `FileInput` now rejects oversize uploads client-side (against `APP_DEFAULTS.FILE_UPLOAD.MAX_SIZE_BYTES`) instead of letting the request fail server-side with an opaque 413, matching the existing URL-import check.

### Patch Changes

- 9ea2137: Fix dev-mode binding warning by removing the redundant two-way binding on `values` in `AppLayout` and `TabLayout`. The `values` object is a `$state` proxy that is only ever mutated in place, so `bind:`/`$bindable()` was unnecessary and produced a "did not declare values as a binding" warning through the `AppShell` → `AppLayout` prop chain.

## 4.5.0

### Minor Changes

- d2f17d9: Surface the Solve Session API and fix the `onLoadValues` callback contract.

  **New public exports.** `createSolveSession`, `createRequestResponseDriver`, and the
  `SolveSession` / `SolveSessionArgs` / `SolveDriver` / `SolveReporter` types are now exported
  from the package root. This lets transports outside the package (e.g. a WebSocket driver)
  satisfy `SolveDriver` and drive a session. See `CONTEXT.md` for the vocabulary.

  **Fix — `AppLayout` `onLoadValues` forwards the loaded values.** Previously the callback
  fired with no argument (and its type was `() => void`), so a host subscribing to a preset
  load received `undefined`. The signature is now
  `onLoadValues?: (values: Record<string, unknown>) => void | Promise<void>` and the loaded
  values are passed through. Additive for callers that ignore the argument.

## 4.4.0

### Minor Changes

- af63f6e: Add shared schema layout-traversal helpers.

  **New — `getGroups` / `getLayoutItems` / `getInputItems`** in `@selvajs/schemas`
  (`src/traversal.ts`). One place that knows how to walk a `UISchema`'s `tabbed`/`flat`
  layout union, replacing the hand-rolled `layout.type === 'tabbed' ? tabs.flatMap(...) :
groups` branch that was duplicated across both packages. Readers are defensive — a
  missing layout or empty groups/items yields an empty result rather than throwing.
  `@selvajs/ui` re-exports all three so existing consumers are unaffected.

  Internally collapsed onto these: `getExternalInputs`, the preset exporter's group walk,
  and (in plugin-ui) `getAllLayoutItems`, `isItemUsedInLayout`, `batchSetNumberWidgetType`.

- b589841: Deepen the compute/footer/visibility internals for testability and locality.

  **New — Solve Session.** `createSolveSession` + a transport-agnostic `SolveDriver` seam
  (with `createRequestResponseDriver`) extract the value/lifecycle state machine out of
  `ComputeApp` into `lib/compute/`. Pure transition logic lives in `solve-session-core.ts`
  (unit-tested); the reactive wrapper is a thin shell. `SolveResult` is now exported from
  the public surface. See `packages/ui/CONTEXT.md` for the vocabulary.

  **New — `buildVisibilityMap` / `itemKey`** in `lib/schema/visibility-rules`: evaluate
  each layout item's visibility once per render instead of repeatedly across `Group` and
  `TabLayout`.

  **Tests.** Added coverage for `createComputeThrottle` (latest-wins, abort-on-retrigger,
  timeout, cancel) — the vitest config now loads the Svelte plugin so `.svelte.ts` rune
  modules run in tests.

  **⚠️ Footer registration API changed (potentially breaking).** `useFooterItem` and
  `FooterStore.register` now take a single typed options object instead of positional
  arguments, and `FooterItem` is generic over its component's props (no more `any`).

  Migrate call sites from:

  ```ts
  useFooterItem('ws-status', WsStatusFooter, () => ({ connected }), 'left', 10);
  ```

  to:

  ```ts
  useFooterItem({
  	id: 'ws-status',
  	component: WsStatusFooter,
  	getProps: () => ({ connected }),
  	position: 'left',
  	priority: 10
  });
  ```

  Released as a minor because the footer registration is used internally; bump to major
  in your own release if an external consumer relies on the old positional signature.

## 4.3.0

### Minor Changes

- 58edad5: Add an optional presentation mode for client-sourced inputs. An input with `source.kind === 'client'` can now set `source.client.presentation` to `'hidden'` (default, prefilled silently) or `'slot'`, where the host app renders its own element in the input's place via a new `clientSlot` snippet on `ComputeApp`. Selva reserves the cell and passes `{ inputId, displayName, slotLabel, value }` to the host snippet without interpreting it — e.g. an "Edit JSON" button that navigates back to a producer page. An optional author-set `slotLabel` is passed through untouched.

## 4.0.0

### Patch Changes

- Updated dependencies [9ded581]
  - @selvajs/schemas@4.0.0

## 3.1.0

### Minor Changes

- e6ec352: Expose customization hooks on `ComputeApp` for embedding the parameter app in external sites.
  - **Pluggable preset persistence**: new optional `onSaveState` / `onListStates` props on `ComputeApp` (threaded through `AppLayout` → `ParameterPresetManager`). When `onSaveState` is set, saving a parameter state calls it instead of downloading a `.sps` file; when `onListStates` is set, the Load dialog lists the returned presets (each routed through the existing validation flow) instead of showing a file input. Both fall back to the file-based behavior when unset, so existing apps are unchanged.
  - **Localizable preset UI**: new optional `presetLabels` prop accepts a `Partial<PresetLabels>` overriding every string in the Save/Load/validation dialogs. `PresetLabels` and `DEFAULT_PRESET_LABELS` are exported from the package root.
  - **Footer text**: new `copyrightName` and `footerText` props. `footerText` fully overrides the footer line with `{name}` / `{year}` substitution; otherwise the default `by {name} © {year}` is used.
  - **Bring-your-own header**: new `header` snippet on `ComputeApp` (and `AppShell`). When provided, it renders inside the standard sticky header bar at the fixed `--header-h` height — so the fixed-mode layout is unaffected — and takes precedence over `headerRight`.

## 3.0.0

### Patch Changes

- Updated dependencies [3e5ebe3]
  - @selvajs/schemas@3.0.0

## 2.0.11

### Patch Changes

- @selvajs/schemas@2.0.11

## 2.0.10

### Patch Changes

- @selvajs/schemas@2.0.10

## 2.0.9

### Patch Changes

- @selvajs/schemas@2.0.9

## 2.0.8

### Patch Changes

- @selvajs/schemas@2.0.8

## 2.0.7

### Patch Changes

- @selvajs/schemas@2.0.7

## 2.0.6

### Patch Changes

- @selvajs/schemas@2.0.6

## 2.0.5

### Patch Changes

- @selvajs/schemas@2.0.5

## 2.0.4

### Patch Changes

- @selvajs/schemas@2.0.4

## 2.0.3

### Patch Changes

- @selvajs/schemas@2.0.3

## 2.0.2

### Patch Changes

- @selvajs/schemas@2.0.2

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
