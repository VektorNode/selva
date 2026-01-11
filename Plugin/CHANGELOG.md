# Changelog

All notable changes to the Selva Grasshopper Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Fixed double .3dm.3dm for exporting block files

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

[Unreleased]: https://github.com/vektornode/selva/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/vektornode/selva/compare/v1.0.0...v0.2.0
[1.0.0]: https://github.com/vektornode/selva/releases/tag/v1.0.0
