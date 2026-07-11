# @selvajs/server

## 0.2.0-beta.0

### Minor Changes

- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.

- 2673995: Extract the configurable provider wiring into `@selvajs/server/providers` (embeddable-server-layer K5):

  - **`createSelvaProviders(env, options)`** — the reusable core of the app's composition root: env-driven provider selection (`SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`) over a caller-supplied `ProviderRegistry` of `fromEnv`-style factories, the external `selva.config.js` override (pass `configPath`), lazy memoized instantiation (nothing touches provider secrets at import/build time), flags (`SELVA_FLAG_*`, compile-time-exhaustive over `SelvaFlags`), branding with defaults, tenancy parsing, and the solve-metrics duck-type pick. Provider implementations are NOT bundled — the registry keeps this package free of dependencies on `@selvajs/local-provider` / `@selvajs/supabase-provider`.
  - **`@selvajs/selva`** — `providers.server.ts` is now the app's composition root only: the bundled-provider registry, service singletons, and Sentry/process-hook error reporting; all wiring logic delegates to the package runtime.
  - The shared `readBool`/`readPositiveInt` env parsers now warn with a `[selva]` prefix (previously `[computeLimits]`), since they serve provider flags too.

### Patch Changes

- Updated dependencies [2673995]
  - @selvajs/schemas@4.7.0-beta.0
  - @selvajs/platform@0.14.3-beta.0
