# Schema Caching at Upload

Status: implemented (see addendum)
Date: 2026-05-29

> **Addendum (2026-07-11, [ADR 0005](../../../docs/adr/0005-uischema-version-and-disposable-schema-cache.md)):**
> the cached schema is now version-checked on read. The render loader (extracted to
> `@selvajs/server/definitions`) uses the cached schema only when its `schemaVersion` matches the
> app's `UI_SCHEMA_VERSION`; on mismatch it re-extracts from compute (which runs the C# migrator)
> and persists the refreshed schema back best-effort. Upload extraction additionally rejects schema
> formats newer than the app supports (`assertSupportedSchemaVersion` → 422). The solve-time lazy
> backfill bridge below is unchanged and still scheduled for removal ~2026-09.

## Summary

Cache each definition version's compute-extracted `UISchema` on the
`DefinitionVersion` row so it doesn't have to be re-fetched from Rhino.Compute
on every render. Make schema extraction a hard gate on upload — **no upload
succeeds unless compute is online and returns a valid schema**.

For definitions uploaded before this change (and for anyone already running
Selva), backfill the schema lazily at solve time. This is a deliberately
**temporary bridge** — remove it once existing data has aged through (~3 months).

## Motivation

Today the UI schema is derived from the `.gh` bytes by Rhino.Compute's
`/grasshopper/schema` endpoint, and that call is made fresh on **every render**
([loadForRender.server.ts](../src/lib/server/definitions/loadForRender.server.ts)).
The bytes are immutable per version, so the schema is too — re-deriving it on
every page load is wasted round-trips to compute.

## Design decisions

1. **Storage location: the version row, not the definition record.** Versions
   are immutable and 1:1 with the `.gh` bytes, so the schema is an immutable
   property of the version. The definition record's `live`/`draft` channels are
   just pointers (§4.4–4.5 of [Architecture.md](./Architecture.md)) — storing
   schema there would mean rewriting it on every publish/rollback.

2. **Cache the raw schema only.** We store the `UISchema` exactly as
   `/grasshopper/schema` returns it. The render path still calls `getIO` +
   `mergeComputeDefaults` to merge compute default values (incl. color→hex). This
   removes one of the two compute calls per render, not both. (Caching the
   merged schema would bake defaults at upload time — rejected.)

3. **Validate before any write.** On upload we extract the schema _first_; only
   if it succeeds do we write the blob and the version row. A compute outage or a
   `.gh` with no valid "Schema" output produces a clean 503/422 and persists
   nothing — no orphan blob, no version row.

4. **Validation lives in the route handler.** The HTTP route resolves the
   compute server and calls the extraction helper, then passes the validated
   schema into `DefinitionService`. The service does no compute work; it just
   stores what it's given.

5. **Field is optional at the type level — for now.** Because of the lazy-
   backfill bridge, old version rows legitimately have no schema for a while.
   `schema?` stays optional until the bridge is removed, then it can be tightened
   to required.

6. **`@selvajs/platform` gains a types-only dependency on `@selvajs/schemas`**
   for the `UISchema` type. This slightly relaxes platform's "pure interfaces,
   zod-only" stance, but it's a `type`-only import (no runtime coupling).

## Scope

Applies to **all uploads** — both `DefinitionService.create` (v1) and
`uploadVersion` (new versions).

## Changes

### 1. Data model — `packages/platform`

- [definitions/types.ts](../../platform/src/definitions/types.ts) — add to
  `DefinitionVersion`:
  - `schema?: UISchema`
  - `schemaExtractedAt?: string`
  - `import type { UISchema } from '@selvajs/schemas'`
- [definitions/schemas.ts](../../platform/src/definitions/schemas.ts) — add
  `schema` (permissive object — correctness is validated by compute, not Zod)
  and `schemaExtractedAt` to `DefinitionVersionSchema`, both optional.
- [definitions/interface.ts](../../platform/src/definitions/interface.ts) — add
  `setVersionSchema(ctx, versionId, schema): Promise<void>` for the backfill.
- `package.json` — add `@selvajs/schemas: workspace:*`.

### 2. Shared extraction helper — `packages/selva`

Promote `fetchSchemaFromCompute` out of
[loadForRender.server.ts:134](../src/lib/server/definitions/loadForRender.server.ts#L134)
into a shared module (`lib/server/definitions/schemaExtraction.server.ts`).
Consumed by upload routes, render, and the solve-time bridge. It already throws
on `!response.ok` and on zero schemas — that _is_ the validation gate.

### 3. Upload — validate first, in the route

- [api/definitions/+server.ts](../src/routes/api/definitions/+server.ts)
  (create) and
  [api/definitions/[guid]/+server.ts](../src/routes/api/definitions/[guid]/+server.ts)
  (new version): resolve compute server, call the extraction helper, fail the
  request (503 unreachable / 422 no valid schema) before touching
  `definitionService`.
- `DefinitionService.create` / `uploadVersion`: accept the validated `schema`,
  store it (+ `schemaExtractedAt`) on the version row. No compute work in the
  service.

### 4. Solve-time lazy backfill (TEMPORARY BRIDGE)

- [lib/server/compute/solve.server.ts](../src/lib/server/compute/solve.server.ts),
  after `serverConfig` is resolved, for **local** definitions only: if
  `version.schema` is missing, extract from the already-loaded
  `definitionSource` and write back via `setVersionSchema`.
- Best-effort: never block or fail the solve on backfill error — log only.
- Mark clearly: `// BRIDGE: remove ~2026-09 — see specs/SchemaCaching.md`.
- The _app_ performs the missing-schema check; the compute server stays a dumb
  extraction endpoint, keeping the bridge entirely in app code.

### 5. Render path

[loadForRender.server.ts](../src/lib/server/definitions/loadForRender.server.ts):
use `version.schema` when present; otherwise live-fetch (same fallback the
bridge relies on). `getIO` + `mergeComputeDefaults` unchanged.

### 6. Providers + tests

- Local provider: implement `setVersionSchema`; confirm the field persists.
- Supabase: `schema jsonb` + `schema_extracted_at timestamptz` columns +
  migration; implement `setVersionSchema`; map in row↔record conversion.
- Conformance suite + fixtures: cover the new field and method.
- Tests:
  - upload rejects when compute is unreachable / returns no schema — assert **no
    blob and no version row** written;
  - upload stores the schema on success;
  - solve backfills a schema-less version exactly once; a failed backfill does
    not fail the solve.

## Removal plan (the bridge)

Once existing versions have aged through (~2026-09): delete the solve-time
backfill block, tighten `schema` to required in types + Zod, drop the fallback
live-fetch in the render path, and (optionally) run a final one-off sweep for
any never-solved stragglers.
