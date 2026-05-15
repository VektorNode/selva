# Schema Changelog

## 2.0.2

## 2.0.1

## 2.0.0

### Patch Changes

- 9cd112b: **v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.
  - **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
  - **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
  - **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
  - **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

  See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.

## 1.2.0

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

All notable changes to the Selva UI schema will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Schema Versioning

- **MAJOR** version (e.g., 1.x.x → 2.0.0): Breaking changes that require migration
- **MINOR** version (e.g., 1.0.x → 1.1.0): Backward-compatible additions
- **PATCH** version (e.g., 1.0.0 → 1.0.1): Bug fixes and documentation

## [2.8.0] - 2026-05-08

### Added

- `InputSource` - New optional object on `LayoutItemBase` with shape `{ kind: 'user' | 'external' }`. Declares where an input's value comes from. Absent or `kind: 'user'` = normal control behavior (unchanged). `kind: 'external'` = filled by something outside the form (e.g. a producer route writing to sessionStorage). Object form (not boolean) so future kinds (`pre-step`, `linked`, `computed`) can carry their own fields without a breaking schema change.

### Migration Notes

- Fully backward-compatible addition. Existing schemas load unchanged.
- Migration function `MigrateTo_2_8_0` registered in `SchemaMigrator`; no data transformation needed.

---

## [2.7.0] - 2026-04-30

### Added

- `ImageWidgetConfig` - New config object with `allowDownload` (default `true`), `allowFullscreen` (default `true`), `fitMode` (`"contain" | "cover"`, default `"contain"`), and optional `backgroundColor` (hex string)
- `OutputImageLayoutItem` - New output layout item with `widgetType: "image"` for rendering image files (PNG/JPG/WEBP/GIF/SVG) inline. Reuses the existing file output pipeline; the builder picks `image` instead of `file` when an inline viewer is preferred over a download button
- `LayoutItem` union - Added `OutputImageLayoutItem`

### Migration Notes

- Fully backward-compatible addition. Existing schemas load unchanged.
- Migration function `MigrateTo_2_7_0` registered in `SchemaMigrator`; no data transformation needed.

---

## [2.4.0] - 2026-04-01

### Added

- `ChartWidgetConfig` - Optional config with `allowedTypes` array to restrict which chart types the user can switch between (`scatter`, `bar`, `pie`, `histogram`)
- `OutputChartLayoutItem` - New output layout item with `widgetType: "chart"` for rendering Plotly figures from `fig.to_json()` output with a client-side chart type switcher
- `LayoutItem` union - Added `OutputChartLayoutItem`
- `DiscoveredOutput.type` and `SchemaOutput.type` - Added `"chart"` variant

### Migration Notes

- Fully backward-compatible addition. Existing schemas load unchanged.
- Migration function `MigrateTo_2_4_0` registered in `SchemaMigrator`; no data transformation needed.

---

## [2.3.0] - 2026-03-08

### Added

- `GrasshopperInputStructure` - New string enum type with values `"item"`, `"list"`, `"tree"` mirroring Grasshopper's data access modes (Item Access, List Access, Tree Access)
- `SchemaInput.inputStructure` (GrasshopperInputStructure, optional, default: `"item"`) - Declares the intended data access mode for the input parameter. Currently stored for future use by the value applicator and compute pipeline; does not change runtime behaviour in this release.

### Migration Notes

- Fully backward-compatible. Existing schemas without `inputStructure` will deserialize with the default value `"item"` (Item Access), matching the previous implicit behaviour.
- Migration function `MigrateTo_2_3_0` registered in `SchemaMigrator`; no data transformation is performed — the C# model default handles it transparently.

---

## [2.2.0] - 2026-03-08

### Added

- `GrasshopperParamType` - Added `"color"` variant for Grasshopper `Param_Colour` parameters
- `ColorWidgetConfig` (object, optional, no properties) - Configuration type for color input widget (reserved for future options)
- `InputColorLayoutItem` - New input layout item with `widgetType: "color"` for rendering a native browser color picker
- `LayoutItem` union - Added `InputColorLayoutItem` to the discriminated union

### Migration Notes

- Fully backward-compatible addition. Existing schemas without color widgets load without changes.
- Old plugin versions that do not know `widgetType: "color"` will fall back to their default unknown-widget handling.

---

## [1.0.0] - 2024-12-15

Initial schema release with comprehensive UI builder functionality.

### Added

**Core Schema Structure**

- `UISchema` - Main schema container with metadata, versioning, and configuration
- `schemaVersion` - Semantic version tracking (1.0.0)
- `pluginVersion` - Version of plugin that created the schema
- `minPluginVersion` - Minimum plugin version required to use schema

**Parameter Definitions**

- `InputParamSchema` - Input parameter configuration with Grasshopper metadata
- `OutputParamSchema` - Output parameter configuration
- `GrasshopperParamType` - Enum for parameter types (number, integer, boolean, text, valueList, generic)
- `AvailableInput` / `AvailableOutput` - Discovered parameters from Grasshopper document
- `AvailableParameters` - Collection of available inputs and outputs with session info

**Widget Configurations**

- `NumberWidgetConfig` - Number input with min, max, stepSize, renderAsSlider options
- `TextWidgetConfig` - Text input with placeholder and required flag
- `DropdownWidgetConfig` - Dropdown with options dictionary and required flag
- `CheckboxWidgetConfig` - Boolean checkbox widget

**Layout System** (Discriminated Union)

- `LayoutItem` - Union type for all layout items
- `InputNumberLayoutItem` - Number input layout configuration
- `InputTextLayoutItem` - Text input layout configuration
- `InputDropdownLayoutItem` - Dropdown input layout configuration
- `InputCheckboxLayoutItem` - Checkbox input layout configuration
- `OutputTextLayoutItem` - Text output display configuration
- `OutputNumberLayoutItem` - Number output display configuration
- `OutputFileLayoutItem` - File output display configuration

**Layout Organization**

- `GroupConfig` - Collapsible groups with items, label, columns, order
- `TabConfig` - Tabs containing groups with position (left/center/right)
- `LayoutConfig` - Top-level layout with type (tabbed/flat), gap, tabs array

**Runtime & Persistence**

- `SessionState` - Active session tracking with sessionId, documentId, timestamps
- `RuntimeValues` - Current parameter values with timestamp
- `ParameterState` - Saved parameter state with paramId, value, groupName
- `SavedState` - Multi-parameter saved states with name, schemaId, documentId
- `ValidationIssue` - Validation errors/warnings with severity, message, details

**3D Viewer**

- `ViewerOptions` - Three.js viewer configuration (camera, controls, lighting, grid)

**Schema Features**

- `instanceSolve` - Auto-compute flag for Grasshopper solver
- `author`, `organization` - Schema authorship metadata
- `tags` - Array of tags for categorization
- `created`, `lastModified` - Timestamp tracking

### Technical Implementation

**C# Code Generation**

- 100% schema-driven C# class generation
- Automatic discriminated union detection via `oneOf` patterns
- Auto-generated JSON converters for polymorphic types
- Base class generation from common properties
- Type-safe deserialization with discriminator fields

**TypeScript Code Generation**

- Full TypeScript interface generation from JSON Schema
- Type guard functions for discriminated unions
- Type aliases for union convenience
- Re-exported from single index file

**Migration System**

- `SchemaMigrator.cs` - Version validation and migration framework
- `CURRENT_SCHEMA_VERSION` tracking
- `PLUGIN_VERSION` auto-detection from assembly
- `minPluginVersion` compatibility checking
- `IncompatibleSchemaException` for version conflicts
- Legacy schema handling (auto-upgrade schemas without version)

**Validation**

- Document ID matching (critical validation)
- Project file name matching (warning)
- Schema structure validation
- Plugin version compatibility checks

### Migration Notes

This is the initial release. No migration needed.

---

## Template for Future Releases

When adding a new version, copy this template:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

- New features, fields, or types
- Format: `TypeName.fieldName` (type, required/optional) - Description

### Changed

- Modifications to existing functionality
- Format: `TypeName.fieldName` - What changed and why

### Deprecated

- Features marked for future removal
- Format: `TypeName.fieldName` - What to use instead. Will be removed in vX.Y.Z

### Removed

- Features removed from the schema
- Format: `TypeName.fieldName` - Why removed, migration path

### Fixed

- Bug fixes
- Format: Fixed issue where `TypeName.fieldName` caused ...

### BREAKING CHANGES (if applicable)

- List all breaking changes prominently
- Explain impact and migration path
- Specify minimum plugin version requirements

### Migration Notes

- Explain how old schemas are migrated
- List any manual steps required
- Note any data transformations
```

---

## Guidelines for Updating This Changelog

1. **Update with every schema change** - Don't batch updates
2. **Be specific** - Include type names, field names, and exact changes
3. **Explain the why** - Help future developers understand rationale
4. **Include migration notes** - Document how old schemas are handled
5. **Mark breaking changes** - Use `### BREAKING CHANGES` section for major versions
6. **Link to issues/PRs** - If applicable, reference GitHub issues
7. **Use semantic versioning** - Follow MAJOR.MINOR.PATCH strictly

## Examples

### Good Changelog Entry ✅

```markdown
## [1.1.0] - 2025-01-20

### Added

- `NumberWidgetConfig.placeholder` (string, optional) - Placeholder text shown when input is empty
- `ViewerOptions.showGrid` (boolean, optional, default: true) - Toggle grid visibility in 3D viewer

### Changed

- `GroupConfig.columns` default changed from 1 to 2 for better default layout

### Deprecated

- `UISchema.tags` - Use `UISchema.metadata.tags` instead. Will be removed in v2.0.0

### Migration Notes

- Optional fields added - no migration required
- Old schemas work without changes
- `placeholder` defaults to null (no placeholder shown)
```

### Poor Changelog Entry ❌

```markdown
## [1.1.0] - 2025-01-20

### Added

- Some new fields
- Better configuration options

### Changed

- Improved layout system
- Various fixes
```

Why this is bad:

- Not specific (which fields?)
- No types or descriptions
- No migration information
- "Various fixes" is meaningless

---
