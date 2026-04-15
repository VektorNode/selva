# Changelog

All notable changes to the Selva Grasshopper Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-04-14

### Added

**WebDisplay: Layer Input**

- New `Layer` input parameter (`L`) on `WebDisplay` for grouping meshes in the scene manager (e.g. `"Structure/Walls"`)
- `MeshMetadata` now carries `layer` and `originalIndex` fields for traceability back to the GH input tree
- `MeshBatch` now carries `sourceComponentId` (the component `InstanceGuid`) so the viewer can identify which GH component produced each batch
- `MeshBatchProcessor.CreateBatch` accepts the new optional `layers` and `sourceComponentId` parameters

**Upgrader**

- `GH_WebDisplayUpgrader_To_0_9`: migrates old `WebDisplay` component (GUID `9B5515B2`) to new one (GUID `4F7A9C2E`), remapping all existing inputs to their new indices and leaving the new `Layer` input empty

**Obsolete Component**

- `OBSOLETE_WebDisplay_UntilV0_8_3.cs` added for backward compatibility with definitions saved before v0.9.0

### Changed

- `WebDisplay` component GUID updated (`9B5515B2` → `4F7A9C2E`) to reflect the breaking input layout change
- `Name` input label shortened from `"Mesh Name"` to `"Name"` for consistency
- Metadata merging improved: when a branch has more metadata strings than geometry items, all metadata entries are merged into a single dictionary for that mesh (useful for one-mesh, many-metadata patterns)
- Minor code style cleanup (single-line catch blocks, removed blank lines in `ParseMetadataString`)

## [0.7.1] - 2026-03-12

### Fix

- `RhinoDocumentConverter`: added `GC.SuppressFinalize(this)` to `Dispose()`, fixed secure wipe to regenerate random bytes per chunk (was reusing a single buffer), removed redundant variable declaration in `DocToBase64`
- `FileImporter`: replaced hardcoded `MAX_FILE_SIZE_BYTES` constant with `AppConfig.ValueLimits.MaxFileSizeBytes` to stay in sync with global config, wrapped `FileReadOptions` in `using` in `ImportObj`, guarded `doc.Layers[layerIndex]` with bounds check to prevent `IndexOutOfRangeException` on objects with invalid layer indices, disposed duplicated geometry on transform failure to prevent resource leak

Changed data input of [GH_DataToFileGeneric](Selva.GH/Features/FileIO/Components/GH_DataToFileGeneric.cs) from item to list to allow input strings like csv

## [0.7.0] - 2026-03-08

### Added

**Color Input Component**

- New `GH_GetColor` contextual parameter (`Params > Util`) that accepts a color from the web UI
- Colors are transferred as hex strings (e.g. `#FF5733`) and converted to `GH_Colour`; supports `GH_Colour`, `GH_String`, and raw string inputs
- Full `IGH_ContextualParameter` implementation with `AssignContextualData` and `AssignContextualDataTree` (for Rhino.Compute via reflection)
- Read/Write serialization for Grasshopper file persistence

**Schema System (v2.3.0)**

- Schema version bumped to `2.3.0`
- `GrasshopperParamType` extended with `"color"` variant for `Param_Colour` parameters
- `SchemaInput.inputStructure` field added (`"item"` | `"list"` | `"tree"`) to declare Grasshopper data access mode — stored for future use by the value applicator and compute pipeline; defaults to `"item"` (backward-compatible)
- Migration function `MigrateTo_2_3_0` registered in `SchemaMigrator`; no data transformation required — the C# model default handles it transparently

**Testing**

- Added `SchemaFixtureTests` — fixture-driven round-trip tests that load every `TestFiles/schemas/v*.json` file, migrate it, and assert no validation errors
- Expanded `SchemaValidatorTests` with full coverage of all validation rules: `BasicStructureRule`, `ParameterValidationRule`, `LayoutValidationRule`, `WidgetConfigRule`, `VersioningRule`, and `ConstraintsRule`
- Refactored `SchemaMigratorTests` with clearer test names and added `MigrateJson` inference tests (flat vs. tabbed layout type detection)
- Added sample schema fixture files under `Plugin/Selva.Tests/TestFiles/schemas/`

### Changed

**Code Quality & Refactoring**

- Extracted `ContextualiseIcon` helper into a shared `Utils` class (`ComputeIO/Components/Utils.cs`) — previously duplicated in `GH_Contextual_Value_List` and referenced in the new `GH_GetColor`; both `GetValueListParameter` and `GetFileParameter` now call `Utils.ContextualiseIcon`
- `BridgeCommunicationService`: added `GetSchemaFromContextBake` private method; standardized indentation across the file
- `SchemaManager`, `ValueCollector`, `BridgeCommunicationService`: reformatted from tab to space indentation for consistency with `.editorconfig`
- `FileDataGoo`: reformatted indentation (tabs → spaces), no logic changes
- `SchemaMigrator`: fixed migration dictionary to register `MigrateTo_2_0_0` under version `2.0.0` (not `CURRENT`) and added `MigrateTo_2_3_0` under the new current version
- `DocumentSynchronizationService`, `ValueApplicator`: minor cleanup

### Fixed

- `SchemaMigrator` migration dictionary previously registered the `2.0.0` migration under the `CURRENT` key — migrations after `2.0.0` would never be applied; now each migration is keyed to its own target version
- `GetFileParameter`: removed stale `_isFromContextual = false` resets in `AssignContextualData` / `AssignContextualDataTree` that were immediately overwritten; removed generic volatile data fallback for non-`Param_FilePath`/`Param_String` sources to prevent unintended data capture

## [0.3.0] - 2026-01-13

### Added

**Web Viewer Enhancements**

- Mesh selection system with click event detection via raycasting
- Optional mesh metadata callback (`onMeshMetadataClicked`) to retrieve custom metadata from clicked meshes
- Configurable selection highlight color (`selectionColor`) - defaults to red, supports any CSS color or THREE.Color
- Material cloning on selection to highlight only selected mesh without affecting other meshes sharing the same material
- Event handler control flags:
  - `enableEventHandlers` - Master switch for all event listeners (defaults to true)
  - `enableClickToFocus` - Individual control for click-to-focus behavior
  - `enableKeyboardControls` - Individual control for keyboard shortcuts (F, Space, ESC)

**Type Safety & API Improvements**

- Proper TypeScript types for viewer configuration (`EventConfig`, `ThreeInitializerOptions`)
- Type-safe model unit handling with `ModelUnit` type derived from valid scale factors
- Improved `ViewerState` interface with proper Three.js types (THREE.Scene, THREE.PerspectiveCamera, OrbitControls)
- `ProcessMeshBatchesOptions` interface for explicit mesh batch processing options

**Documentation & Code Quality**

- Enhanced JSDoc comments for all viewer-related functions
- Cleaner API surface with re-exports from core visualization module

### Changed

**Breaking: Simplified Web Viewer API**

- Removed wrapper functions from `@selva/shared` for cleaner abstraction:
  - `initializeViewerScene()` → use `initThree()` directly
  - `updateViewerScene()` → use `updateScene()` directly
  - `processMeshBatches()` → use `parseMeshBatchObject()` in a loop

## Fixed

- No double 3dm.3dm ending for file export with block export

### Migration Guide

**Before (0.2.0):**

```typescript
import { initializeViewerScene, updateViewerScene, processMeshBatches } from '@selva/shared';

const state = await initializeViewerScene(canvas, schema);
await updateViewerScene(state, meshes);
const allMeshes = await processMeshBatches(batches, { modelUnits: 'Meters' });
```

**After (0.3.0):**

```typescript
import {
	initThree,
	updateScene,
	parseMeshBatchObject,
	SCALE_FACTORS
} from '@selva/compute/visualization';

const { scene, camera, controls } = initThree(canvas, {
	environment: { backgroundColor: '#ffffff' },
	events: {
		onMeshMetadataClicked: (metadata) => console.log(metadata),
		selectionColor: '#ff0000',
		enableEventHandlers: true
	}
});

updateScene(scene, meshes, camera, controls, false);

// For mesh batches
const scaleFactor = SCALE_FACTORS['Meters'] ?? 1;
for (const batch of batches) {
	const meshes = await parseMeshBatchObject(batch, { scaleFactor });
}
```

## [0.2.0] - 2025-12-31

### Added

**New Components**

- `GH_Environment` component for compute environment detection (Selva.Grasshopper/Features/ComputeIO/Components/GH_Environement.cs:1)
- `GH_EvaluateSchema` component with basic structure for schema evaluation (Selva.Grasshopper/Features/UIBuilder/Components/GH_EvaluateSchema.cs:1)
- `GH_ValueListDataGoo` class for handling ValueList data structures

**Core Library Documentation**

- Comprehensive README.md for Selva.Core library with architecture overview
- Detailed documentation for schema validation and migration system

**Testing & Quality**

- Unit tests for SchemaMigrator with comprehensive validation scenarios
- Unit tests for SchemaValidator
- JsonSchemaTests with valid schema fixtures
- Test infrastructure improvements

### Changed

**Schema System Refactoring**

- Refactor schema versioning and migration logic for better maintainability (Plugin/Features/UIBuilder/Services/Schema/SchemaMigrator.cs:1)
- Implement modular validation system for UISchema (Plugin/Features/UIBuilder/Services/Schema/SchemaValidator.cs:1)
- Enhance SchemaManager and SchemaCleanupService
- Improve schema persistence service (Plugin/Features/UIBuilder/Services/SchemaPersistenceService.cs:1)
- Update generated UISchema models (Plugin/Features/UIBuilder/Models/UISchema.Generated.cs:1)

**UIBuilder Service Architecture**

- Enhance UIBuilderService with new services and session management
- Refactor GH_UIBuilderComponent to utilize UIBuilderService for improved service management
- Improve dependency injection and service lifecycle management
- Add centralized logging mechanism

**Communication & WebSocket**

- Enhance WebSocket handling with better error recovery
- Improve CommunicationHandler and WebSocketServer reliability
- Streamline LocalWebServer implementation
- Improve DocumentEventManager for better event handling

**File Handling**

- Remove GH_Base64Parser component (functionality integrated elsewhere)
- Enhance GH_DataToFile and GH_BlockToFile components
- Improve RhinoDocumentConverter with better error handling
- Add FileDataGoo for type-safe file data handling

**Display System**

- Refactor ThreeMaterial and related services
- Improve MaterialCache for better performance
- Enhance MeshBatchProcessor with optimized batching
- Update GeoMeshProcessor with improved geometry handling
- Optimize CompressionHelper for web delivery

**Code Quality**

- Standardize code formatting across all C# files
- Simplify exception handling by removing unused exception variables
- Improve readability and maintainability throughout codebase
- Clean up formatting in Logger class and test files

**Configuration & Build**

- Streamline production build steps
- Update AppConfig with new settings
- Improve .gitignore patterns

### Fixed

- Icon loading issues resolved (removed IconPluginF4R resources)
- Exception handling simplified and made more consistent
- URL construction for embedded web server
- Schema serialization edge cases

### Removed

- GH_Base64Parser component (replaced by ValueListData handling)
- Outdated validation architecture document
- Unused icon resources (IconPluginF4R.svg, IconPluginF4R.png)

## [1.0.0] - 2025-01-15

### Added

- Initial release of Selva plugin
- UIBuilder component for schema linking and WebSocket communication
- Display components for 3D web visualization
- FileIO components for geometry export
- ComputeIO components for interactive selections
- Multi-target support (net48 for Rhino 7, net7.0 for Rhino 8)
- Embedded web assets server
- WebSocket server for builder-app integration

[Unreleased]: https://github.com/vektornode/selva/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/vektornode/selva/compare/v0.3.0...v0.7.0
[0.3.0]: https://github.com/vektornode/selva/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vektornode/selva/compare/v1.0.0...v0.2.0
[1.0.0]: https://github.com/vektornode/selva/releases/tag/v1.0.0
