# `@selvajs/compute` — Rhino.Compute focus, cleaner API, smaller files

> **Status: PROPOSED (2026-07-22) — not yet started.** Companion to
> [visualization-package.md](./archive/visualization-package.md). Once the viewer leaves for
> `@selvajs/visualization`, `@selvajs/compute` becomes a pure Rhino.Compute / Grasshopper library
> (no `three`, only `rhino3dm` + `fflate`). This plan tightens what remains: split the 5 oversized
> files along seams they already have, clarify the two-layer public API, and fix the naming warts.
> Pre-release, so renames are free. Do the visualization split first; this is a follow-on.

## What compute is after the viewer leaves

Two coherent layers, both Rhino.Compute-focused, zero `three`:

```
core/       low-level Rhino.Compute transport      @selvajs/compute/core
  compute-fetch/  the POST to a compute server (retry, timing, errors)
  server/         health + stats
  files/          file I/O from compute responses
  errors, types, utils

grasshopper/  high-level Grasshopper API            @selvajs/compute/grasshopper
  client/     GrasshopperClient
  io/         definition I/O, input processing, output decoding (rhino3dm)
  scheduler/  SolveScheduler (latest-wins/queue/parallel + cache)
  data-tree/  data tree + tree paths
  solve, definition-ref, types
```

`rhino3dm` is used only in `io/output/{rhino-decoder,response-processors}.ts` — correct; decoding
Rhino geometry is exactly its job. Keep it a peer dep.

## Problems found (audit)

### 1. Oversized files (split along existing seams)

| File                                  | Lines | Seam it already has                                                        | Split into                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ----- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scheduler/solve-scheduler.ts`        | 993   | class with 3 clear responsibilities: queueing, execution, caching          | `solve-scheduler.ts` (class core ~350) + `scheduler/queue.ts` (enqueue/supersede/drain/timers) + `scheduler/cache.ts` (read/write/evict/stats) + `scheduler/types.ts` (SchedulerMode, CacheOptions, SolveContext, SolveResult)                                                                                           |
| `core/compute-fetch/compute-fetch.ts` | 858   | private fns already grouped: request-build, response-handle, retry, timing | `compute-fetch.ts` (fetchRhinoCompute + attemptFetch ~250) + `request.ts` (buildUrl/buildHeaders/requestId/localhost) + `response.ts` (handleResponse/http-error/error-code-map) + `retry.ts` (resolveRetryPolicy/backoff/parseRetryAfter/sleep) + `server-timing.ts` (parseServerTiming/composeSignal/fireServerTiming) |
| `core/server/compute-server-stats.ts` | 696   | one big class                                                              | `compute-server-stats.ts` (class ~300) + `server/endpoints.ts` (raw endpoint calls) + `server/stats-types.ts` (response shapes)                                                                                                                                                                                          |
| `grasshopper/data-tree/data-tree.ts`  | 601   | `TreeBuilder` class + free helpers                                         | `data-tree.ts` (TreeBuilder ~300) + `data-tree/serialize.ts` (to/from wire) + `data-tree/types.ts` (DataTreeValue + tree types)                                                                                                                                                                                          |
| `io/input/input-type-parsers.ts`      | 559   | already `// ===` sectioned: transformers, rounding, numeric, registry      | `input-type-parsers.ts` (registry + interface ~120) + `input/transformers.ts` (numeric/boolean/object) + `input/numeric-rounding.ts` (applyRounding/stepSize/computeNumeric)                                                                                                                                             |

Target: **no file over ~350 lines.** Each split follows a boundary the code already draws with
private-function grouping or `// ===` headers, so it's mechanical, not a rewrite.

### 2. API-surface warts

- **Two "response processor" names.** `client/grasshopper-response-processor.ts` (a class,
  `GrasshopperResponseProcessor`) and `io/output/response-processors.ts` (free fns `getValues`/
  `getValue`) are unrelated but read as duplicates. **Fix:** rename the io/output one to
  `output-values.ts` exporting `getValues`/`getValue` — the file name then says what it does.
- **`@/core/files` re-exported from grasshopper "for back-compat".** Pre-release means no back-compat
  burden. **Fix:** drop the re-export from `grasshopper/index.ts`; files live in `core`, consumers
  import from `@selvajs/compute/core`. (The top `@selvajs/compute` barrel still surfaces both.)
- **`default` exports mixed with named.** `GrasshopperClient`, `GrasshopperResponseProcessor`,
  `ComputeServerStats` are `export default`; everything else is named. **Fix:** make them all named
  exports for consistent, greppable, tree-shakeable imports. One convention across the package.
- **Barrel re-exports 40+ types flat.** The `grasshopper` barrel dumps every type at one level.
  **Fix:** keep the flat re-export (consumers rely on it) but group the _source_ types file — see #3.

### 3. `grasshopper/types.ts` (424) is a catch-all

Split by concern so a contributor finds the right type fast:

- `types/inputs.ts` — `InputParam` union + all `*InputType`
- `types/outputs.ts` — `OutputType`, `OutputParamSchema`
- `types/schema.ts` — `GrasshopperRequestSchema`, `*ComputeResponse`, `*ParsedIO`, `IoResponseSchema`
- `types/index.ts` — re-export barrel (keeps the flat public surface unchanged)

### 4. Public API: make the two layers first-class

Today: `@selvajs/compute` (all), `/core`, `/grasshopper`, and the now-deleted `/visualization`.
Keep exactly the two sub-paths, and make the top barrel a thin re-export of both. Document the
choice in the README:

- `@selvajs/compute/core` — "I want to talk to a Rhino.Compute server myself" (fetch, stats, errors).
- `@selvajs/compute/grasshopper` — "I want to solve Grasshopper definitions" (client, scheduler, IO).
- `@selvajs/compute` — everything.

Add a package `README.md` with this layer diagram and a one-liner per export group — the package
currently has none at the top level.

## Migration steps (each independently reviewable, tests move with code)

1. Delete `src/visualization.ts` barrel + its package.json export (done as part of the visualization-package plan).
2. **Types split** — `grasshopper/types.ts` → `types/{inputs,outputs,schema,index}.ts`. Re-export
   barrel keeps the public surface byte-identical. Verify `pnpm type-check`.
3. **Scheduler split** — `solve-scheduler.ts` → + `queue.ts` + `cache.ts` + `types.ts`. Move the
   scheduler tests alongside; they should pass unchanged.
4. **compute-fetch split** — → `request.ts` + `response.ts` + `retry.ts` + `server-timing.ts`.
5. **server-stats split** + **data-tree split** + **input-type-parsers split**.
6. **Naming fixes** — rename `io/output/response-processors.ts` → `output-values.ts`; convert the 3
   `default` exports to named; drop the `core/files` back-compat re-export from the gh barrel.
7. Add top-level `packages/compute/README.md` with the layer diagram + export-group table.
8. `pnpm build && pnpm check && pnpm test` green; changeset (pre-release bump — this renames
   exports, so it's a breaking change on paper, free pre-release).

## Out of scope

- Behaviour changes — this is structure + naming only, no logic edits.
- `SolveScheduler` semantics (latest-wins/queue/parallel) — untouched.
- Anything in `@selvajs/visualization` (see visualization-package.md).
