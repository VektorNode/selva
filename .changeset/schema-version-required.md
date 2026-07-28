---
'@selvajs/schemas': minor
---

Make `schemaVersion` a required field on `UISchema` (schema format v2.11.0 → v2.12.0) and export `UI_SCHEMA_VERSION`, the current schema-format version, from the generated constants.

No data transformation: the C# model has always emitted `schemaVersion` (property initializer + migrator stamp), so every schema produced by the plugin already carries it. Making it required lets the web side treat a stored schema's version as authoritative — the render path re-extracts from compute (which runs the C# `SchemaMigrator`) when a cached schema's version is stale, instead of ever migrating in TypeScript.

TypeScript consumers constructing `UISchema` values by hand must now set `schemaVersion` (use `UI_SCHEMA_VERSION`).
