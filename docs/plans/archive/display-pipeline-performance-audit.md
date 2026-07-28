# Display pipeline performance audit

> **Status: MOSTLY IMPLEMENTED (2026-07-22, same day as the audit).**
> Shipped: P1-client (cross-solve geometry cache), P2 (assembly worker),
> P4 (on-demand rendering), P5 (all C# constant-factor items except the
> per-branch parallelism restructure), P6. **Open: P1-C# (skip re-encode of
> unchanged inputs in the plugin), P3 (cloud transport binary side-channel),
> and P5's fat-branch parallelism** — each is a design effort of its own; see
> "Implementation status" at the bottom. Companion to
> `edge-overlay-performance.md` (edges were the first symptom of the themes
> below; that plan's Phases 1–3 are shipped and excluded here).
> Benchmarks: `packages/compute` `pnpm bench` — `batch-parser.bench.ts` gained a
> 1M-triangle "xheavy" workload plus isolated `computeVertexNormals` /
> `inflateSync` benches for this audit. C# findings were verified against the
> actual sources (file:line refs below).
> **Durable home:** the concepts, reference numbers, and open follow-ups are
> recorded in `packages/compute/CONTEXT.md` ("Display-pipeline performance") —
> when this plan is archived, that section and the in-repo benches remain the
> source of truth.

The pipeline, end to end:

```
GH solve → mesh/weld/quantize/deflate (C#, parallel task)
  → transport (local: binary WS frames | cloud: base64-in-JSON compute response)
  → client parse (inflate → delta-decode → dequantize → merge → computeVertexNormals)
  → updateScene (dispose everything, re-add everything, GPU re-upload)
  → per-frame render loop (+ optional AO composer)
```

**The one structural theme: both ends recompute _everything_ on every solve,
even for geometry that didn't change.** Every other finding is either a symptom
of that or an isolated constant-factor cost. The edges work already proved the
fix pattern (content-keyed caching made re-solves ~free); the same idea applies
one level up.

---

## Measured client costs (Apple M2, node, 1M tri / 1M verts, 500 meshes)

| Stage (all main-thread today)                | mean              |
| -------------------------------------------- | ----------------- |
| `parseBinaryMeshBatch` decode (delta+views)  | ~70 ms            |
| full `parseMeshBatchObject` (merged)         | ~150–170 ms       |
| — of which `computeVertexNormals`            | ~63 ms            |
| `inflateSync` of the deflated blob (SLVZ)    | ~15–25 ms         |
| edge extraction (post-plan-4: worker/cached) | ~0 ms main-thread |

So a heavy solve costs the main thread ~150–200 ms of parse before the GPU
upload even starts — every solve, scaling linearly. Not the multi-second cliff
edges were, but it's the remaining per-solve jank source.

---

## Ranked findings

### P1 — No cross-solve reuse of unchanged meshes (both ends)

- **Client:** `updateScene` (`three-helpers.ts:32`) calls `clearScene`, which
  disposes every geometry/material and re-adds fresh ones; every solve re-pays
  parse + normals + GPU upload for _all_ meshes even when one slider changed
  one part. The edges content-cache (plan 4 Phase 2) shows the fix shape: a
  content fingerprint over the decoded buffers → reuse the existing
  `BufferGeometry` (GPU buffers included) for unchanged meshes.
- **C# (subagent-verified):** `ComputeBatch` re-meshes, re-welds, re-quantizes
  and re-deflates all geometry per solve; no mesh- or blob-level cache keyed on
  input identity. `DmfFile` caches finished blobs but isn't wired into the
  solve. Per-mesh preview materials (`MaterialBestGuess`/`ToMaterial`,
  `GH_WebDisplay.cs:245-266`) are cached only within a single `SolveInstance`.

**This is the highest-leverage change on both sides.** For the classic
parametric case (one input moves, most geometry static) it converts ~all of
the pipeline cost into cache hits.

### P2 — The whole client parse runs on the main thread

`parseMeshBatchObject` is already async-shaped, with a comment saying it stays
`async` "so callers don't have to change shape if we move parsing into a worker
later" (`batch-parser.ts:68-70`) — the seam exists, nothing uses it. ~150–200 ms
of blocking work per heavy solve (decode + dequantize + merge + normals +
inflate). The edges worker (blob-URL, zero-capture function) is a working
template; geometry buffers are transferable. Moving parse off-thread turns
solve arrival into a copy + `BufferGeometry` assembly.

Includes two sub-items that vanish with the move (not worth fixing separately):
`computeVertexNormals` (~63 ms/1M tri, `batch-parser.ts:592,663`) and
`inflateSync` (~20 ms; `DecompressionStream` would be the native-async
alternative if ever needed on-thread).

### P3 — Cloud transport base64s the geometry into JSON

Local mode is already right: raw binary WS frames, envelope carries only a
count (`WebSocketTransport.cs:241-279`, client `parseMeshBatchBlob`). But the
Rhino.Compute/cloud path serializes `DisplayBatch.CompressedData` (a `byte[]`)
through Newtonsoft as **base64 inside the values JSON**
(`WebDisplayGoo.ToComputeJson`, `WebDisplayGoo.cs:303`; same on `.gh`
persistence writes) — ~33% wire inflation, a full transient string of the
payload on both ends, plus client-side `JSON.parse` of a huge string and
base64 decode. Known/by-design ("Travels as base64 inside the values JSON for
now", `DisplayBatch.cs:30-33`) — but for cloud deployments it's the largest
transport-side waste. Fix direction: side-channel the blob (multipart/binary
part or separate fetch) rather than inlining it.

### P4 — Always-on render loop

`animate` (`three-initializer.ts:1070-1111`) renders every rAF regardless of
change; with AO enabled that's GTAO + SMAA + (now) the optional edge pass per
frame while idle. An on-demand dirty flag (render on: controls change, solve,
resize, toggle, damping-active) is the standard viewer fix — battery/thermals
and it frees GPU headroom on weak devices. Orthogonal to solve latency.

### P5 — C# constant-factor items (subagent findings, verified refs)

- **Batch-wide color fill:** one mesh with vertex colors makes the _whole
  batch_ carry a colors channel, filled byte-by-byte with white
  (`MeshBatchProcessor.cs:180-184`) — payload + CPU inflation triggered by a
  single colored mesh.
- **`Console.WriteLine` per ngon face** inside the parallel extraction loop
  (`GeoMeshProcessor.cs:114`) — pathological if ngon meshes arrive.
- **Per-mesh material-key string** (`MaterialCache.cs:53-54`,
  interpolated string + `ToString("F3")`×3 per mesh) and
  **`ThreeMaterialGoo.Duplicate` via full JSON round-trip**
  (`ThreeMaterialGoo.cs:43-44`) — GH duplicates goos liberally during solves.
- **Parallelism is per-branch** (`GH_WebDisplay.cs:610-626`): a single fat
  branch quantizes + runs its `CompressionLevel.Optimal` deflate serially in
  one task (~30 ms per 2.7 MB, by the code's own comment).
- **BlobCompressor double-copy:** compressed stream is `ToArray()`d, then
  copied _again_ into a second stream just to prepend the 8-byte SLVZ header
  (`BlobCompressor.cs:85-101`).

### P6 — Client micro-costs (measured, small)

- Per-index `assertIndexInWindow` function call in the merge/rebase loops
  (`batch-parser.ts:573-577,645-648`) — millions of calls, but folded inside
  the measured 150 ms; hoisting to a window-range check per mesh is easy if
  P2 doesn't land first.
- Materials rebuilt per solve (`createMaterial` per material per solve) —
  three's program cache absorbs the shader cost; negligible next to P1.

---

## What is already good (don't churn)

- The binary wire format: int16 quantization + delta + zigzag + deflate,
  zero-copy typed-array views on decode, alignment-aware fallbacks.
- Local transport: binary WS frames, no base64, ring buffer for early frames.
- C# hot path: per-vertex work off the solver thread, `ArrayPool` buffers,
  `Span.CopyTo` bulk copies, weld/normals/compact exactly once per mesh,
  material dedup before serialization.
- Edges: worker + content cache + caps (plan 4).

## Suggested order of attack

1. **P1 client half** — content-keyed `BufferGeometry` reuse across solves
   (fingerprint the decoded buffers like the edge cache; skip dispose+rebuild
   for hits). Biggest UX win, no format changes, pure TS.
2. **P2** — move parse into the existing worker pattern (the API seam is
   already async).
3. **P1 C# half** — skip re-encode of unchanged inputs (hash of mesh +
   material per item → reuse last blob slice), which also fixes P5's fat-branch
   serialization for static geometry.
4. **P3** when cloud traffic matters; **P4** as standalone polish; **P5/P6**
   opportunistically.

---

## Implementation status (2026-07-22)

### Shipped

- **P1 client — cross-solve geometry cache.**
  `webdisplay/geometry-cache.ts`: content-fingerprinted `BufferGeometry` LRU
  (256 MB budget). `createMergedMesh`/`createIndividualMeshes` key each
  geometry by sampled hashes of the exact buffer windows it's built from; a
  hit returns the same `BufferGeometry` object — merge copies, normals, and
  the GPU upload all skipped. `clearScene` skips disposing cache-owned
  geometries (`CACHED_GEOMETRY_USERDATA_FLAG` in three-helpers); the cache
  disposes on eviction instead (three re-uploads transparently if an evicted
  geometry is still on screen). Tests: `geometry-cache.test.ts`.
- **P2 — mesh-assembly worker.** `webdisplay/mesh-assembly.ts`:
  `assembleGeometries` is a zero-capture pure function (edge-extract pattern)
  doing delta-decode → dequantize → window merge/rebase → vertex normals →
  cache fingerprint; `binary-parser.ts` gained `parseBinaryMeshBatchRaw` (wire
  values, undecoded) and `parseBinaryMeshBatch` became a thin decode wrapper
  over it. `batch-parser.ts` routes batches ≥ 50k triangles through a blob-URL
  worker (`tryBuildViaWorker`) and falls back to the unchanged sync path on
  no-Worker/SSR, small batches, or worker crash. Worker keys are pinned
  byte-identical to the sync path's (`mesh-assembly.test.ts` asserts shared
  cache entries), so worker results reuse cached geometries and vice versa.
- **P4 — on-demand rendering.** The loop still ticks every rAF but only
  _draws_ when: `invalidate()` was called (all viewer setters, solve arrival
  via `Viewer.svelte`, async edge attach), the active camera moved (world +
  projection matrix compare — catches damping, presets, gizmo snaps,
  near-plane refits), pointer/wheel input hit the canvas, or the 500 ms safety
  repaint elapsed. `render.onDemand: false` restores the legacy loop;
  `initThree` now returns `invalidate()` for hosts that mutate the scene
  directly.
- **P5 — C# constant factors** (all except fat-branch parallelism):
  ngon warning now counted and logged once per mesh (GeoMeshProcessor);
  batch-wide white color fill via `Span.Fill` (MeshBatchProcessor);
  `MaterialCache` key is an allocation-free `readonly struct` (same F3
  rounding semantics as the old string); `ThreeMaterialGoo.Duplicate` is a
  memberwise copy instead of a Newtonsoft round-trip; `BlobCompressor` writes
  the SLVZ header up front and deflates into the same stream (one full
  compressed-payload copy removed).
- **P6** — per-index window asserts inlined into the copy loops.

### Measured after (same M2/node bench; browser adds the worker win on top)

Full parse path at 1M tri, repeated solves with unchanged content:
**~150–170 ms → ~80 ms** in node (geometry-cache hits skip merge+normals;
node has no Worker, so decode still runs on-thread there). In a browser the
worker takes everything above 50k triangles off the main thread, leaving
inflate + header parse + buffer wrapping (~20–30 ms at 1M tri); cache hits
additionally skip the GPU re-upload. Idle GPU work drops from every-frame to
~2 fps worth of safety repaints.

### Verification notes

- TS: 877 tests green (incl. new geometry-cache, mesh-assembly equivalence,
  worker-source eval suites); `tsc`/`svelte-check`/eslint clean.
- C#: `dotnet build` clean (0 errors) across all targets. The .NET test suite
  targets net8.0 and this machine only has the .NET 10 runtime, so
  `dotnet test` could not execute here — BlobCompressor's wire-format
  assertions were checked by inspection (header layout and keep-original
  threshold are unchanged). Run `dotnet test` on a machine with a net8
  runtime before release.
- Real-browser check still owed (same as plan 4's): worker paths, on-demand
  repaint feel (measure tool, gizmo, label overlays), and AO/edge passes.

### Still open (each its own effort)

1. **P1 C# half** — skip re-mesh/weld/quantize/deflate for unchanged inputs
   in `ComputeBatch` (hash mesh + material per item → reuse the previous
   blob). Needs a design for input identity + memory policy inside Rhino.
2. **P3** — cloud transport: move the blob out of the values JSON
   (multipart/side-channel) to kill the base64 inflation. Protocol change
   across plugin + server + client.
3. **P5 (deferred item)** — intra-branch parallelism so a single fat branch
   doesn't quantize+deflate serially.
