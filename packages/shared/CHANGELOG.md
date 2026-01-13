# @selva/shared

## 1.2.0

### Minor Changes

- cd6ad4b: ## Features

  ### Mesh Selection and Metadata System
  - **Added optional mesh click event handlers** with configurable selection highlighting
    - `onMeshMetadataClicked`: Callback fired when a mesh with metadata is clicked, returns metadata object
    - `onObjectSelected`: Callback fired when any mesh is selected, returns Three.js object
    - `onBackgroundClicked`: Callback fired when background is clicked
  - **Configurable selection color** (`selectionColor` option) - defaults to red (#ff0000), supports any CSS color or THREE.Color
  - **Material cloning on selection** - only selected mesh is highlighted without affecting other meshes sharing the same material

  ### Event Handlers Configuration
  - **`enableEventHandlers`** - Master switch to enable/disable all event listeners (defaults to true)
  - **`enableClickToFocus`** - Individual control for click-to-focus behavior
  - **`enableKeyboardControls`** - Individual control for keyboard shortcuts (F, Space, ESC)

  ### Type Safety Improvements
  - **Proper type exposure for viewer options**
    - `ProcessMeshBatchesOptions` interface for mesh batch processing
    - `EventConfig` type for all event-related options
    - `ModelUnit` type derived from valid SCALE_FACTORS keys
  - **Removed unused `any` types** in ViewerState - now properly typed with THREE.Scene, THREE.PerspectiveCamera, and OrbitControls
  - **Proper re-exports** from `@selva/shared` for convenience access to core visualization functions

  ## Breaking Changes
  - **Removed wrapper functions** from `@selva/shared`:
    - `initializeViewerScene()` - use `initThree()` directly
    - `updateViewerScene()` - use `updateScene()` directly
    - `processMeshBatches()` - use `parseMeshBatchObject()` in a loop directly

    These were thin wrappers that added minimal value. Direct access to core functions is more flexible and easier to understand.

  ## Architecture
  - **Cleaner abstraction layers** - `@selva/shared` now serves as a convenience re-export layer rather than adding unnecessary wrapper logic
  - **Metadata already attached during batch parsing** - no additional processing needed; metadata is preserved in mesh.userData
  - **Event system is optional** - can be completely disabled with `enableEventHandlers: false` for performance-critical scenarios

  ## Migration Guide

  If you were using the wrapper functions from `@selva/shared`:

  **Before:**

  ```typescript
  import { initializeViewerScene, updateViewerScene, processMeshBatches } from '@selva/shared';

  const state = await initializeViewerScene(canvas, schema);
  await updateViewerScene(state, meshes);
  const meshes = await processMeshBatches(batches, options);
  ```

  **After:**

  ```typescript
  import { initThree, updateScene, parseMeshBatchObject, SCALE_FACTORS } from '@selva/core/visualization';

  const { scene, camera, controls } = initThree(canvas, options);
  updateScene(scene, meshes, camera, controls, initialized);
  const meshes = await parseMeshBatchObject(batch, options);
  ```

  The core functions are still re-exported from `@selva/shared` for convenience, but calling them directly from `@selva/core/visualization` is recommended.

### Patch Changes

- Updated dependencies [cd6ad4b]
  - @selva/core@1.2.0

## 0.2.0

### Minor Changes

- **New Package Release**
  - Initialize @selva/shared package as centralized UI component library
  - Migrate StateManager and themeStore from builder-app for cross-app reusability

  **UI Components**
  - Add comprehensive shadcn-svelte component set (alert-dialog, badge, button, card, checkbox, dialog, input, label, select, separator, slider, switch, tabs, textarea)
  - Add FileInput component with drag-and-drop support and file validation
  - Add PageFooter, PageHeader, and PageContainer layout components
  - Add ThemeSwitcher component with dark/light mode support

  **Theme System**
  - Implement theme management system with multiple presets (Selva, Ocean, Cyberpunk, Neutral)
  - Add theme store with reactive state management
  - Include custom CSS theme files with CSS variables

  **Preview Features**
  - Add FileDownloadWidget, InputControl, OutputDisplay, and TabLayout components
  - Implement preview handlers, notifications, and 3D viewer utilities
  - Add throttle utility for improved slider responsiveness

  **Utilities**
  - Add application constants for file upload size limits
  - Add file download, param export, and debounce utilities
  - Export shared utility functions

### Patch Changes

- Updated dependencies
  - @selva/core@1.1.0
