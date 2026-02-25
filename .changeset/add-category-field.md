---
"@selva/shared": minor
---

Add `category` field to `UISchema` for organizing schemas (e.g., 'architecture', 'structural'). Bump schema version default to `2.1.0`. The C# generator now also auto-updates `SchemaVersion.cs` from the schema's `schemaVersion` default, so bumping the version in `ui-schema.json` is the only change needed going forward.
