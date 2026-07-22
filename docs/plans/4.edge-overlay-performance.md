# Edge-overlay performance at high triangle counts — plan

> **Status: IMPLEMENTED (2026-07-22) — Phases 0–3 shipped; Phase 4 (Rhino-authored
> edges) remains an optional separate track.** See "Results" at the bottom for the
> after-benchmarks. Outstanding: GPU-visual verification of the screen-space edge
> pass in a real browser (`pnpm example`) — everything else is unit/bench-covered.
> Scope: `packages/compute` visualization (edges.ts, edge-extract.ts,
> edge-detection-pass.ts, render-pipeline.ts, three-initializer.ts) + the
> `applyEdges`/`clearEdges` wiring in `packages/ui/.../viewer/Viewer.svelte`.

---

## Problem

Edge overlays (`addEdges` in
`packages/compute/src/features/visualization/threejs/edges.ts`) are the default
look — `Viewer.svelte` starts with `edgesVisible = true` on the 'technical'
style. Extraction runs `THREE.EdgesGeometry(geometry, angle)` synchronously on
the main thread. On multi-million-triangle meshes this blocks the UI for
seconds; and because of how the viewer rebuilds the scene, it happens **every
solve**, not once.

### Validated findings (2026-07-21, against three r179 in node_modules)

1. **Extraction is O(triangles) with heavy constant factors.**
   `three/src/geometries/EdgesGeometry.js` builds **three string hash keys per
   triangle** (`` `${Math.round(a.x*1e4)},…` ``) and stores edges in a
   string-keyed object map. For a 5M-triangle mesh that is ~15M template-string
   allocations plus map churn. **Measured (Phase 0): ~200 ms per 100k
   triangles, ~2.9 s per 1M, linear in triangle count and independent of
   shape** — a 5M-triangle mesh blocks the main thread for ~15 s.

2. **The per-geometry cache never hits across solves.** `edges.ts` caches
   extracted line geometry in a `WeakMap` keyed on the source
   `BufferGeometry`. But `updateScene` (`three-helpers.ts:32`) calls
   `clearScene` and re-adds freshly parsed meshes each solve — new
   `BufferGeometry` instances every time. `Viewer.svelte` then re-applies
   edges after every solve while they're visible. So with edges on, **every
   slider drag re-pays full extraction**. The cache only helps repeated
   geometry _within_ one solve (instanced parts).

3. **Rendering cost is driven by surviving segment count, not triangle
   count.** Each `LineSegments2` segment is an instanced screen-space quad,
   and `distanceFade` (default on) sets `transparent = true`, putting all
   overlays in the blended pass. Planar/CAD geometry collapses to few crease
   edges → cheap. Dense organic or badly-welded meshes can keep millions of
   segments → fill-rate pain and ~24 B/segment GPU memory.

4. **Existing infra to build on:** the viewer already has an optional
   `EffectComposer` pipeline (RenderPass → GTAO → SMAA → OutputPass,
   `render-pipeline.ts`) that a screen-space edge pass can slot into.
   `LineSegmentsGeometry.setPositions` consumes a `Float32Array` directly, so
   extraction output is transferable across a worker boundary as-is.

---

## Goals

- Edges-on stays interactive on multi-million-triangle solves: **no
  main-thread stall > ~50 ms** attributable to edge extraction.
- Re-solves don't re-pay extraction for geometry that didn't change.
- A bounded worst case: pathological meshes degrade gracefully (fallback or
  skip), never freeze the tab.
- No packaging regressions: `@selvajs/compute` is a tsup-built library
  consumed by two SvelteKit apps — no bundler-specific worker imports, SSR
  must stay safe.

Non-goal: changing the visual style. The fat-line crease look stays the
default result on the paths that can afford it.

---

## Phase 0 — Measure ✅ (done 2026-07-21)

Benchmarks live in-repo so before/after is reproducible:

- `packages/compute/src/features/visualization/threejs/__tests__/edges.bench.ts`
  — extraction, fat-line buffer build, and the real `addEdges`/`removeEdges`
  toggle path. Fixtures span best/smooth/worst crease survival
  (`tests/helpers/bench-geometry.ts`: planar grid / smooth sphere / box field).
- Mesh-batch _parsing_ was already benched:
  `webdisplay/__tests__/batch-parser.bench.ts`.
- Run with `pnpm bench` in `packages/compute`; `BENCH_HEAVY=1 pnpm bench` adds
  4M-triangle fixtures. Frame-time-with-overlays needs a GPU and stays a
  manual check via `pnpm example`.

### Baseline (2026-07-21, Apple M2, node, three r179, threshold 44°)

| Bench                                        | mean        | notes                                       |
| -------------------------------------------- | ----------- | ------------------------------------------- |
| EdgesGeometry, 100k tri (any shape)          | ~175–215 ms | shape barely matters — cost is per-triangle |
| EdgesGeometry, 1M tri (any shape)            | ~2.7–3.0 s  | **the stall; scales ~linearly**             |
| EdgesGeometry, 100k tri non-indexed soup     | ~187 ms     | welding adds ~5% only                       |
| setPositions, 100k segments                  | ~3 ms       | negligible                                  |
| setPositions, 1M segments                    | ~31 ms      | fine even at worst case                     |
| toggle cycle, 100×5k-tri unique geoms (500k) | ~750 ms     | what every solve pays today                 |
| toggle cycle, 100 meshes sharing one 5k geom | ~10 ms      | cache path is 73× faster                    |

Surviving segments @44°: planar 1M → 2.8k; smooth sphere 1M → 0; box field
1M → ~1M (1 segment per triangle — pathological ceiling).

### What the numbers decide

- Extraction is **~2.9 s per 1M triangles regardless of shape** — finding 1
  confirmed, and the cost is pure per-triangle overhead, not output-driven.
  Phases 1–2 (faster extractor + worker + cross-solve cache) attack exactly
  the right thing; the 73× cache-hit delta shows what a content-keyed cache
  buys per solve.
- `setPositions` and the overlay assembly are **not** worth optimizing
  (31 ms at the 1M-segment ceiling).
- Phase 2's inline-vs-worker threshold: 100k triangles ≈ 200 ms — too slow
  for inline. Start the worker cutoff nearer **~25k triangles (~50 ms)**,
  re-tune after Phase 1 lands.

## Phase 1 — Replace `EdgesGeometry` with a dependency-free extractor

New `extractEdgeSegments(positions: Float32Array, index: Uint32Array | null,
thresholdAngleDeg: number): Float32Array` in
`features/visualization/threejs/edge-extract.ts`:

- Pure function over typed arrays — no `three` import, so it can run
  unchanged inline or in a worker.
- **Numeric edge keys** instead of string hashes: quantize vertex positions
  once into an integer grid (same 1e-4 precision as three, for identical
  welding behavior), dedupe vertices via a `Map<bigint|number, id>`, then key
  edges as `min(id) * 2^32 + max(id)` in a `Map<number, …>` (safe: vertex ids
  stay < 2^26 for realistic meshes; guard and chunk otherwise). This removes
  the string allocation storm — expected ~5–10× on extraction alone.
- Same semantics as `EdgesGeometry`: keep edges where face normals differ by
  more than the threshold, plus boundary (single-face) edges.
- Test: property-compare output against `THREE.EdgesGeometry` on fixture
  meshes (box, sphere, non-indexed soup, degenerate triangles) — same segment
  set modulo ordering.

`acquireEdgeGeometry` switches to this extractor; public API of `edges.ts` is
unchanged.

## Phase 2 — Move extraction off the main thread + cache across solves

1. **Blob-URL worker, bundler-agnostic.** Instantiate the worker from
   `URL.createObjectURL(new Blob([extractorSource]))` where `extractorSource`
   is the stringified pure function from Phase 1 (it has zero imports by
   construction — that constraint exists precisely for this). No
   `new Worker(new URL(...))` — that would tie the library to a bundler.
   Guard `typeof Worker === 'undefined'` (SSR / old environments) → run
   inline synchronously as today.
2. **Async API.** `addEdges` grows an async sibling (or an internal async
   path): meshes get their overlay attached when extraction resolves.
   `position`/`index` arrays are copied once and transferred (the originals
   stay with the render geometry).
3. **Cancellation.** The viewer re-applies edges per solve; a solve can land
   while extraction for the previous one is in flight. Use a generation token
   per `applyEdges` root: results arriving for a stale generation are
   dropped, and orphaned overlays are never attached to removed meshes
   (`mesh.parent === null` check on resolve). `removeEdges` also bumps the
   generation.
4. **Content-keyed cache.** Fix finding 2: key extracted segments by a cheap
   content fingerprint instead of object identity — `(vertexCount, triCount,
thresholdAngle, xxhash of first/last N floats of position array)` — held
   in a small LRU (few entries, segments arrays only). Same input params →
   same meshes → cache hit, zero extraction on re-solve. Identity `WeakMap`
   stays as the fast path within a solve.

Threshold: run inline (sync, no worker round-trip) only below **~25k
triangles** — Phase 0 measured ~200 ms at 100k, so 100k is already far past
the ~50 ms stall budget. Re-tune once Phase 1's faster extractor lands (if it
delivers ~5–10×, the inline cutoff can rise back toward 100–250k).

## Phase 3 — Bounded worst case + screen-space fallback

1. **Caps.** From Phase 0 numbers, pick a segment cap (e.g. 1–2M) and a
   triangle cap. Above the segment cap, drop `distanceFade`'s transparency
   for those overlays (opaque pass, cheaper) or skip the overlay for that
   mesh; above the triangle cap, skip geometry extraction entirely and use
   the fallback below. Always surface the decision (debug log / userData
   flag) — no silent truncation.
2. **Screen-space edge pass** (normal + depth discontinuity, Sobel/Roberts
   cross) as a new optional pass in `render-pipeline.ts`, before SMAA so it
   gets antialiased. O(pixels), independent of triangle count. Used (a) as
   the automatic fallback above the caps and (b) as an explicitly
   configurable style. Constraints validated against the pipeline: composer
   is currently AO-only and default-off — the pass must be constructible
   independently of GTAO, and camera perspective↔ortho swaps must retarget it
   like the existing passes. Known trade-offs (uniform pixel width, no
   per-object color without an ID buffer, view-dependent) are acceptable for
   the fallback role.

## Phase 4 (optional, separate track) — Rhino-authored edges

Rhino knows the true BREP/mesh edges. Have the plugin/Compute ship crease +
naked edge polylines alongside meshes (new display-item type), rendered
through the existing fat-line path with zero client extraction and better
fidelity than tessellation-derived edges. Touches the C# plugin, ui-schema,
and the display-items parser — spec it as its own plan if pursued; Phases 1–3
don't depend on it.

### Assessment (2026-07-22, validated against the C# pipeline)

**Verdict: makes sense as a _fidelity_ feature, not a performance one — and
not via the existing curve display items.** With Phases 1–3 shipped, the
performance case is gone (extraction is off-thread, cached, capped). What
server-authored edges uniquely add:

1. **Smooth/tangent edges a crease filter cannot see.** `GH_WebDisplay` meshes
   Breps itself (`CreateMeshFromBrep`, GH_WebDisplay.cs) — the original
   `Brep` is in hand at meshing time, so `brep.Edges` (trim boundaries, fillet
   seams, tangent joins) are one call away in the existing parallel pass.
   Client crease extraction at 44° can never produce these. This is the "looks
   like Rhino's own wireframe" upgrade.
2. **Exact edges for meshes over the 4M-triangle cap**, where the client now
   falls back to the screen-space approximation.
3. Works offline in `.dmf` exports and in BOTH runtime modes — verified: the
   cloud path parses the same `DisplayBatch` out of the compute response
   (`getThreeMeshesFromComputeResponse` → `extractDisplayFromData`), so one C#
   implementation serves local + cloud.

**Wrong transport, though:** existing `DisplayCurve` items ship one
NURBS-JSON per curve, need rhino3dm WASM to decode, and tessellate
adaptively — fine for a handful of annotation curves, pathological for
thousands of BREP edges. Ship edges instead as an **optional per-mesh channel
in the binary mesh blob** (a `FLAG_HAS_EDGES` alongside the existing
UV/vertex-color channel gates in `BinaryGeometryWriter`, version bump v3→v4):
flat polyline/segment floats, delta+deflate like everything else, feeding
`LineSegmentsGeometry.setPositions` directly — no rhino3dm, no tessellation.
Per-mesh association keeps the client's toggle, per-surface color derivation,
and distance fade working unchanged; meshes carrying server edges skip
`addEdges` extraction.

**Costs to accept:** solve-path CPU in the plugin (mesh `TopologyEdges` /
`GetNakedEdges` for mesh inputs; near-free for Breps), payload growth (small
for CAD-ish geometry — the segment count is what survives creasing anyway),
binary-format version bump + reader/writer + schema/codegen churn across
net48/net7/net9, and an opt-in gate on the component so definitions that
don't want it pay nothing. Scope is comparable to the UV/vertex-color channel
work — a real feature, its own plan.

**Recommendation:** keep deferred until the Phase 3 GPU-visual check is done;
when picked up, do it as the binary-blob channel above, opt-in per component,
Brep-edge-only first (mesh-input crease extraction can come later — client
extraction already covers meshes well).

---

## Test strategy

- Phase 1: equivalence tests vs `THREE.EdgesGeometry` (existing
  `__tests__/edges.test.ts` patterns), degenerate-input fuzz.
- Phase 2: worker path unit-tested via the sync fallback (jsdom has no
  Worker); cancellation tested with interleaved apply/clear sequences on
  generation tokens.
- Phase 3: pass wiring smoke tests mirroring `render-pipeline` tests; cap
  behavior asserted on synthetic dense meshes.
- Phase 0 bench numbers re-run after each phase; record before/after in this
  file.

## Risks / open questions

- **Stringified-function worker** breaks under aggressive minification if the
  extractor closes over anything — enforced by keeping it a single exported
  top-level function with zero captures (lint rule or test that
  `extractorSource` contains no import/require).
- CSP `worker-src blob:` may be blocked on some deployments → sync fallback
  path must stay correct, and the cap from Phase 3 then still bounds the
  stall.
- Fingerprint collisions in the Phase 2 cache would show stale edges: hash
  enough of the array (first/last 4k floats + length) that collisions are
  practically impossible for real solves; a full-array hash is still ~ms and
  acceptable if paranoia wins.
- If Phase 0 shows Phase 1 alone gets 5M triangles under ~150 ms, Phase 2's
  worker can be demoted to "only above 1M triangles" or dropped — decide on
  data, not vibes.

---

## Results (implemented 2026-07-22)

### What shipped, and where it deviates from the design above

- **Phase 1** — `edge-extract.ts`: `extractEdgeSegments` is exactly the planned
  pure function, with two refinements. Vertex welding uses an open-addressed
  Int32 hash table with exact-coordinate comparison (no `bigint`, no collision
  risk) instead of a `Map`; edge keys pack the two _welded vertex ids_ as
  `id₀·2²⁶ + id₁` (float64-exact; ≥2²⁶ vertices throws and callers fall back to
  `THREE.EdgesGeometry`). Equivalence with `EdgesGeometry` is tested exactly —
  same segment sets on box/sphere/torus/cylinder/soup/degenerate fixtures at
  1°/44°/89°, including the "edge shared by 3 faces re-registers" quirk.
- **Phase 2** — all four items as designed: blob-URL worker built from
  `Function.prototype.toString` (`edgeExtractWorkerSource`, with a test that
  evals it against a stub `self` to catch stray captures), `addEdgesAsync` with
  per-root generation tokens (bumped by `removeEdges`) plus
  connected-to-root/already-has-overlay checks on resolve, in-flight dedupe,
  and a content-keyed LRU (FNV-1a over head+tail 4k words of positions+index,
  128 MB byte budget). Inline cutoff: 25k triangles. Worker crash → inline
  fallback + worker permanently disabled for the session.
- **Phase 3** — caps as designed (`maxTriangles` default 4M → skip + tag
  `userData.edgesSkipped='triangle-cap'` + debug log; `maxSegments` default 2M
  → overlay keeps rendering but drops the fade → opaque pass).
  `EdgeDetectionPass` (edge-detection-pass.ts) does Roberts-cross on
  depth (relative view-Z) + normals via a `MeshNormalMaterial` override pass
  (the GTAOPass pattern), sits before SMAA, is always constructed
  (lazy render target) and toggled live via `RenderPipeline.setEdgeDetection`;
  the pipeline can now be built without GTAO (`ambientOcclusion: false`).
  `three-initializer` auto-enables the pass when a solve leaves capped meshes
  in the scene and stands it down when they're gone or edges are cleared
  (`EdgesConfig.screenSpaceFallback`, default on). The viewer toggles off via
  the new `clearEdges` (bare `removeEdges` would leave the fallback running).
- **Viewer flow**: `applyEdges` now returns immediately; overlays for meshes
  ≥25k triangles attach a beat later when the worker answers. Re-solves with
  unchanged geometry hit the content cache and attach synchronously.

### After-benchmarks (2026-07-22, same M2/node/three r179; `pnpm bench`)

| Bench                                        | before      | after      | Δ                                 |
| -------------------------------------------- | ----------- | ---------- | --------------------------------- |
| extraction, 100k tri (any shape)             | ~175–230 ms | ~28–45 ms  | ~5–6×                             |
| extraction, 1M tri (any shape)               | ~2.5–3.6 s  | ~0.6–0.7 s | ~4–5×                             |
| toggle cycle, 100×5k-tri unique geoms (500k) | ~750 ms     | ~12–15 ms  | ~50× (content cache)              |
| toggle cycle, 100 meshes sharing one geom    | ~10 ms      | ~0.5 ms    | ~20×                              |
| setPositions 1M segments                     | ~31 ms      | ~31 ms     | unchanged (was never the problem) |

Interpretation against the goals:

- The ~50 ms stall budget holds: <25k-triangle meshes extract inline in
  ~10 ms; everything bigger extracts in the worker, so main-thread cost is a
  buffer copy. The raw extractor at 1M tri (~0.6 s) only matters _inside the
  worker_ now.
- Re-solves with unchanged geometry are ~free (content cache) — the "every
  slider drag re-pays extraction" finding is closed.
- The 4–5× at 1M tri is below the hoped 5–10×: the remaining cost is Map churn
  in edge pairing, not string hashing. An open-addressed edge table could take
  it further, but with the worker + cache in place the main thread no longer
  cares — not worth the complexity now.
- Inline cutoff stays at 25k triangles (~10 ms inline). It could rise to
  ~100k (~35 ms) per the re-tune note; kept conservative since the async
  attach is invisible anyway.

### Follow-ups

- Visual check of `EdgeDetectionPass` on a GPU (`pnpm example`), including the
  perspective↔ortho toggle and threshold tuning against real solves.
- Phase 4 (Rhino-authored edges) unchanged — still the fidelity ceiling, still
  a separate track.
