# @selva/builder-app

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

  ### @selva/shared

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

  **selva-compute bumped to `1.4.0`**

### Patch Changes

- Updated dependencies
  - selva-shared@0.9.0

## 0.8.4

### Patch Changes

- Updated dependencies
  - selva-shared@0.8.4

## 0.8.3

### Patch Changes

- Updated dependencies
  - selva-shared@0.8.3

## 0.4.1

### Patch Changes

- Updated dependencies [b9d05f8]
- Updated dependencies
  - @selva/shared@1.4.0

## 0.4.0

### Patch Changes

- bc602c2: Add explicit drag handles to prevent interference with interactive elements

  **Changes:**
  - **Drag Handles**: Added `GripVertical` icons as dedicated drag handles for tabs, groups, and group items
  - **Improved UX**: Text inputs, number inputs, and other controls are now fully interactive without accidentally triggering drag operations
  - **Visual Feedback**: Drag handles show hover background (`hover:bg-accent`) to clearly indicate draggable areas
  - **Cleaner Implementation**: Removed workarounds like `onmousedown`/`onmouseup` handlers that disabled dragging on inputs

  **Affected Components:**
  - `BuilderGroupItem`: Drag handle for input/output parameters
  - `EditableGroup`: Drag handle for group reordering
  - `EditableTabNav`: Drag handle for tab reordering

  **Technical Details:**
  - Only the drag handle element is `draggable="true"` instead of the entire container
  - Handles use `self-start` positioning to match icon size rather than spanning full height
  - Standard grip-vertical icon provides clear visual affordance for drag operations

- Updated dependencies [71fe8f7]
- Updated dependencies [bc602c2]
- Updated dependencies [bc602c2]
  - @selva/shared@1.3.0

## 0.3.0

### Patch Changes

- Updated dependencies [cd6ad4b]
  - @selva/compute@1.2.0
  - @selva/shared@1.2.0

## 0.2.0

### Minor Changes

- **Schema Builder Enhancements**
  - Improve drag-and-drop schema designer with better state management
  - Add SchemaImportDialog and SchemaInfoPanel for schema management
  - Enhance BuilderSidebar, TabEditor, and EditableGroup components
  - Add schema exporter utility for saving and sharing schemas

  **WebSocket & Communication**
  - Enhance WebSocket handling with message batching and backpressure management
  - Improve session ID handling and connection state management
  - Add better reconnection logic and error handling

  **UI/UX Improvements**
  - Migrate to @selva/shared components for consistency
  - Update layout classes for improved responsiveness
  - Add error screen component
  - Improve URL construction for Grasshopper definitions

  **Developer Experience**
  - Add comprehensive app configuration
  - Improve code structure and readability
  - Update favicon and branding assets
  - Add robots.txt and web app manifest

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @selva/compute@1.1.0
  - @selva/shared@2.0.0
