# @selvajs/builder-app

## 0.9.0

### Minor Changes

- **WebDisplay: Layer input + Scene Manager rewrite**

  ### Plugin (C#)
  - New `Layer` (`L`) input on `WebDisplay` for grouping meshes in the scene manager (e.g. `"Structure/Walls"`)
  - `MeshMetadata` now carries `layer` and `originalIndex` fields for traceability back to the GH input tree
  - `MeshBatch` now carries `sourceComponentId` (the component `InstanceGuid`) so the viewer can identify which GH component produced each batch
  - `GH_WebDisplayUpgrader_To_0_9`: automatically migrates existing GH files to the new input layout
  - `OBSOLETE_WebDisplay_UntilV0_8_3.cs` added for backward compatibility
  - Component GUID updated (`9B5515B2` → `4F7A9C2E`); `Name` input label shortened from `"Mesh Name"` to `"Name"`
  - Metadata merging improved: when a branch has more metadata strings than geometry items, all entries are merged into one dictionary for that mesh

  ### @selvajs/ui

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

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.9.0

## 0.8.4

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.8.4

## 0.8.3

### Patch Changes

- Updated dependencies
  - @selvajs/ui@0.8.3
