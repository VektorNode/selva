# Schema Generation

Edit `ui-schema.json` and run:

```bash
npm run generate:all
```

This generates type-safe C# and TypeScript from the schema automatically.

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

## Modifying Types

**Add a property:**

```json
"myType": { "type": "string" }
```

**Make it required:**
Add to `required` array

**Make it optional:**
Omit from `required` array

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
