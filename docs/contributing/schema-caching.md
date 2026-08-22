# Schema caching on the version row

Each `DefinitionVersion` carries the compute-extracted `UISchema` (`schema`,
`schemaExtractedAt`), so rendering a definition doesn't re-derive it from the `.gh` bytes on
every page load.

## Why the version row

Versions are immutable and 1:1 with the `.gh` bytes, so the schema is an immutable property of
the version. `live`/`draft` on the definition record are just pointers — storing the schema
there would mean rewriting it on every publish and rollback.

## What is cached

Only the raw schema, exactly as Rhino.Compute's `/grasshopper/schema` returns it. The render
path still calls `getIO` + `mergeComputeDefaults` to merge compute default values (including
color→hex). Caching the merged result would bake defaults in at upload time.

## Upload is a hard gate

Extraction runs **before** any write: the route resolves the compute server, calls
[schema-extraction.ts](../../packages/server/src/definitions/schema-extraction.ts), and fails
the request (503 unreachable / 422 no valid schema) before `DefinitionService` touches storage.
A failed upload leaves no orphan blob and no version row. `assertSupportedSchemaVersion` also
rejects a schema format newer than the app supports.

The service itself does no compute work — it stores what the route hands it.

## Version checking on read

[ADR 0005](../adr/0005-uischema-version-and-disposable-schema-cache.md) made the cache
disposable: the render loader (`@selvajs/server/definitions`, wired by
[loadForRender.server.ts](../../packages/selva/src/lib/server/definitions/loadForRender.server.ts)) uses the cached
schema only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`. On mismatch it
re-extracts from compute — which runs the C# migrator — and persists the refreshed schema back
best-effort.

## The backfill bridge (temporary)

Versions uploaded before caching landed have no schema. `solve.server.ts` extracts and writes one
back on first solve, best-effort — a failed backfill never fails the solve. Both sites are marked
`// BRIDGE: remove ~2026-09`.

Removing it: delete the two blocks in
[solve.server.ts](../../packages/selva/src/lib/server/compute/solve.server.ts), tighten `schema` to required in
`DefinitionVersion` (types + Zod), and drop the render path's live-fetch fallback.
