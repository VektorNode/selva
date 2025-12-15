# Schema Evolution Guide

This guide provides step-by-step instructions for safely evolving the Selva schema system. The schema is the single source of truth shared between C# (backend) and TypeScript (frontend).

## Table of Contents

1. [Understanding the Schema System](#understanding-the-schema-system)
2. [Validation Architecture](#validation-architecture)
3. [Adding New Fields](#adding-new-fields)
4. [Renaming Fields](#renaming-fields)
5. [Removing Fields](#removing-fields)
6. [Changing Field Types](#changing-field-types)
7. [Adding Widget Types](#adding-widget-types)
8. [Schema Versioning](#schema-versioning)
9. [Testing Changes](#testing-changes)
10. [Common Pitfalls](#common-pitfalls)

---

## Understanding the Schema System

### Single Source of Truth

The schema system uses **JSON Schema** as the single source of truth:

- **Source**: `packages/schemas/ui-schema.json`
- **Generated C#**: `Plugin/Features/UIBuilder/Models/UISchema.Generated.cs`
- **Generated TypeScript**: `packages/frontend/src/lib/types/generated/schema.ts`

### Architecture

```
ui-schema.json (JSON Schema Definition)
    ↓
    ├─→ generate-csharp.js → UISchema.Generated.cs
    └─→ generate-typescript.js → schema.ts
```

**Key Features**:
- 100% automated C# generation with discriminated union detection
- Type-safe discriminated unions in both languages
- Automatic JSON converter generation for C#
- TypeScript type guards for runtime type checking

### Generation Command

After editing the schema, always run:

```bash
./generate-schemas.sh
```

This regenerates both C# and TypeScript types from the schema.

---

## Validation Architecture

**IMPORTANT**: Validation logic is centralized in the C# backend only.

### Where Validation Lives

- ✅ **C# Backend** (`Plugin/Features/UIBuilder/Services/Schema/SchemaValidator.cs`)
  - Comprehensive validation of all schema properties
  - Widget configuration validation (min/max, step size, dropdown options)
  - Layout integrity validation (references, duplicates, orphans)
  - Constraint validation (versions, timestamps, IDs)

- ✅ **TypeScript Frontend** (`packages/frontend/src/lib/api/schema-validator.ts`)
  - **Basic structural checks only** (schema not null, required fields exist)
  - Detailed validation deferred to backend

### When Adding New Fields

**If the field needs validation rules:**
1. Add validation logic to `SchemaValidator.cs` (C# only)
2. Add tests to `SchemaValidatorTests.cs`
3. **Do NOT add validation to TypeScript validator**

**Why?**
- Single source of truth for validation
- Avoids duplication and divergence
- Backend has final authority on schema validity
- Simpler maintenance

See [VALIDATION_ARCHITECTURE.md](./VALIDATION_ARCHITECTURE.md) for complete details.

---

## Adding New Fields

### Adding an Optional Field (Non-Breaking)

**When to use**: Adding functionality that doesn't require existing schemas to be updated.

**Example**: Add a `placeholder` field to `NumberWidgetConfig`

#### Step 1: Edit the Schema

Edit `packages/schemas/ui-schema.json`:

```json
{
  "NumberWidgetConfig": {
    "type": "object",
    "properties": {
      "min": { "type": "number" },
      "max": { "type": "number" },
      "stepSize": { "type": "number" },
      "placeholder": {
        "type": "string",
        "description": "Placeholder text shown when input is empty"
      }
    }
  }
}
```

#### Step 2: Regenerate Types

```bash
./generate-schemas.sh
```

Verify both generated files compile:

```bash
# TypeScript
pnpm type-check

# C#
cd Plugin && dotnet build
```

#### Step 3: Use the New Field

**TypeScript** (`packages/frontend/src/lib/components/inputs/InputNumberControl.svelte`):

```svelte
<script lang="ts">
  import type { NumberWidgetConfig } from '$lib/types/generated';

  export let config: NumberWidgetConfig;
  export let value: number;
</script>

<input
  type="number"
  placeholder={config.placeholder ?? 'Enter a number'}
  bind:value
/>
```

**C#** (if needed for defaults):

```csharp
// No migration needed - optional fields have null default
```

#### Step 4: Document the Change

Update `SCHEMA_CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- `NumberWidgetConfig.placeholder` (string, optional) - Placeholder text for number inputs
```

**Result**: ✅ No version bump needed, no migration required. Existing schemas work as-is.

---

### Adding a Required Field (Breaking Change)

**When to use**: When the field MUST be present for the system to work correctly.

**Example**: Add required `label` field to all layout items

#### Step 1: Edit the Schema

```json
{
  "InputNumberLayoutItem": {
    "type": "object",
    "required": ["id", "paramId", "type", "widgetType", "label"],
    "properties": {
      "label": {
        "type": "string",
        "description": "Display label for the input"
      }
    }
  }
}
```

#### Step 2: Create Migration

Edit `Plugin/Features/UIBuilder/Services/Schema/SchemaMigrator.cs`:

```csharp
private static UISchema MigrateTo_1_1_0(UISchema schema)
{
    // Add default labels to all layout items missing them
    foreach (var tab in schema.Layout.Tabs)
    {
        foreach (var group in tab.Groups)
        {
            foreach (var item in group.Items)
            {
                // Use displayName if available, otherwise paramId
                if (string.IsNullOrEmpty(item.Label))
                {
                    item.Label = item.DisplayName ?? item.ParamId;
                }
            }
        }
    }

    return schema;
}
```

#### Step 3: Register Migration

```csharp
private static readonly Dictionary<Version, Func<UISchema, UISchema>> _migrations = new()
{
    { new Version(1, 1, 0), MigrateTo_1_1_0 }
};
```

#### Step 4: Update Version

```csharp
public static readonly Version CURRENT_SCHEMA_VERSION = new(1, 1, 0);
```

#### Step 5: Add Tests

Create `Plugin.Tests/Features/UIBuilder/Services/SchemaMigratorTests.cs`:

```csharp
[Test]
public void Migration_1_0_to_1_1_AddsLabels()
{
    // Arrange
    var schema = new UISchema
    {
        SchemaVersion = "1.0.0",
        Layout = new LayoutConfig
        {
            Tabs = new List<TabConfig>
            {
                new TabConfig
                {
                    Groups = new List<GroupConfig>
                    {
                        new GroupConfig
                        {
                            Items = new List<LayoutItemBase>
                            {
                                new InputNumberLayoutItem
                                {
                                    Id = "item1",
                                    ParamId = "param1",
                                    DisplayName = "Temperature"
                                    // Label is missing (old schema)
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    // Act
    var migrated = SchemaMigrator.MigrateToCurrentVersion(schema);

    // Assert
    var item = migrated.Layout.Tabs[0].Groups[0].Items[0];
    Assert.That(item.Label, Is.EqualTo("Temperature"));
    Assert.That(migrated.SchemaVersion, Is.EqualTo("1.1.0"));
}
```

#### Step 6: Document

Update `SCHEMA_CHANGELOG.md`:

```markdown
## [1.1.0] - 2025-01-15

### Added
- `LayoutItem.label` (string, required) - Display label for layout items

### Migration Notes
- Existing schemas auto-migrated to use `displayName` or `paramId` as label
```

---

## Renaming Fields

**Strategy**: Use a two-phase approach to avoid breaking existing schemas.

**Example**: Rename `GroupConfig.columns` to `GroupConfig.columnCount`

### Phase 1: Add New Field (Version 1.1.0)

#### Step 1: Add New Field, Keep Old

```json
{
  "GroupConfig": {
    "type": "object",
    "properties": {
      "columns": {
        "type": "integer",
        "description": "DEPRECATED: Use columnCount instead"
      },
      "columnCount": {
        "type": "integer",
        "description": "Number of columns in the grid layout"
      }
    }
  }
}
```

#### Step 2: Add Migration to Copy Values

```csharp
private static UISchema MigrateTo_1_1_0(UISchema schema)
{
    foreach (var tab in schema.Layout.Tabs)
    {
        foreach (var group in tab.Groups)
        {
            // Copy old field to new field if present
            if (group.Columns.HasValue && !group.ColumnCount.HasValue)
            {
                group.ColumnCount = group.Columns;
            }
        }
    }

    return schema;
}
```

#### Step 3: Update Code to Use New Field

Update all frontend and backend code to use `columnCount` instead of `columns`.

#### Step 4: Document

```markdown
## [1.1.0] - 2025-01-15

### Added
- `GroupConfig.columnCount` - Replaces `columns` with clearer naming

### Deprecated
- `GroupConfig.columns` - Use `columnCount` instead. Will be removed in v2.0.0
```

### Phase 2: Remove Old Field (Version 2.0.0)

#### Step 1: Remove from Schema

```json
{
  "GroupConfig": {
    "type": "object",
    "properties": {
      "columnCount": {
        "type": "integer",
        "description": "Number of columns in the grid layout"
      }
      // "columns" removed
    }
  }
}
```

#### Step 2: Migration is Already Handled

The migration from 1.0.0 → 1.1.0 already handles the transition, so no new migration needed.

#### Step 3: Document

```markdown
## [2.0.0] - 2025-03-01

### Removed
- `GroupConfig.columns` - Use `columnCount` instead (deprecated since v1.1.0)

### BREAKING CHANGES
- Schemas older than v1.1.0 must migrate through v1.1.0 first
```

---

## Removing Fields

**Strategy**: Deprecate first, remove in next major version.

**Example**: Remove `UISchema.tags` field

### Phase 1: Deprecate (Version 1.1.0)

#### Step 1: Mark as Deprecated in Documentation

```markdown
## [1.1.0] - 2025-01-15

### Deprecated
- `UISchema.tags` - Tags moved to `UISchema.metadata.tags`. Will be removed in v2.0.0
```

#### Step 2: Add Migration to Preserve Data

```csharp
private static UISchema MigrateTo_1_1_0(UISchema schema)
{
    // Move tags to metadata for backward compatibility
    if (schema.Tags?.Any() == true)
    {
        schema.Metadata ??= new Dictionary<string, object>();
        if (!schema.Metadata.ContainsKey("tags"))
        {
            schema.Metadata["tags"] = schema.Tags;
        }
    }

    return schema;
}
```

#### Step 3: Update Code

Update all code to read from `metadata.tags` instead of `tags`.

### Phase 2: Remove Field (Version 2.0.0)

#### Step 1: Remove from Schema

```json
{
  "UISchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "name": { "type": "string" },
      // "tags" removed
      "metadata": {
        "type": "object",
        "additionalProperties": true
      }
    }
  }
}
```

#### Step 2: Document Breaking Change

```markdown
## [2.0.0] - 2025-03-01

### Removed
- `UISchema.tags` - Use `UISchema.metadata.tags` instead (deprecated since v1.1.0)

### BREAKING CHANGES
- Direct access to `tags` array no longer supported
- Data automatically migrated to `metadata.tags` during load
```

---

## Changing Field Types

**⚠️ WARNING**: Type changes are **always breaking changes**.

**Example**: Change `stepSize` from `number` to `string` (not recommended, but shown for illustration)

### Requirements

1. Increment **MAJOR** version (1.x.x → 2.0.0)
2. Create robust migration with error handling
3. Test extensively with edge cases
4. Document breaking change prominently

### Step 1: Update Schema

```json
{
  "NumberWidgetConfig": {
    "properties": {
      "stepSize": {
        "type": "string",
        "description": "Step size (supports expressions like '0.1' or '1/10')"
      }
    }
  }
}
```

### Step 2: Create Conversion Migration

```csharp
private static UISchema MigrateTo_2_0_0(UISchema schema)
{
    foreach (var input in schema.Inputs)
    {
        if (input.WidgetType == "number")
        {
            var config = input.Config as NumberWidgetConfig;
            if (config?.StepSize != null)
            {
                // Convert number to string
                // In real schema, old type was double, new is string
                // This would require custom JSON handling or temp fields

                // Example approach: read raw JSON and convert
                try
                {
                    // Conversion logic here
                }
                catch (Exception ex)
                {
                    Logger.Error($"Failed to migrate stepSize for {input.ParamId}: {ex.Message}");
                    // Set safe default
                    config.StepSize = "1.0";
                }
            }
        }
    }

    return schema;
}
```

### Step 3: Extensive Testing

```csharp
[TestCase(1.0, "1")]
[TestCase(0.1, "0.1")]
[TestCase(0.01, "0.01")]
[TestCase(null, null)]
public void Migration_2_0_ConvertsStepSizeToString(double? oldValue, string expectedNew)
{
    // Test all edge cases
}
```

### Step 4: Document Prominently

```markdown
## [2.0.0] - 2025-03-01

### BREAKING CHANGES

#### `NumberWidgetConfig.stepSize` Type Change
- **Old**: `number`
- **New**: `string`
- **Reason**: Support for expression-based step sizes
- **Migration**: Numeric values automatically converted to strings
- **Action Required**: Review custom code that accesses `stepSize` directly

### Changed
- `NumberWidgetConfig.stepSize` changed from `number` to `string` to support expressions
```

**Best Practice**: Avoid type changes if possible. Consider adding a new field instead.

---

## Adding Widget Types

**Example**: Add a new `date` widget type

### Step 1: Define Widget Config

Edit `packages/schemas/ui-schema.json`:

```json
{
  "definitions": {
    "DateWidgetConfig": {
      "type": "object",
      "properties": {
        "minDate": {
          "type": "string",
          "format": "date",
          "description": "Minimum selectable date (ISO 8601)"
        },
        "maxDate": {
          "type": "string",
          "format": "date",
          "description": "Maximum selectable date (ISO 8601)"
        },
        "format": {
          "type": "string",
          "description": "Date display format (e.g., 'YYYY-MM-DD')"
        }
      }
    }
  }
}
```

### Step 2: Add to Layout Item Union

```json
{
  "InputDateLayoutItem": {
    "type": "object",
    "required": ["id", "paramId", "type", "widgetType"],
    "properties": {
      "type": {
        "const": "input",
        "description": "Discriminator for input items"
      },
      "widgetType": {
        "const": "date",
        "description": "Discriminator for date widget"
      },
      "id": { "type": "string" },
      "paramId": { "type": "string" },
      "displayName": { "type": "string" },
      "description": { "type": "string" },
      "config": { "$ref": "#/definitions/DateWidgetConfig" },
      "order": { "type": "integer" },
      "span": { "type": "integer" }
    }
  }
}
```

### Step 3: Add to LayoutItem Union

```json
{
  "LayoutItem": {
    "oneOf": [
      { "$ref": "#/definitions/InputNumberLayoutItem" },
      { "$ref": "#/definitions/InputTextLayoutItem" },
      { "$ref": "#/definitions/InputDropdownLayoutItem" },
      { "$ref": "#/definitions/InputCheckboxLayoutItem" },
      { "$ref": "#/definitions/InputDateLayoutItem" },
      { "$ref": "#/definitions/OutputTextLayoutItem" },
      { "$ref": "#/definitions/OutputNumberLayoutItem" },
      { "$ref": "#/definitions/OutputFileLayoutItem" }
    ]
  }
}
```

### Step 4: Regenerate Types

```bash
./generate-schemas.sh
```

The C# generator will automatically:
- Create `InputDateLayoutItem` class
- Add it to `LayoutItemBase` hierarchy
- Update `LayoutItemBaseConverter` with date handling
- Generate proper discriminator logic

### Step 5: Create Svelte Component

Create `packages/frontend/src/lib/components/inputs/InputDateControl.svelte`:

```svelte
<script lang="ts">
  import type { DateWidgetConfig } from '$lib/types/generated';

  export let config: DateWidgetConfig;
  export let value: string;

  const format = config.format ?? 'YYYY-MM-DD';
</script>

<input
  type="date"
  bind:value
  min={config.minDate}
  max={config.maxDate}
/>
```

### Step 6: Add to Input Router

Edit `packages/frontend/src/lib/components/InputControl.svelte`:

```svelte
<script lang="ts">
  import type { InputLayoutItem } from '$lib/types/generated';
  import { isDateWidget } from '$lib/types/generated';
  import InputDateControl from './inputs/InputDateControl.svelte';

  export let item: InputLayoutItem;
  export let value: any;
</script>

{#if isDateWidget(item)}
  <InputDateControl config={item.config} bind:value />
{:else if /* other widgets */}
  <!-- ... -->
{/if}
```

### Step 7: Add to Builder UI

Edit `packages/frontend/src/routes/builder/+page.svelte`:

```svelte
const widgetPalette = [
  { type: 'number', label: 'Number', icon: Hash },
  { type: 'text', label: 'Text', icon: Type },
  { type: 'dropdown', label: 'Dropdown', icon: ChevronDown },
  { type: 'checkbox', label: 'Checkbox', icon: CheckSquare },
  { type: 'date', label: 'Date Picker', icon: Calendar }, // NEW
];
```

### Step 8: Document

```markdown
## [1.1.0] - 2025-01-15

### Added
- **New Widget Type: Date Picker**
  - `DateWidgetConfig` with `minDate`, `maxDate`, and `format` options
  - `InputDateLayoutItem` for layout configuration
  - Full support in builder and preview UIs
```

---

## Schema Versioning

### Semantic Versioning

Use semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR** (e.g., 1.x.x → 2.0.0): Breaking changes
  - Type changes
  - Required field additions
  - Field removals (after deprecation)

- **MINOR** (e.g., 1.0.x → 1.1.0): Backward-compatible additions
  - New optional fields
  - New widget types
  - New enums (additive only)

- **PATCH** (e.g., 1.0.0 → 1.0.1): Bug fixes
  - Documentation updates
  - No schema structure changes

### Version Fields

**UISchema** has three version fields:

```typescript
{
  schemaVersion: "1.0.0",      // Current schema format version
  pluginVersion: "1.2.3",      // Plugin that created this schema
  minPluginVersion: "1.0.0"    // Minimum plugin required to use this schema
}
```

### Updating Versions

When making schema changes, update `CURRENT_SCHEMA_VERSION`:

```csharp
// In SchemaMigrator.cs
public static readonly Version CURRENT_SCHEMA_VERSION = new(1, 1, 0);
```

---

## Testing Changes

### Testing Checklist

Before deploying schema changes:

- [ ] **Regenerate types**: Run `./generate-schemas.sh`
- [ ] **TypeScript compiles**: Run `pnpm type-check`
- [ ] **C# compiles**: Run `cd Plugin && dotnet build`
- [ ] **Unit tests pass**: Run migration tests
- [ ] **Integration test**: Load real .gh file with old schema
- [ ] **Migration works**: Verify auto-migration updates schema correctly
- [ ] **No data loss**: Check all fields preserved after migration
- [ ] **UI still works**: Test builder and preview with migrated schema
- [ ] **Changelog updated**: Document all changes in `SCHEMA_CHANGELOG.md`

### Testing Migrations

Create test files in `Plugin.Tests/Features/UIBuilder/Services/`:

```csharp
[TestFixture]
public class SchemaMigratorTests
{
    [Test]
    public void LegacySchema_WithoutVersion_MigratesToCurrent()
    {
        var legacy = CreateLegacySchema();
        legacy.SchemaVersion = null; // Old schema without version

        var migrated = SchemaMigrator.MigrateToCurrentVersion(legacy);

        Assert.That(migrated.SchemaVersion, Is.EqualTo("1.0.0"));
    }

    [Test]
    public void Migration_PreservesAllData()
    {
        var original = CreateSchema_1_0();
        var migrated = SchemaMigrator.MigrateToCurrentVersion(original);

        // Verify critical data preserved
        Assert.That(migrated.Id, Is.EqualTo(original.Id));
        Assert.That(migrated.Inputs.Count, Is.EqualTo(original.Inputs.Count));
        Assert.That(migrated.Layout.Tabs.Count, Is.EqualTo(original.Layout.Tabs.Count));
    }

    [Test]
    public void IncompatibleMinVersion_ThrowsException()
    {
        var schema = CreateSchema_1_0();
        schema.MinPluginVersion = "99.0.0"; // Requires future version

        Assert.Throws<IncompatibleSchemaException>(() =>
            SchemaMigrator.MigrateToCurrentVersion(schema)
        );
    }
}
```

### Manual Testing

1. **Create test .gh file** with old schema version
2. **Open in Grasshopper** with updated plugin
3. **Verify migration message** appears in component
4. **Save and reload** to ensure schema persists correctly
5. **Check all UI elements** render correctly
6. **Test parameter updates** still work via WebSocket

---

## Common Pitfalls

### ❌ DON'T: Edit Generated Files

```typescript
// ❌ WRONG: Editing schema.ts directly
// packages/frontend/src/lib/types/generated/schema.ts
export interface UISchema {
  name: string;
  customField: string; // WILL BE OVERWRITTEN ON NEXT GENERATION
}
```

```json
// ✅ CORRECT: Edit ui-schema.json instead
{
  "UISchema": {
    "properties": {
      "customField": { "type": "string" }
    }
  }
}
```

---

### ❌ DON'T: Skip the Changelog

Future developers (including you!) need to understand what changed and when.

```markdown
✅ CORRECT:
## [1.1.0] - 2025-01-15

### Added
- `NumberWidgetConfig.placeholder` - Placeholder text for inputs

### Migration Notes
- No migration needed - optional field with null default
```

---

### ❌ DON'T: Change Types Without Migration

```csharp
// ❌ WRONG: Changing type without migration
// Old: public double? StepSize { get; set; }
// New: public string StepSize { get; set; }
// Result: Deserialization fails, data loss

// ✅ CORRECT: Add migration
private static UISchema MigrateTo_2_0_0(UISchema schema)
{
    // Handle conversion with error checking
}
```

---

### ❌ DON'T: Remove Fields Without Deprecation

```markdown
❌ WRONG:
v1.0.0: Has `tags` field
v1.1.0: Removes `tags` field immediately
Result: Breaking change in minor version

✅ CORRECT:
v1.0.0: Has `tags` field
v1.1.0: Deprecate `tags`, add migration to `metadata.tags`
v2.0.0: Remove `tags` field
Result: Proper deprecation cycle
```

---

### ❌ DON'T: Forget to Test Migrations

```csharp
// ❌ WRONG: No tests
private static UISchema MigrateTo_1_1_0(UISchema schema)
{
    // Migration code
    return schema;
}

// ✅ CORRECT: Comprehensive tests
[Test]
public void Migration_1_0_to_1_1_HandlesAllCases()
{
    // Test happy path
    // Test edge cases
    // Test null values
    // Test empty collections
    // Test data preservation
}
```

---

### ✅ DO: Use Optional Fields When Possible

```json
{
  "NumberWidgetConfig": {
    "properties": {
      "placeholder": {
        "type": "string"
        // No "required": ["placeholder"]
      }
    }
  }
}
```

Benefits:
- No migration needed
- Backward compatible
- Easy to add
- No breaking changes

---

### ✅ DO: Write Defensive Migrations

```csharp
private static UISchema MigrateTo_1_1_0(UISchema schema)
{
    // Check for null
    if (schema?.Layout?.Tabs == null)
    {
        return schema;
    }

    foreach (var tab in schema.Layout.Tabs)
    {
        // Check for null at each level
        if (tab?.Groups == null) continue;

        foreach (var group in tab.Groups)
        {
            if (group?.Items == null) continue;

            // Safe migration logic
            foreach (var item in group.Items)
            {
                try
                {
                    // Migration with error handling
                }
                catch (Exception ex)
                {
                    Logger.Warning($"Migration issue for item {item.Id}: {ex.Message}");
                }
            }
        }
    }

    return schema;
}
```

---

### ✅ DO: Test with Real .gh Files

```bash
# 1. Create .gh file with old plugin version
# 2. Update to new plugin version
# 3. Open .gh file in Grasshopper
# 4. Verify migration runs
# 5. Save and reload
# 6. Confirm no data loss
```

---

### ✅ DO: Document Breaking Changes Prominently

```markdown
## [2.0.0] - 2025-03-01

### ⚠️ BREAKING CHANGES ⚠️

This release contains breaking changes. Please read carefully.

#### Removed Fields
- `UISchema.tags` → Use `UISchema.metadata.tags`
- `GroupConfig.columns` → Use `GroupConfig.columnCount`

#### Type Changes
- `NumberWidgetConfig.stepSize`: `number` → `string`

#### Migration
- Schemas automatically migrate on load
- Backup your .gh files before updating
- Test in a safe environment first

#### Minimum Plugin Version
- This schema requires plugin version 2.0.0 or higher
```

---

## Quick Reference

### Files to Edit for Schema Changes

| Change Type | Files to Edit |
|-------------|---------------|
| **All changes** | `packages/schemas/ui-schema.json`<br>Run `./generate-schemas.sh` |
| **Breaking changes** | `Plugin/Features/UIBuilder/Services/Schema/SchemaMigrator.cs`<br>`Plugin.Tests/Features/UIBuilder/Services/SchemaMigratorTests.cs` |
| **New widget** | Add Svelte component in `packages/frontend/src/lib/components/inputs/`<br>Update `InputControl.svelte`<br>Update builder palette |
| **All changes** | `packages/schemas/SCHEMA_CHANGELOG.md` |

### Decision Tree: What Kind of Change?

```
Is it a new optional field?
└─ YES → Add to schema, regenerate, done! (MINOR version)
└─ NO ↓

Is it a new required field?
└─ YES → Add migration, increment MINOR, test
└─ NO ↓

Is it removing a field?
└─ YES → Deprecate first (MINOR), remove later (MAJOR)
└─ NO ↓

Is it changing a type?
└─ YES → Create migration, increment MAJOR, test extensively
└─ NO ↓

Is it a new widget type?
└─ YES → Add to schema, create component, increment MINOR
```

---

## Getting Help

If you're unsure about a schema change:

1. **Check this guide** for similar examples
2. **Review `SCHEMA_CHANGELOG.md`** for past changes
3. **Look at generated code** to understand current structure
4. **Test in isolation** before deploying
5. **Ask for review** if making breaking changes

---

**Remember**: The schema is shared infrastructure. Changes affect both C# and TypeScript code, all existing .gh files, and all users. Take time to get it right!
