# Preview Page Refactoring

This directory contains extracted utility modules from the original `+page.svelte` file to improve maintainability and code organization.

## Module Organization

### `viewer.ts` - 3D Viewer Management

Handles all Three.js viewer initialization and mesh processing:

- `initializeViewerScene()` - Set up Three.js scene, camera, and controls
- `updateViewerScene()` - Update viewer with new mesh data
- `processMeshBatches()` - Parse and scale mesh batch data
- `applyMeshTransforms()` - Apply ground offset transformations
- `ensureRhinoComputeLoaded()` - Lazy-load rhino-compute module

### `handlers.ts` - Data Processing

Contains pure functions for processing WebSocket messages:

- `initializeValues()` - Initialize parameter values from schema and defaults
- `processOutputUpdate()` - Filter and merge output updates
- `updateParameterMetadata()` - Update parameter metadata (nickname, description, constraints)
- `removeParametersFromValues()` - Clean up values when parameters are removed

### `notifications.ts` - UI Notifications

Message formatting and notification management:

- `formatParameterUpdateMessage()` - Format schema update notifications
- `formatMetadataUpdateMessage()` - Format metadata change notifications

## Benefits of This Refactoring

1. **Separation of Concerns**: Each module has a single responsibility
2. **Reusability**: Functions can be tested and reused independently
3. **Maintainability**: Logic is organized logically rather than scattered in handlers
4. **Testability**: Pure functions are easier to unit test
5. **Reduced Complexity**: Main component file is ~200 lines shorter

## Migration Notes

- All exported functions are pure (no side effects) except viewer initialization
- Type safety is maintained through TypeScript interfaces
- Lazy loading of `rhino-compute` is preserved
- WebSocket integration logic remains in the main component
- Event handlers still live in `onMount` for lifecycle management
