# `@selvajs/compute` — post-viewer cleanup

> **Status: REVISED (2026-07-31), not started.** The original 2026-07-22 proposal was written
> _before_ the viewer split landed and assumed seams that turned out not to exist. This revision is
> validated against the code as it stands today: file structure re-measured, the barrel diff computed
> exactly, and every export cross-referenced against its real consumers across the monorepo.
>
> **Three of the five proposed file splits were dropped** — they fight shared mutable state and would
> risk behaviour in the scheduler for a line-count target no consumer benefits from. Two structural
> items and several genuine defects survive. See [What changed](#what-changed-from-the-original-plan).

The viewer has left for `@selvajs/visualization`. `@selvajs/compute` is now a pure Rhino.Compute /
Grasshopper library — no `three`, only `rhino3dm` + `fflate`.

## Audit findings

### The published README advertises an API the package no longer has

The highest-value item here, and one the original plan missed entirely — it assumed no top-level
README existed. [`packages/compute/README.md`](../../packages/compute/README.md) is 239 lines and
still sells Three.js as a headline feature:

| Line    | Stale claim                                                                    |
| ------- | ------------------------------------------------------------------------------ |
| 17      | "visualizing results in the browser with Three.js"                             |
| 22      | `npm install @selvajs/compute three`                                           |
| 25      | "`three` is a peer dependency if you use the visualization features"           |
| 35      | "**Ready-to-use visualization** — Integrated Three.js setup `initThree()`"     |
| 146     | "**three** >= 0.179.0 (required for visualization features)"                   |
| 221-224 | A troubleshooting section for `"Failed to load three.js visualization module"` |

None of this is true. `three` is not in `dependencies`, `peerDependencies`, or `devDependencies`, and
`initThree` lives in `@selvajs/visualization`. This is published to npm — a reader following the
install line adds a package they don't need, then hunts for an export that isn't there.

### `src/features/` is a one-child wrapper

`src/features/` holds exactly one child, `grasshopper/`. It was meaningful when `visualization/` was
its sibling; now the folder carries no information and breaks symmetry with the entrypoints — `/core`
maps to `src/core`, but `/grasshopper` maps to `src/features/grasshopper`.

**Blast radius (measured):** 17 files reference `@/features/grasshopper` — 14 test files, 2 READMEs,
and `tests/helpers/test-data-builders.ts`. Layering is clean: `src/core/` never imports from
`features/`, so the move has no cyclic risk.

### `src/grasshopper.ts` duplicates the inner barrel — and they have already drifted

[`src/grasshopper.ts`](../../packages/compute/src/grasshopper.ts) hand-relists ~50 symbols that
`src/features/grasshopper/index.ts` already exports. Two barrels at the same layer, one enumerating
the other; every new export needs editing in both places, and nothing fails when they disagree.
`core` has no such file — `/core` maps straight to `src/core/index.ts` via tsup.

They have already drifted. **Measured diff** (inner barrel vs. emitted `dist/grasshopper.d.ts`):
inner exports 62 symbols, the published surface has 51. Deleting `src/grasshopper.ts` naively would
newly publish these 15:

| Symbol                            | Consumer?                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `extractFilesFromComputeResponse` | **Yes — external.** `parafa/src/lib/server/solutions/extractSolutionFiles.server.ts`, load-bearing per its ADR-0010 |
| `downloadFileData`                | **Yes** — `packages/ui/src/lib/utils/file-download.ts` (imports from **root**, not `/grasshopper`)                  |
| `FileData`                        | **Yes** — `packages/ui` file-download + 2 preview components; also parafa's file extraction                         |
| `getValue`                        | Only as a **method** on `GrasshopperResponseProcessor` — the free function is unused                                |
| `getValues`                       | No — compute's own README only                                                                                      |
| `processInputsWithErrors`         | No — internal, used by `io/definition-io.ts`                                                                        |
| `registerDecoder`                 | No                                                                                                                  |
| `disposeRhinoObjects`             | No                                                                                                                  |
| `ProcessedFile`                   | No                                                                                                                  |
| `BaseInputType`                   | No                                                                                                                  |
| `ColorInputType`                  | No                                                                                                                  |
| `GrasshopperBaseSchema`           | No                                                                                                                  |
| `GrasshopperDefinitionSource`     | No                                                                                                                  |
| `InputParseError`                 | No                                                                                                                  |
| `IoResponseSchema`                | No                                                                                                                  |

`extractFilesFromComputeResponse` **must stay public** — it is currently reachable only because
`src/grasshopper.ts` re-publishes it through the root barrel. Cutting it breaks parafa's file
pipeline. The other 11 unreferenced symbols still each need a deliberate keep-or-cut call, and
**that decision list _is_ the work of this step**, not a footnote.

### The `/core` and `/grasshopper` subpaths — used, but only externally

The original plan proposed making the two layers "first-class." Within this monorepo that looks
unjustified, but the external consumers change the answer:

| Subpath                        | In this monorepo                          | parafa                   | parapet                                                            |
| ------------------------------ | ----------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| `@selvajs/compute` (root)      | 18 symbols — the real surface             | 8 symbols                | 12 symbols                                                         |
| `@selvajs/compute/core`        | 2 — `ComputeServerStats`, `camelcaseKeys` | 1 — `ComputeServerStats` | 1 — `camelcaseKeys` (2 call sites)                                 |
| `@selvajs/compute/grasshopper` | 1, type-only — `GrasshopperClient`        | 1 — `GrasshopperClient`  | **3 as values** — `GrasshopperClient`, `TreeBuilder`, `InputParam` |

Parapet is the only consumer that genuinely imports through the layer split, including value
imports in [`routes/compute/[slug]/+page.svelte`](d:/Coding/parapet/packages/app/src/routes/compute/[slug]/+page.svelte)
and [`routes/api/admin/compute/+server.ts`](d:/Coding/parapet/packages/app/src/routes/api/admin/compute/+server.ts).

The root barrel is `export * from './core'` + `'./grasshopper'`, so every symbol is _also_ reachable
from the root. **Conclusion unchanged in effect but not in reasoning:** keep all three entry points
exactly as they are. Don't spend work promoting the layers, and — more importantly — **don't remove
or narrow them**, because a real external consumer depends on `/grasshopper` resolving values.

### External consumers pin old versions — breakage is deferred, not avoided

Neither external repo tracks the workspace version, so an API break here surfaces on their next bump
rather than in CI:

| Repo                                   | Pin              | Notes                                                |
| -------------------------------------- | ---------------- | ---------------------------------------------------- |
| parafa                                 | `3.1.0` (exact)  | workspace is at `3.1.1`                              |
| parapet `packages/app`                 | `^3.1.0-beta.18` | still a beta                                         |
| parapet `packages/shared`              | `^1.3.1`         | **1.x** — a v3 break is invisible there until bumped |
| parapet `packages/app/src/lib/package` | `^1.5.1`         | third concurrent pin in one repo                     |

Parapet's lockfile resolves both `1.5.0` and `3.1.0-beta.18`, each as `(three@0.184.0)` — it still
installs compute's old `three` peer graph. Worth knowing before assuming the viewer split fully
propagated downstream.

### Other externally-used symbols the in-repo audit missed

A first pass over this monorepo alone marked these as consumer-less. They are not — do not prune:

- `processInput`, `TreeBuilder`, `InputParam`, `InputParamSchema` — parapet's
  [`routes/api/compute/+server.ts`](d:/Coding/parapet/packages/app/src/routes/api/compute/+server.ts)
- `ErrorCodes` — parapet's `lib/server/compute-retry.ts`, which classifies retryable failures on the
  `COMPUTATION_ERROR` mapping; the contract is documented in parapet's `RHINO_COMPUTE_DEBUG.md`
- `DataTree` — parapet `packages/shared/src/types/projects.ts`
- `fetchRhinoCompute` — parafa's
  [`tessellate3dm.server.ts`](d:/Coding/parafa/src/lib/server/solutions/tessellate3dm.server.ts),
  calling the RhinoCommon endpoint `rhino/geometry/mesh/createfrombrep` directly. This is the
  "talk to a compute server myself" case, and it is the **only** raw endpoint string in either
  external repo — everything else goes through `GrasshopperClient`.

### Genuine defects the original plan missed

### Genuine defects the original plan missed

- **Unused dependency.** [`packages/plugin-ui/package.json:34`](../../packages/plugin-ui/package.json#L34)
  declares `"@selvajs/compute": "workspace:^"`, but nothing under `packages/plugin-ui/src` imports it.
- **A comment that warned against exactly what happened.**
  [`src/core/index.ts:60-62`](../../packages/compute/src/core/index.ts#L60-L62) documents
  `decodeBase64ToBinary` as "Exported for `@selvajs/visualization` … a second copy would drift."
  `packages/visualization/src/shared/encoding.ts` now _is_ that second copy. Either re-import from
  compute or drop the claim — but don't leave a comment asserting a dependency that no longer exists.
  Note the function is also marked `@internal` in its own JSDoc while being publicly exported.
- **The example bypasses the public API.**
  [`examples/simple_example.ts`](../../packages/compute/examples/simple_example.ts) imports from the
  relative path `'../src/features/grasshopper'`, so it never exercises the published surface — and it
  breaks under the `src/features/` move below.

### Large files: only two have a real seam

The original plan's central table claimed five files could be split "along seams they already have."
Re-measured, three of those seams don't exist.

| File                                  | Lines | Verdict                                                                                                                                                                         |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/compute-fetch/compute-fetch.ts` | 858   | **Split.** 20+ free functions, zero shared mutable state, already grouped as retry / request / response / timing.                                                               |
| `grasshopper/types.ts`                | 424   | **Split.** Pure type declarations with real `// ===` boundaries at lines 177 and 363.                                                                                           |
| `io/input/input-type-parsers.ts`      | 559   | **Split.** Genuinely `// ===` sectioned at lines 39, 156, 335, 536: transformers / rounding / numeric / registry.                                                               |
| `scheduler/solve-scheduler.ts`        | 1031  | **Do not split.** See below.                                                                                                                                                    |
| `data-tree/data-tree.ts`              | 601   | **Do not split.** 564 of 601 lines are inside `TreeBuilder`; the "free helpers" are `private static` methods, not a seam.                                                       |
| `core/server/compute-server-stats.ts` | 696   | **Do not split.** 15 flat public methods sharing private `fetchWithTimeout`/`buildHeaders`; extracting bodies means threading those helpers through as params — strictly worse. |

**Why the scheduler split is rejected.** The plan described "3 clear responsibilities: queueing,
execution, caching" and a mechanical extraction to `queue.ts` + `cache.ts`. In fact 780 of 1031 lines
are one class, the file contains **no `// ===` section header at all**, and the cache is not a
module — it is 9 private instance fields (`cache`, `cacheBytes`, `cacheHits`, `cacheMisses`,
`cacheEvictions`, plus 5 readonly config fields) mutated by methods that also touch `inFlight`,
`fifoQueue`, and `pendingForLatestWins`.

Extracting it means either designing a real `SolveCache` class — a behaviour-risking redesign of the
most concurrency-sensitive code in the package — or free functions taking `this`, which is worse than
the status quo. The original plan forbade behaviour changes in its own "Out of scope" section, so the
step contradicted itself.

Only the leading declarations (lines 20-200: `SchedulerMode`, `CacheOptions`,
`SolveSchedulerOptions`, `SolveContext`, `SolveResult`, `SolveExecutor`, `CacheKeyExecutor`) are
cleanly separable into `scheduler/types.ts`. Take that; leave the class alone.

**The "no file over ~350 lines" target is dropped.** It was the premise driving all three bad splits.
A 700-line cohesive class is not a defect; a 350-line file that shares mutable state with three
siblings is.

## Migration steps

Each is independently reviewable. Tests move with the code they cover.

1. **Fix the README.** Remove the Three.js install line, the visualization feature bullet, the `three`
   requirement, and the `"Failed to load three.js visualization module"` troubleshooting section.
   Point readers at `@selvajs/visualization` for viewer work. _Highest value; ship first, independently._
2. **Unwrap `src/features/`.** `git mv src/features/grasshopper src/grasshopper`; rewrite
   `@/features/grasshopper/...` → `@/grasshopper/...` across the 17 files. Repoint the tsup entry and
   the `./grasshopper` package.json export. Also fix `examples/simple_example.ts` to import from the
   package name rather than a relative path into `src/`. Path-only, no symbol changes.
   `pnpm type-check`.
3. **Collapse the duplicate barrel.** Work the 15-symbol table above as an explicit decision list:
   trim intended privates from the inner barrel, publish deliberate omissions. `registerDecoder`,
   `disposeRhinoObjects`, and `processInputsWithErrors` are the clearest cut candidates.
   **`extractFilesFromComputeResponse`, `downloadFileData`, and `FileData` must stay** — parafa and
   `packages/ui` depend on them. Then delete `src/grasshopper.ts`.
   **Verification:** build and diff the emitted `dist/grasshopper.d.ts` against the pre-change copy.
   That diff is the real public-API change; it should contain only what you deliberately chose.
   Then grep parafa and parapet for every removed symbol before publishing — neither is in this
   monorepo's CI, and both pin older versions, so nothing here will catch the break for them.
4. **Split `compute-fetch.ts`** → `request.ts` (buildUrl / buildHeaders / generateRequestId /
   isLocalhost) + `response.ts` (handleResponse / throwHttpError / mapServerErrorCode) + `retry.ts`
   (resolveRetryPolicy / backoffDelay / parseRetryAfter / sleep) + `server-timing.ts`
   (parseServerTiming / composeSignal / fireServerTiming), leaving `fetchRhinoCompute` + `attemptFetch`.
5. **Split `types.ts`** → `types/{inputs,outputs,schema,index}.ts`, and **extract
   `scheduler/types.ts`** (declarations only — the class stays). Both keep the public surface
   byte-identical.
6. **Split `input-type-parsers.ts`** along its existing `// ===` sections → `input/transformers.ts` +
   `input/numeric-rounding.ts`, leaving the registry + interface.
7. **Fix the three defects.** Drop the unused `@selvajs/compute` dep from `packages/plugin-ui`;
   resolve the `decodeBase64ToBinary` comment/duplication in
   [`src/core/index.ts`](../../packages/compute/src/core/index.ts#L60-L62); reconcile its `@internal`
   tag with its public export.
8. `pnpm type-check && pnpm lint && pnpm test`, then `pnpm build`. Changeset — step 3 may remove
   exports, so it is breaking on paper.

## Deliberately not doing

- **Scheduler cache/queue extraction, data-tree split, server-stats split** — no seam; would trade
  concurrency-correctness risk for a line count. Rationale above.
- **Converting the 3 `export default`s to named.** `GrasshopperClient`,
  `GrasshopperResponseProcessor`, and `ComputeServerStats` are already re-exported as
  `export { default as X }` at every barrel, so consumers write `import { ComputeServerStats }`.
  No consumer sees `default`; the change is invisible outside the package.
- **Renaming `io/output/response-processors.ts` → `output-values.ts`.** The rationale was a name
  collision with `GrasshopperResponseProcessor` — but `getValues`/`getValue` are not published from
  `/grasshopper` at all, and `getValues` has zero consumers repo-wide. Revisit only if step 3 decides
  to publish them.
- **Promoting `/core` and `/grasshopper` as first-class layers** — not worth new work, but keep all
  three entry points as they are: parapet imports values through `/grasshopper` and `camelcaseKeys`
  through `/core`.
- **Behaviour changes**, `SolveScheduler` semantics (latest-wins / queue / parallel), and anything in
  `@selvajs/visualization`.

## Open question — shrinking the public surface

Out of scope here; recorded because it needs a product call, not a code call.

A first pass over this monorepo alone suggested ~40 `/grasshopper` and ~10 `/core` exports had no
consumer. **Checking the two known external repos cut that list substantially** — `processInput`,
`TreeBuilder`, `InputParam`, `InputParamSchema`, `DataTree`, `ErrorCodes`, `fetchRhinoCompute`, and
`extractFilesFromComputeResponse` all turned out to be load-bearing. That is the lesson: a
single-repo audit systematically overestimates dead surface for a published package.

Still apparently unused everywhere checked: `solveGrasshopperDefinition`, `fetchDefinitionIO`,
`fetchParsedDefinitionIO`, `isDefinitionRef`, `processInputs` (plural — only singular `processInput`
is used), `hashDefinition`, `hashSolveInput`, `getValues`.

Three caveats before pruning any of them:

- `SolveScheduler`'s option/result types are reachable structurally through
  `client.createScheduler(...)` even where never named in an import.
- parafa and parapet are the _known_ consumers; `@selvajs/compute` is on public npm, so even they are
  not the full population.
- The package already removed a subpath once (`/visualization`, still in `CHANGELOG.md`), so external
  users have absorbed breakage recently.

The real question is whether to shrink this surface at all — a decision about external users, not
file layout.
