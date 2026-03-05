# Schema Generation

Single source of truth for type-safe C# and TypeScript types across the entire codebase.

## Quick Start

1. Edit `ui-schema.json`
2. Run:
   ```bash
   cd packages/schemas && npm run generate:all
   ```
3. Types auto-update in:
   - TypeScript: `packages/shared/src/lib/types/generated/schema.ts`
   - C#: `Plugin/Selva.Core/Models/UISchema.Generated.cs`

## Adding a Type

```json
{
	"definitions": {
		"MyType": {
			"type": "object",
			"properties": {
				"id": { "type": "string" },
				"name": { "type": "string" }
			},
			"required": ["id", "name"]
		}
	}
}
```

## Adding a Property to an Existing Type

1. **Open** `ui-schema.json`
2. **Find** the type in `definitions` (e.g., `User`)
3. **Add** property to `properties`:
   ```json
   "properties": {
     "id": { "type": "string" },
     "name": { "type": "string" },
     "email": { "type": "string" }  // ← New property
   }
   ```
4. **(Optional) Make it required** — Add to `required` array:
   ```json
   "required": ["id", "name", "email"]
   ```
5. **Save and run:**
   ```bash
   cd packages/schemas && npm run generate:all
   ```
6. **TypeScript and C# types update automatically** ✓

### Full Example

```json
{
  "definitions": {
    "User": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "name": { "type": "string" },
        "email": { "type": "string" },
        "age": { "type": "integer" },
        "active": { "type": "boolean" }
      },
      "required": ["id", "name", "email"]
    }
  }
}
```

**Optional properties** (`age`, `active`) are not in `required` and become nullable in C# (`int?`, `bool?`).

## Type Mappings

| JSON      | TypeScript | C#        |
| --------- | ---------- | --------- |
| `string`  | `string`   | `string`  |
| `number`  | `number`   | `double?` |
| `integer` | `number`   | `int?`    |
| `boolean` | `boolean`  | `bool?`   |
| `array`   | `T[]`      | `List<T>` |

## Discriminated Unions

Define variants with `const` discriminator:

```json
{
	"Widget": {
		"oneOf": [{ "$ref": "#/definitions/TextWidget" }, { "$ref": "#/definitions/NumberWidget" }]
	},
	"TextWidget": {
		"type": "object",
		"properties": {
			"type": { "type": "string", "const": "text" },
			"placeholder": { "type": "string" }
		}
	},
	"NumberWidget": {
		"type": "object",
		"properties": {
			"type": { "type": "string", "const": "number" },
			"min": { "type": "number" }
		}
	}
}
```

The C# and TypeScript generators automatically create the classes and converters.
