# Schema caching on the version row

Each `DefinitionVersion` carries the compute-extracted `UISchema` (`schema`,
`schemaExtractedAt`), so rendering a definition doesn't re-derive it from the `.gh` bytes on
every page load.

## Why the version row

Versions are immutable and 1:1 with the `.gh` bytes, so the schema is an immutable property of
the version. `liveVersionId`/`draftVersionId` on the definition record are just pointers: storing
the schema there would mean rewriting it on every publish and rollback.

## What is cached

The schema Rhino.Compute's `/grasshopper/schema` returns, with the input values saved in the file
(`/io`, colors as hex) as defaults. The embedded schema only holds the values from the author's
last schema sync. The bytes are immutable, so the merged values are too.

Upload merges them best-effort and gives `/io` 5 s past the schema. The render loader reads `/io`
once per version per process, behind the render, and writes the row back when its defaults differ.
Nothing on the row says it is merged, which is why every process reads once. A row from before the
merge shows sync-time defaults on its first render only.

The render never waits on Compute while the row holds a renderable schema. That matters for large
definitions: `/io` sends the whole file, and a 5 MB `.gh` keeps it busy past a reverse proxy's
timeout.

## Upload is a hard gate

Extraction runs **before** any write: the upload handlers
([definitions.ts](../../packages/server/src/handlers/definitions.ts),
[definitionVersions.ts](../../packages/server/src/handlers/definitionVersions.ts)) resolve the
compute server and call [schema-extraction.ts](../../packages/server/src/definitions/schema-extraction.ts).
They fail the request (503 compute unreachable or serving an unreadable schema, 422 no valid
schema or one newer than the app supports) before `DefinitionService` touches storage. A failed
upload leaves no orphan blob and no version row.

The service itself does no compute work; it stores what the handler hands it.

## Version checking on read

[ADR 0005](../adr/0005-uischema-version-and-disposable-schema-cache.md) made the cache
disposable: the render loader (`@selvajs/server/definitions`, wired by
[loadForRender.server.ts](../../packages/selva/src/lib/server/definitions/loadForRender.server.ts)) uses the cached
schema as fresh only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`. An older
one still renders while the loader re-extracts from compute (which runs the C# migrator) and
persists the refreshed schema back best-effort. Only a version with no renderable schema waits on
the extract, for at most `renderWaitMs`, then answers 503 while the extract finishes for the retry.

## The backfill bridge (temporary)

Versions uploaded before caching landed have no schema. `solve.server.ts` extracts and writes one
back on first solve, best-effort: a failed backfill never fails the solve. The block carries one
marker, `// BRIDGE: remove ~2026-09`, and the date has passed.

Removing it: delete that block in
[solve.server.ts](../../packages/selva/src/lib/server/compute/solve.server.ts), tighten `schema` to
required in `DefinitionVersion` (types + Zod), and drop the render path's no-schema case in
[load-for-render.ts](../../packages/server/src/definitions/load-for-render.ts). Keep its
re-extract on a `schemaVersion` mismatch: ADR 0005 depends on it.
