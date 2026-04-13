# @selva/shared

## 0.8.3

### Minor Changes

- Updated dev dependecies since they dont properly get resolved in external projects

## 1.4.0

### Minor Changes

- b9d05f8: Add `category` field to `UISchema` for organizing schemas (e.g., 'architecture', 'structural'). Bump schema version default to `2.1.0`. The C# generator now also auto-updates `SchemaVersion.cs` from the schema's `schemaVersion` default, so bumping the version in `ui-schema.json` is the only change needed going forward.
- Added the possiblity to use links or upload files

## 1.3.0

### Minor Changes

- 71fe8f7: Add ComputeMessages component with floating indicator for Grasshopper solve errors and warnings
  - New `ComputeMessages` component with floating button indicator always visible in bottom-right
  - Click to open modal dialog showing full error/warning dashboard
  - Groups duplicate messages to reduce noise (e.g., "×247" for repeated warnings)
  - Collapsible sections within dialog for errors (expanded by default) and warnings (collapsed)
  - Errors displayed in red with destructive styling, warnings in yellow
  - Badge shows count breakdown (e.g., "3 Errors • 247 Warnings")
  - Integrated into compute-app solve flow to extract and display errors/warnings from Rhino Compute responses
  - Uses shadcn-svelte Dialog, Collapsible, Button, and Badge components
  - Updated to use new Lucide icon names (CircleAlert, TriangleAlert)

- bc602c2: Add group-level visibility conditions for conditional group show/hide

  **New Capabilities:**
  - **GroupVisibilityCondition** schema type: apply visibility rules to entire groups
    - Supports same rule evaluation as item conditions (AND/OR logic, all operators)
    - Actions: `show` (default), `hide`
    - No `defaultValue` support (defaults are applied at item level)
    - Individual item rules remain independent from group visibility
  - **Builder UI**: Group visibility editor in EditableGroup component
    - Expandable visibility rules section in group header
    - Same intuitive rule builder as item conditions
    - Shows rule count when rules exist
  - **Preview**: Runtime group visibility evaluation in TabLayout
    - Groups are completely hidden when visibility condition hides them
    - Item-level visibility and defaults still execute independently
    - Maintains consistency with item-level visibility evaluation

  **Example Usage:**

  ```json
  {
  	"visibilityCondition": {
  		"mode": "all",
  		"action": "hide",
  		"rules": [
  			{
  				"paramId": "mode-id",
  				"operator": "equals",
  				"value": "basic"
  			}
  		]
  	}
  }
  ```

  **Benefits:**
  - Organize UI into collapsible sections with conditional visibility
  - Hide entire "Advanced Options" groups based on user mode selection
  - Cleaner schemas without repeated visibility rules for multiple items
  - Individual items can still have their own conditions and default values

- bc602c2: Add `action` and `defaultValue` to VisibilityCondition for enhanced parameter state management

  **New Capabilities:**
  - **action** enum: control parameter visibility state (`show`, `hide`, `disable`)
    - `show` (default): parameter is visible and enabled
    - `hide`: parameter is removed from view
    - `disable`: parameter is visible but greyed out and non-interactive
  - **defaultValue**: set parameter values when condition is met, eliminating repetition in conditional logic

  **Example Usage:**

  ```json
  {
  	"visibilityCondition": {
  		"mode": "all",
  		"action": "disable",
  		"defaultValue": 2,
  		"rules": [
  			{
  				"paramId": "leg-type-id",
  				"operator": "equals",
  				"value": "square"
  			}
  		]
  	}
  }
  ```

  **Benefits:**
  - Zero repetition: single condition object handles visibility + default values
  - DRY principle: no need to duplicate rules for multiple actions
  - Backwards compatible: new fields are optional, existing schemas continue to work
  - Extensible: action enum can support additional states in the future

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
  import {
  	initThree,
  	updateScene,
  	parseMeshBatchObject,
  	SCALE_FACTORS
  } from 'selva-compute/visualization';

  const { scene, camera, controls } = initThree(canvas, options);
  updateScene(scene, meshes, camera, controls, initialized);
  const meshes = await parseMeshBatchObject(batch, options);
  ```

  The core functions are still re-exported from `@selva/shared` for convenience, but calling them directly from `selva-compute/visualization` is recommended.

### Patch Changes

- Updated dependencies [cd6ad4b]
  - selva-compute@1.2.0

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
  - selva-compute@1.1.0
