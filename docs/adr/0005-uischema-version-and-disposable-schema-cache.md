# ADR 0005 — Stored UISchemas Are a Disposable Cache; Compute Owns Migration

> **Status: Accepted (2026-07-11), implemented same day.** Resolves audit item
> [D1](../../plans/fixes/data-access-efficiency-audit.md) (stored UISchema blobs never migrated on the web
> side — RANK 1) ahead of extracting the definitions slice into
> [`@selvajs/server`](../../packages/server/) (the former `docs/plans/embeddable-server-layer.md`
> tracker, item K4; deleted 2026-07-13 once its work shipped), so the migration
> story doesn't ship inside the package and freeze the blob format as contract.
>
> **Implementation moved (K4, since shipped).** The version-check and re-extract
> logic named below now lives in
> [`@selvajs/server/definitions`](../../packages/server/src/definitions/) —
> `load-for-render.ts` and `schema-extraction.ts`. The app files still exist as
> thin bindings that wire in providers and compute resolution; the decision logic
> is in the package. Behaviour is unchanged.

## Problem

The C# plugin has a full schema migration registry
([SchemaMigrator.cs](../../Plugin/Selva.Schema/Services/SchemaMigrator.cs), 1.0.0 → current,
including breaking field renames) — but it runs **only inside Grasshopper / Rhino.Compute**. The web
app stores `DefinitionVersion.schema` as an opaque JSONB blob and, before this ADR, the render path
consumed it **verbatim with no version check**. `schemaVersion` wasn't even required by
`ui-schema.json`.

Once definitions accumulate at old schema versions, the options degrade to: port the C# migrator to
TypeScript (double-maintenance forever) or backfill-migrate every stored blob on each schema bump.
Selva is pre-first-release, so the decision was free — but only if made now.

A related runtime gap shared the same fix surface: no plugin↔app compat gate existed at upload — a
definition authored with a **newer** plugin than the app understands was silently accepted, then
crashed the renderer with no actionable message.

## Decision

**The stored schema is a disposable cache of a compute-derivable artifact. Rhino.Compute (which runs
the C# migrator) is the single migration engine; the web side never migrates schemas.**

Concretely:

1. **`schemaVersion` is required on `UISchema`** (schema format 2.11.0 → 2.12.0). The C# model has
   always emitted it (property initializer + migrator stamp), so this is contract-tightening, not a
   data change. The TS generator now also emits `UI_SCHEMA_VERSION` — the app's supported format
   version, sourced from the `schemaVersion` default in `ui-schema.json` (same single-schema
   philosophy as the type generation itself).

2. **Migrate-on-read = re-extract.** The render path
   ([loadForRender.server.ts](../../packages/selva/src/lib/server/definitions/loadForRender.server.ts))
   uses the cached schema only when `schema.schemaVersion === UI_SCHEMA_VERSION`. On mismatch (or a
   pre-caching row with no schema), it re-fetches from compute's `/grasshopper/schema` — one compute
   round-trip per stale definition, after which the refreshed schema is persisted back onto the
   version row (best-effort; a read-only context skips it and the next writer lands it). Persisting
   only happens when the re-extracted schema is at the app's current version, so an out-of-date
   compute plugin can't thrash the cache with schemas that would immediately be stale again.

3. **Newer-than-supported is rejected, loudly.** `assertSupportedSchemaVersion` in
   [schemaExtraction.server.ts](../../packages/selva/src/lib/server/definitions/schemaExtraction.server.ts)
   throws `SchemaExtractionError('unsupported')` when an extracted schema's version is **newer** than
   `UI_SCHEMA_VERSION` — surfaced as 422 with a "this server supports ≤ X" message at upload, and as
   a classified `DefinitionLoadError` at render. Older versions pass: older shapes only lack optional
   additions and the C# migrator emits its own current version anyway.

4. **`schema_version` is queryable but derived.** Supabase gets a `GENERATED ALWAYS AS
(schema->>'schemaVersion') STORED` column
   ([migration](../../packages/providers/supabase/supabase/migrations/20260711120000_selva_definition_schema_version.sql))
   for ops queries ("how many stale versions?"). Generated, not written: it can never drift from the
   blob, and no store write path had to change. The app reads the version from the blob, never from
   this column.

## Alternatives rejected

- **Port the migrator to TypeScript** — permanent double-maintenance of migration logic that already
  exists, is tested, and must keep existing in C# (Grasshopper loads old schemas too).
- **Backfill-migrate blobs on every schema bump** — an ops job per release, and the web side still
  needs the migrator to run it.
- **A real (written) `schema_version` column** — write-path churn in two providers and a drift risk,
  for no capability the generated column doesn't provide.

## Consequences

- Changing the schema format stays exactly as cheap as it is today: bump the default in
  `ui-schema.json`, add a `SchemaMigrator.cs` entry, regenerate. The web side needs **zero** work per
  bump — stale caches refresh themselves on next render.
- A definition whose compute server runs an **older** plugin than the app re-extracts on every render
  (cache never freshens) — one extra compute round-trip per render plus a warn log, self-healing the
  moment the plugin is updated. Accepted: it's an operator-visible misconfiguration, not a data
  hazard.
- K4 can now extract `loadForRender`/`schemaExtraction` into `@selvajs/server` without embedding a
  migration shim: the package's contract is "cache if current, else re-extract", and the blob format
  itself never becomes package API.
