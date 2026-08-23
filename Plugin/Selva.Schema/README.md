# Selva.Schema

Schema models, validation, and migration for the Selva Grasshopper plugin. **No Rhino or Grasshopper
dependencies** — that's what lets `Selva.Tests` exercise it without a Rhino host.

Targets `netstandard2.0`, so it loads under every runtime `Selva.GH` targets: .NET Framework 4.8 and
.NET 7.0 (Rhino 8), .NET 9.0 (Rhino 9). Rhino 7 is not supported.

Its only package dependency is Newtonsoft.Json, versioned centrally in
[Directory.Packages.props](../Directory.Packages.props).

## Layout

| Path                                                                           | Contents                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [Models/UISchema.Generated.cs](Models/UISchema.Generated.cs)                   | **Generated** from `packages/schemas/ui-schema.json`. Never hand-edit. |
| [Models/SchemaSerializationSettings.cs](Models/SchemaSerializationSettings.cs) | The one `JsonSerializerSettings` every read and write path uses.       |
| [Converters/](Converters/)                                                     | Newtonsoft converters for shapes the generator can't express directly. |
| [Services/Validation/](Services/Validation/)                                   | Rule-based schema validation — see its own README.                     |
| [Services/SchemaMigrator.cs](Services/SchemaMigrator.cs)                       | Migrates an older schema to the current version.                       |
| [Services/SchemaBackupService.cs](Services/SchemaBackupService.cs)             | Snapshots a schema before a migration rewrites it.                     |
| [Constants/SchemaVersion.cs](Constants/SchemaVersion.cs)                       | The current schema version, in one place.                              |

## Regenerating the models

Edit `packages/schemas/ui-schema.json`, then from the repo root:

```bash
pnpm generate     # regenerates both the C# models and the TypeScript types
```

CI fails if the committed output drifts from the source schema.

## Consumers

`Selva.GH` (the plugin) and `Selva.Tests`.
