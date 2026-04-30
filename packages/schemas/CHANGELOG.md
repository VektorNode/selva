# Schema Changelog

All notable changes to the Selva UI schema will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Schema Versioning

- **MAJOR** version (e.g., 1.x.x → 2.0.0): Breaking changes that require migration
- **MINOR** version (e.g., 1.0.x → 1.1.0): Backward-compatible additions
- **PATCH** version (e.g., 1.0.0 → 1.0.1): Bug fixes and documentation

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
