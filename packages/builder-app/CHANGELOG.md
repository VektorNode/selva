# @selva/builder-app

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
