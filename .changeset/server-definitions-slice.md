---
'@selvajs/server': minor
'@selvajs/supabase-provider': patch
'@selvajs/selva': patch
---

Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

- **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
- Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
- **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
- **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.
