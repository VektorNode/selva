# Changelog

All notable changes to the Selva Grasshopper Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Prepare UI Inputs**

- New `Selva > UI` component, `Prepare UI Inputs` (`Plugin/Selva.GH/Features/UIBuilder/Components/GH_PrepareUIInputs.cs`). Registers existing Number Sliders, Value Lists, Boolean Toggles, and Panels by instance GUID, previews the contextual parameter (`Get Number`, `Get Integer`, `Get Value List`, `Get Boolean`, `Get String`) each one infers from its live data, and inserts it between the control and the inputs it drives - or beside a disconnected control - as one undoable, previewed operation. Existing compatible `Get` parameters are recognized and can be adopted, renamed, or repaired. Removal reverses the insertion and never deletes a node the component did not create or explicitly adopt.
- Ported from a WASPer plugin prototype (`Components/1.2_Studies/Sm06`) per `00_Plans/SELVA_PREPARE_UI_INPUTS_PLAN.md`; the classification and inference math live in `Services/PrepareUIInputInference.cs`, split out with no Grasshopper dependency so it is covered by unit tests in `Plugin/Selva.Tests`.

### Changed

**WebDisplay: tree-structured output**

- The `Web Display` output is now a tree that mirrors the geometry input tree: each input branch produces its own `Web Display` on the matching path, instead of every branch flattening into one merged item. Downstream tree operations (graft, merge, path-mapper) now behave the Grasshopper-native way. The previous flatten-everything component is preserved (hidden) with an auto-upgrader, so existing definitions migrate transparently.

### Performance

**Geometry To File: task-capable, parallel .3dm export**

- `Geometry To File` is now a task-capable component: the export runs on a background task instead of blocking the Grasshopper UI thread, and each output file in a tree is written in parallel.
- `.3dm` output no longer builds a headless `RhinoDoc` and round-trips through a temp file. It is written with an in-memory `File3dm` and `ToByteArray()`, which skips the document-table bookkeeping (undo records, events, display invalidation) and the disk write/read/delete per file. Exporting many parts is substantially faster; the written file is unchanged (still Rhino version 7).
- Other file endings still go through `RhinoDoc.Export`, whose format plugins are not thread-safe, so that path stays serial and on the main thread — same behaviour as before.

- WebDisplay now extracts each mesh's vertex/face arrays inside the parallel meshing pass instead of in the serial batch-assembly step. Previously the per-vertex copy ran single-threaded for every mesh after meshing; it now scales with the meshing parallelism. `MeshBatchProcessor.CreateBatch` gains an array-taking overload for this (the mesh-taking overload is unchanged for other callers).

## [0.14.0-beta.2] - 2026-06-29

### Added

**WebDisplay: transform & geometry casting**

- The `Web Display` param now responds to spatial transforms. Move, Rotate, Scale, Orient, Mirror (and any `Transform` component) and `SpaceMorph` deformers relocate the displayed geometry: `DisplayBatchTransformer` decodes the batch, moves the mesh vertices and curve/point items, and re-encodes a fresh batch. Viewport preview and the web payload both follow.
- A `Web Display` can now be cast straight into a `Mesh`, `Curve`, or `Point` param: the mesh cast joins every mesh in the batch into one; the curve/point cast returns the first item of that kind. Existing `DisplayBatch` / JSON-string casts are unchanged and take lower priority.

### Fixed

- A selected downstream `Web Display` param now highlights green (GH selection shade material / wire colour) like every other geometry param, instead of always drawing its baked batch colours.

## [0.11.2] - 2026-06-09

### Added

**File output: Metadata input**

- New optional `Metadata` input (`M`, list of `"key=value"` lines) on `Create File`, `File From Path`, `Block to File`, and `Geometry To File`, parsed via `FileMetadataParser` and attached to `FileData.Metadata` for downstream tagging/indexing.

**Upgraders**

- `GH_DataToFileGenericUpgrader_To_0_11_1`, `GH_FileFromPathUpgrader_To_0_11_1`, `GH_BlockToFileUpgrader_To_0_11_1`, `GH_GeometryToFileUpgrader_To_0_11_1`: migrate the old (pre-metadata) file-output components to their new component GUIDs, remapping every existing input 1:1 and leaving the new `Metadata` input empty.

**Obsolete components**

- `OBSOLETE_DataToFileGeneric_UntilV0_11_0`, `OBSOLETE_FileFromPath_UntilV0_11_0`, `OBSOLETE_BlockToFile_UntilV0_11_0`, `OBSOLETE_GeometryToFile_UntilV0_11_0`: hidden snapshots of the pre-metadata shapes (keeping their original GUIDs) so definitions saved before v0.11.2 load and auto-upgrade cleanly.

### Fixed

- The `Metadata` input had been added to the four file-output components in beta without versioning (same component GUID, extra param), which would have silently corrupted parameter alignment in saved definitions. Each component now carries a new GUID with a matching obsolete snapshot + upgrader.

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

- Simplified web viewer API in the TypeScript helpers (now `@selvajs/compute`): wrapper functions replaced with direct calls to `initThree`, `updateScene`, and `parseMeshBatchObject`

### Fixed

- No double `.3dm` ending on file export with block export

## [0.2.0] - 2025-12-31

### Added

**New Components**

- `GH_Environment` component for compute environment detection
- `GH_EvaluateSchema` component with basic structure for schema evaluation
- `GH_ValueListDataGoo` class for handling ValueList data structures

**Core Library Documentation**

- Comprehensive README.md for Selva.Schema library with architecture overview
- Detailed documentation for schema validation and migration system

**Testing & Quality**

- Unit tests for SchemaMigrator with comprehensive validation scenarios
- Unit tests for SchemaValidator
- JsonSchemaTests with valid schema fixtures
- Test infrastructure improvements

### Changed

**Schema System Refactoring**

- Refactor schema versioning and migration logic for better maintainability
- Implement modular validation system for UISchema
- Enhance SchemaManager and SchemaCleanupService
- Improve schema persistence service
- Update generated UISchema models

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

[Unreleased]: https://github.com/vektornode/selva/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/vektornode/selva/compare/v0.7.1...v0.9.0
[0.7.1]: https://github.com/vektornode/selva/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/vektornode/selva/compare/v0.3.0...v0.7.0
[0.3.0]: https://github.com/vektornode/selva/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vektornode/selva/releases/tag/v0.2.0
