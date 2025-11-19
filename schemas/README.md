# Schema Generation Guide

This directory contains the JSON Schema source of truth for all shared types between C# and TypeScript.

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

## Creating Discriminated Unions

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

### 4. Update C# Generator (if needed)

For new discriminated unions, update `generate-csharp.js` to add:
- Abstract base class
- Concrete implementations
- JSON converter with if-else chain

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

### 4. Update C# Generator

In `generate-csharp.js`, add to the if-else chain in the converter:

```javascript
else if (type == "input" && widgetType == "color")
    item = new InputColorLayoutItem();
```

And add the C# class definition in the template string.

### 5. Add Type Guard (TypeScript)

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
