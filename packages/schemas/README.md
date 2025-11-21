# Schema Generation Guide

This directory contains the **single source of truth** (JSON Schema) for all shared types between C# and TypeScript.

**All type generation is now fully automated** - the generators dynamically read from `ui-schema.json` and produce complete, type-safe code for both languages.

## Quick Start

```bash
# After making changes to ui-schema.json
cd schemas
npm run generate:all

# Or from project root
./generate-schemas.sh
```

## Adding a New Type

### 1. Define in JSON Schema

Edit `ui-schema.json` and add your type to the `definitions` section:

```json
{
  "definitions": {
    "MyNewType": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "count": { "type": "integer" },
        "enabled": { "type": "boolean" }
      },
      "required": ["id", "name"]
    }
  }
}
```

### 2. Regenerate Types

```bash
npm run generate:all
```

### 3. Import in Your Code

**TypeScript:**
```typescript
import type { MyNewType } from '$lib/types/generated';
```

**C#:**
```csharp
using ComputeBuilder.Plugin.Models.Generated;
// MyNewType is now available
```

## Modifying Existing Types

### Adding a Property

```json
{
  "InputParamSchema": {
    "properties": {
      "existingProp": { "type": "string" },
      "newProperty": {
        "type": "number",
        "description": "My new property"
      }
    }
  }
}
```

### Making a Property Required

Add the property name to the `required` array:

```json
{
  "required": ["id", "name", "newProperty"]
}
```

### Adding Optional Properties

Don't include in `required` array - they become nullable in C# and optional in TypeScript.

## Key Features

### Fully Automated Generation

The C# generator is **100% schema-driven**, meaning:
- ✅ All classes are generated dynamically from the JSON Schema definitions
- ✅ Discriminated unions are **auto-detected** by finding `oneOf` patterns
- ✅ Base classes are **auto-generated** from common properties across variants
- ✅ Discriminators are **auto-detected** by finding `const` properties
- ✅ Type mappings happen automatically (Guid, DateTime, etc.)
- ✅ JSON converters are **fully generated** from discriminator metadata
- ✅ Sections are **dynamically organized** by naming patterns
- ✅ **No hardcoded types** - everything comes from the schema

**What this means:** To add a new type, widget, discriminated union, or even a completely new union pattern - just edit the schema and regenerate. **Zero manual C# code required!**

### Intelligent Auto-Detection

The generator automatically detects and generates:

**Discriminated Unions:**
- Finds any `oneOf` pattern in the schema
- Identifies all variant types from `$ref` references
- Detects discriminator fields (properties with `const` values)
- Finds common properties across all variants (for base class)
- Generates abstract base class with converter attribute
- Generates variant classes that inherit from base
- Generates JSON converter with proper if-else chain

**Type Mappings:**
- Descriptions containing "GUID" → `Guid` type in C#
- Special refs like `GrasshopperParamType` → `string` (for compatibility)
- Union refs like `LayoutItem` → `LayoutItemBase` (for inheritance)
- Optional vs required → nullable types
- Date-time strings → `DateTime`

**Organization:**
- Classifies types by naming patterns (Config, Schema, Runtime, etc.)
- Groups related classes into logical sections
- Separates regular classes from union variants

## Type Mappings

| JSON Schema | TypeScript | C# |
|------------|------------|-----|
| `"type": "string"` | `string` | `string` |
| `"type": "number"` | `number` | `double` / `double?` |
| `"type": "integer"` | `number` | `int` / `int?` |
| `"type": "boolean"` | `boolean` | `bool` / `bool?` |
| `"type": "array"` | `T[]` | `List<T>` |
| `"format": "date-time"` | `string` | `DateTime` |
| `"format": "uuid"` | `string` | `Guid` |
| `"enum": [...]` | union type | `string` |

## Creating Discriminated Unions (Fully Automated!)

The generator **automatically detects and generates** discriminated unions. You just define the schema pattern:

**How it works:**
1. Define variants with discriminator fields (`const` values)
2. Create a union type using `oneOf`
3. Regenerate - the generator does everything else!

For polymorphic types (like LayoutItem), define each variant separately:

### 1. Define Base Properties (repeated in each variant)

```json
{
  "MyWidgetBase": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "type": { "type": "string", "const": "myType" }
    }
  }
}
```

### 2. Define Each Variant

```json
{
  "TextWidget": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "type": { "type": "string", "const": "text" },
      "placeholder": { "type": "string" }
    },
    "required": ["id", "type"]
  },
  "NumberWidget": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "type": { "type": "string", "const": "number" },
      "min": { "type": "number" },
      "max": { "type": "number" }
    },
    "required": ["id", "type"]
  }
}
```

### 3. Create Union Type

```json
{
  "Widget": {
    "oneOf": [
      { "$ref": "#/definitions/TextWidget" },
      { "$ref": "#/definitions/NumberWidget" }
    ]
  }
}
```

### 4. C# Generator Handles Everything Automatically

The C# generator (`generate-csharp.js`) **automatically**:
- ✅ Detects the `oneOf` pattern
- ✅ Identifies all variants from `$ref` references
- ✅ Detects discriminator fields (`type` has `const: "myType"`)
- ✅ Finds common properties (for base class)
- ✅ Generates abstract base class (`MyWidgetBase`)
- ✅ Generates concrete implementations for each variant
- ✅ Generates JSON converter with proper condition checking
- ✅ Adds converter attribute to base class

**Result:** You get a complete, type-safe discriminated union with zero manual C# code!

**Example output:**
```csharp
[JsonConverter(typeof(WidgetBaseConverter))]
public abstract class WidgetBase {
    public abstract string Type { get; }
}

public class TextWidget : WidgetBase {
    public override string Type => "text";
    public string Placeholder { get; set; }
}

public class NumberWidget : WidgetBase {
    public override string Type => "number";
    public double? Min { get; set; }
}

public class WidgetBaseConverter : JsonConverter<WidgetBase> {
    // Automatically generated if-else chain!
}
```

## Adding New Widget Types

To add a new input widget (e.g., "color picker"):

### 1. Add Config Type

```json
{
  "ColorWidgetConfig": {
    "type": "object",
    "properties": {
      "format": { "type": "string", "enum": ["hex", "rgb", "hsl"] },
      "showAlpha": { "type": "boolean" }
    },
    "additionalProperties": false
  }
}
```

### 2. Add Layout Item Variant

```json
{
  "InputColorLayoutItem": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "paramId": { "type": "string" },
      "displayName": { "type": "string" },
      "description": { "type": "string" },
      "order": { "type": "integer", "default": 0 },
      "span": { "type": "integer", "default": 1 },
      "type": { "type": "string", "const": "input" },
      "widgetType": { "type": "string", "const": "color" },
      "config": { "$ref": "#/definitions/ColorWidgetConfig" }
    },
    "required": ["id", "paramId", "type", "widgetType", "config"]
  }
}
```

### 3. Add to LayoutItem Union

```json
{
  "LayoutItem": {
    "oneOf": [
      { "$ref": "#/definitions/InputNumberLayoutItem" },
      { "$ref": "#/definitions/InputColorLayoutItem" },
      // ... other variants
    ]
  }
}
```

### 4. Regenerate Types

```bash
npm run generate:all
```

The C# generator **automatically**:
- Detects the new layout item in the `LayoutItem.oneOf` union
- Generates the `InputColorLayoutItem` class inheriting from `LayoutItemBase`
- Adds the discriminator case to the `LayoutItemConverter`

### 5. Add Type Guard (TypeScript - Optional)

In `generate-typescript.js`, add to the type guards section:

```javascript
export function isColorWidget(item: LayoutItem): item is InputColorLayoutItem {
  return item.type === 'input' && item.widgetType === 'color';
}
```

## Validation

After regenerating:

```bash
# Check TypeScript
cd ../web && npm run check

# Check C#
cd .. && dotnet build
```

## Common Issues

### "Property X not found"
- Check spelling in JSON Schema
- Verify property is in the `properties` object
- Run `npm run generate:all`

### "Type mismatch"
- Check type mappings table above
- Optional properties need `?` in required arrays
- Regenerate after schema changes

### "C# 7.3 compatibility"
- Don't use switch expressions in generator
- Use if-else chains instead
- Avoid pattern matching with tuples

## Files

- `ui-schema.json` - Source of truth
- `generate-typescript.js` - TypeScript generator
- `generate-csharp.js` - C# generator
- `package.json` - Generator dependencies

## Generated Output

- `../web/src/lib/types/generated/schema.ts`
- `../Plugin/Models/Generated/UISchema.Generated.cs`

Never edit these files directly - they will be overwritten!
