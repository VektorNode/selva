# CONTEXT

Domain vocabulary for `@selvajs/compute`. These are the names we use for the
concepts and seams in the codebase. Keep them consistent: when a module is
named after a concept, it should be the concept named here.

## Core concepts

- **Definition**: a Grasshopper `.gh` file, identified by a URL (pointer) or
  supplied as base64/binary. The thing we solve.
- **Solve**: sending a definition + inputs to Rhino Compute and getting back
  computed values. The central operation.
- **Data tree**: Grasshopper's hierarchical value structure (branch paths like
  `{0}`, `{0;1}`, or the root `{}`). The exchange format for inputs and outputs.
  The branch-path shape has one canonical home: `TREE_PATH_RE` and the
  `isDataTreeDefault` membership test in `data-tree/tree-path.ts`. Anything asking
  "is this a tree-shaped default?" (the input-type parsers and `TreeBuilder`)
  imports that predicate rather than re-inlining the regex.
- **IO**: the inputs and outputs a definition declares. `getIO` fetches them.
- **Input param**: one declared input of a definition, parsed into a typed
  shape (`NumericInputType`, `TextInputType`, …). The union is `InputParam`.
- **Transport**: the HTTP layer talking to a compute server (`fetchCompute`).
  Owns retries, backoff, timeout/abort composition, and HTTP-to-error-code mapping.
  Response-type-agnostic: it takes an endpoint string and a `ComputeConfig` and
  returns a caller-supplied response type (`fetchCompute<R>`). It does not
  know which response a given endpoint produces: each endpoint caller names its
  own response type. This keeps the dependency arrow pointing feature to core, so
  a second endpoint family can be added without `core` importing any feature.

  **`core/` is backend-agnostic: it names no Rhino concept.** Everything
  backend-specific arrives from the caller through three seams, and adding a
  fourth belongs here rather than inlined in core:

  - `ComputeConfig.apiKeyHeader`: the auth header's NAME (default
    `RhinoComputeKey`). Note the key still merges over `config.headers`, so a
    caller can't clobber whichever header actually carries it.
  - `ComputeConfig.serverErrorCodes`: this backend's machine wire codes mapped to
    our `ErrorCodes`, outranking the status-based mapping. Grasshopper's table is
    `GRASSHOPPER_SERVER_ERROR_CODES` in `grasshopper/solve.ts`, applied at both
    GH fetch sites via `withGrasshopperErrorCodes`.
  - `validateServerUrl(url, { blockedHosts })`: the shared public endpoint a
    caller must not point at. Defaults to `compute.rhino3d.com`.

  `ComputeServerStats` is NOT transport: it probes rhino.compute's control plane
  (`/activechildren`, `/plugins/gh/installed`, `/idlespan`), so it ships from
  `/grasshopper`. Conversely `DefinitionRef`/`SolveDefinition` are pure
  bytes-or-lazy-byte-ref with nothing Grasshopper in them, and sit in the solve
  port's own signature, so they live in `/core`, and a second backend's author
  never has to import them from the Grasshopper subpath.

- **Scheduler**: orchestrates solves over time (latest-wins / queue / parallel),
  with cancellation, retries, caching, and an observable state surface.
- **Server definition-cache reuse**: a large (base64/binary) definition is
  uploaded once; the server returns its `md5_…` cache key as the response
  `pointer`, and `GrasshopperDefinition.FromUrl` resolves a cache key as a
  pointer. The scheduler learns that key (keyed by `hashDefinition`, the
  definition-only identity) and sends `pointer: cacheKey` on later solves of the
  same definition instead of re-sending the payload: decisive for multi-MB
  definitions on a live UI. On a server cache miss (`Unable to load grasshopper
definition`) the `solveByCacheKey` primitive transparently falls back to a full
  upload and captures the refreshed key. Distinct from both the client response
  cache (Scheduler, keyed on definition+inputs) and the server `cachesolve`
  results cache (keyed on the full request body). Off unless a `CacheKeyExecutor`
  is wired (the client wires one); `reuseServerDefinitionCache: false` opts out.
- **Response processor**: reads computed values out of a solve response tree.
- **Decoder**: turns a typed value (system type or Rhino geometry) into a JS
  value. Rhino geometry decoding uses a registry (`registerDecoder`).
- **Mesh batch**: the binary (SLVA) payload carrying display meshes, parsed by
  the webdisplay layer into three.js meshes. Two entry points decode it,
  `parseMeshBatchObject` (parsed `MeshBatch`) and `parseMeshBatchBlob` (raw binary
  frame), and both share the one public options type `MeshBatchParsingOptions`
  (`mergeByMaterial` / `applyTransforms` / `debug`).
  Telemetry timings and the envelope `fallback` merge are private to the build
  step (`BuildOptions`), never on a caller-facing surface.

## Seams

- **Input-type parser**: the per-param-type adapter that turns one raw input
  schema into one typed `InputParam`. One parser owns everything about its type:
  value coercion, type-specific fields (e.g. numeric step size), and its own
  safe fallback when input is bad. Registered by `paramType`. This is the seam;
  the registry of parsers is where new param types plug in.

  Pipeline order: a **shared** `normalizeDefault` step flattens the raw
  `innerTree` default (flat-vs-tree decided by `treeAccess` / `atMost`,
  independent of type) and runs _before_ type dispatch. Then the parser for the
  canonical type produces the typed param. Parse failure is caught at the
  registry boundary and paired with the parser's own fallback param.

## Invariants that cost something to learn

Each of these was a bug once; the rule is what survives, not the incident.

- **One predicate answers "is this a tree-shaped default?"**: `isDataTreeDefault` / `TREE_PATH_RE`
  in `data-tree/tree-path.ts`, accepting the root path `{}`. The input parsers and `TreeBuilder`
  both import it, so they agree by construction. Three forked regexes here once classified the same
  value differently.
- **A tree-access input keeps its `DataTreeDefault`.** For `treeAccess: true` or `atMost > 1`,
  `normalizeDefault` leaves the default as an object keyed by branch path, and scalar parsers pass
  it through untouched. Coercing it collapses a tree-access slider's default to `undefined`.
- **A binary definition is keyed on its full content**, `u8:<len>:<hash>` over `fnv1aBytes`. Keying
  on length alone silently serves one `.gh` file's cached solve for another of equal length. This
  is the definition's identity: correctness outranks the linear byte pass. Distinct from
  `stableStringify`'s deliberate sampling of a `Uint8Array` found _inside_ a dataTree.
- **`serverUrl` is validated in exactly one place**: `validateServerUrl` in
  `core/server/validate-server-url.ts` (non-empty, scheme, parseable, not the public endpoint,
  strip trailing slash). Both `GrasshopperClient` and the standalone-constructible
  `ComputeServerStats` delegate to it.
- **Every scheduler settle path goes through `settleError` / `settleSuccess`.** A solve promise can
  settle from four concurrent sources (executor resolve, executor reject, `supersede`, `cancelAll`)
  and JS silently ignores the second one, so the settle-once flag is load-bearing: without it a
  late executor success clobbers `_lastResult`/`_lastError` after a cancel. A fifth path that
  hand-rolls the guard will forget it.
- **The webdisplay orchestrator owns unit-to-scale.** It is the only thing that sees `modelunits`, so
  the `parseMeshBatch*` functions always emit identity-scaled meshes. A `scaleFactor` knob in both
  places double-scales.
- **`decodeBase64ToBinary`'s view is already correctly bounded.** Re-wrapping it as
  `new Uint8Array(bytes.buffer)` discards `byteOffset`/`byteLength` and exposes the whole pooled
  backing buffer as content.
- **`fetchRemoteFiles` swallows per-file failures on purpose.** One dead URL degrades, it never
  aborts the batch.

## Display-pipeline performance

Paths below are in `@selvajs/visualization` (`packages/visualization/src/`), not
this package. The concepts (these outlive whatever plan doc introduced them):

- **No cross-solve caching.** The viewer rebuilds the scene every solve and the
  scene owns every geometry and texture it holds, so `clearScene` disposes them
  unconditionally. Geometry, texture and edge-segment caches were removed once
  measurement showed they were unproven and cost more maintenance than they
  saved; add one back only with a benchmark to justify it.
- **Assembly worker** (`webdisplay/mesh-assembly.ts`): delta-decode,
  dequantize, merge, and vertex normals as a single zero-capture pure function,
  run in a blob-URL Worker for batches ≥ 50k triangles. Buffer equivalence with
  the sync path is pinned by `mesh-assembly.test.ts`.
- **Edge worker** (`render/edge-extract.ts`, `render/edges.ts`): crease-edge
  extraction offloaded to a worker, with an in-flight map so meshes with
  identical content share one round-trip, plus triangle/segment caps and a
  screen-space fallback pass (`render/edge-detection-pass.ts`).
- **On-demand render loop** (`render/scene-setup/init-three.ts`): draws only on
  invalidate()/camera motion/pointer input, with a 500 ms safety repaint;
  `render.onDemand: false` restores the continuous loop.

**Benchmarks are the durable measurement instrument**, not any doc:
`pnpm bench` runs `edges.bench.ts` and `batch-parser.bench.ts` (1M-triangle
fixtures from `tests/helpers/bench-geometry.ts` / `mesh-batch-builder.ts`;
`BENCH_HEAVY=1` adds 4M). Re-run before/after touching these paths.

Reference numbers (Apple M2, node, three r179, 2026-07-22; rerun locally
rather than trusting these):

| Path (1M triangles)                    | before      | after                                                  |
| -------------------------------------- | ----------- | ------------------------------------------------------ |
| edge extraction (main thread)          | ~2.9 s      | ~0 ms (worker; ~0.65 s inside)                         |
| edges toggle, 100×5k-tri unique meshes | ~750 ms     | ~13 ms (segment cache)                                 |
| batch parse, unchanged re-solve        | ~150–170 ms | ~80 ms node / ~cache-hit + no GPU re-upload in browser |
| batch parse, changed content (browser) | ~150–170 ms | ~20–30 ms main thread, rest in worker                  |
| idle rendering                         | every frame | ~2 fps safety repaints                                 |

Not yet measured: real-browser end-to-end (GPU upload, worker latency,
repaint feel), and the C# encode-side changes (no net8 runtime on the dev
machine, run `dotnet test` + profile in Rhino).

## Known follow-ups

- **Server-side re-encode of unchanged inputs**: the plugin re-meshes/welds/
  quantizes/deflates every input per solve even when only one changed.
  Client-side caches absorb the client half; pick this up only if profiling
  shows encode time significant vs. solve time on large scenes.
- **Cloud transport base64**: `WebDisplayGoo.ToComputeJson` inlines the
  geometry blob as base64 in the values JSON (~33% inflation + transient
  strings). Local WS mode is binary and unaffected. Revisit when cloud
  deployments carry heavy geometry; needs a protocol change (side-channel the
  blob).
- **Fat-branch encode parallelism**: encode parallelism is per-branch, so one
  giant branch quantizes+deflates serially in its background task. Low
  priority; only shows up as delayed result arrival on single-branch
  definitions with many MB of geometry.
