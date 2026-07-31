# Display pipeline performance — remaining open items

> **Status: ALL IMPLEMENTATION SHIPPED AND VERIFIED (2026-07-31).** P1 + P5 shipped; the browser-side
> verification that was owed is done. **One item remains and it is an observation, not work:** a live
> Rhino check of the encode-cache hit rate, which cannot be performed off-Rhino. P3 was rehomed to
> [features/cloud-binary-transport](../features/cloud-binary-transport.md) — it was an unstarted
> cloud-transport feature, not residue of this plan.
>
> **Retire this plan once the live Rhino check is done** (or once `BatchBlobCache.Stats()` is
> surfaced somewhere that makes the check continuous rather than a one-off — see below).
>
> Full audit + original implementation notes archived at
> [archive/display-pipeline-performance-audit.md](../archive/display-pipeline-performance-audit.md).
>
> Earlier note, still true: the client-side parse files (`batch-parser`, assembly worker,
> `mesh-assembly`, geometry cache, webdisplay) moved to `@selvajs/visualization/parse` on 2026-07-30
> ([visualization-package](../archive/visualization-package.md)) without colliding with this work.

## Shipped 2026-07-31

**P1 — C# half (encode cache).** `ComputeBatch` no longer re-encodes unchanged geometry.
`MeshBatchProcessor.CreateBatch` now hashes the combined vertex/index/UV/color arrays plus the
metadata JSON into a 128-bit `BlobKey` and consults `BatchBlobCache` before writing. On a hit the
quantization pass and the `CompressionLevel.Optimal` DEFLATE are skipped entirely — the code's own
measurement puts that at ~30 ms for a 2.7 MB payload, against a hash that is memory-bandwidth-bound.

The plan asked for a design for _input identity_ and _memory policy_; both were resolved as follows,
and the reasoning lives in the `BatchBlobCache` class doc rather than here:

- **Identity is content, not document state.** The key covers exactly the inputs to
  `BinaryGeometryWriter.Write`, which is a pure function of them. Nothing about the Rhino document is
  consulted, so undo / paste / reload cannot desync the cache — a stale entry becomes unreachable
  rather than wrong. This is deliberately the opposite of the incremental-id approach that failed for
  display collection.
- **Memory is bounded by bytes, not entries** (64 MB, LRU), because one entry can be a few kilobytes
  or many megabytes. Rhino is long-lived and the cache is static, so an unbounded map would be a slow
  leak across a modelling session.
- 128 bits, not 64: a collision would serve the wrong geometry — a silent visual corruption — so the
  width is the usual content-addressing bet rather than a cheap hash.

**P5 (deferred item) — intra-branch parallelism.** A single fat branch no longer merges and scans on
one thread. Two changes, both gated at 200k vertex components so small batches don't pay scheduling
overhead:

- `MeshBatchProcessor.CreateBatch` splits the old merge loop into a cheap serial offset pass (group
  creation and metadata order must stay deterministic) and a parallel copy pass. Every mesh writes a
  disjoint span, so no locking is involved.
- `BinaryGeometryWriter.ComputeBounds` became a partitioned min/max reduction. Exact rather than
  approximate: the bbox becomes the quantization origin/scale, so a partition-order-dependent result
  would make the emitted blob bytes non-deterministic.

Quantize and deflate themselves stay serial by nature — the delta filter is a running predictor and
DEFLATE is a single stream. This was the reachable half of the item.

**Verification.** 326 tests pass (`dotnet test`), including 16 new ones: `BatchBlobCacheTests`
(key identity, null-vs-empty channel distinction, signed zero, tail-element coverage, LRU eviction,
size bounds) and four parallel-bbox tests pinning determinism across repeat runs, extremes planted in
every partition, and the uniform-cloud degenerate case. The parallel merge was additionally checked
against the old serial loop over 300 randomized trials (varying mesh counts, empty meshes, mixed
UV/color presence) — byte-identical in every one. All changed files compile against **net48, net7.0
and net9.0**; `BitConverter.SingleToInt32Bits` is .NET Core only, so the float bit pattern goes
through an explicit-layout union, which also keeps `AllowUnsafeBlocks` off.

The multi-target claim above was only actually verifiable from 2026-07-31: `dotnet build` on the
solution had been failing since the Dependabot bump in `b2997c68`, which raised
`System.Drawing.Common` to 10.0.10 in `Selva.Drawing` alone and left `Selva.GH` / `Selva.Rhino` on
8.0.0, so restore aborted with NU1605 before any of these files were compiled. Aligning the
consumers upward is not an option — on net7.0 the 10.x package duplicates types already in the
framework's `System.Drawing.Primitives` and every `ColorTranslator` use fails with CS0433. The leaf
is pinned back to 8.0.0 with that constraint recorded inline; raising it requires dropping net7.0
(Rhino 8) first. The three plugin TFMs and all 1059 tests now build and pass clean.

## Open

**Nothing on this plan.** P3 (cloud transport binary side-channel) was **rehomed 2026-07-31** to
[features/cloud-binary-transport](../features/cloud-binary-transport.md). It was mis-filed here: every
other item was display-pipeline residue that has now shipped and been verified, while P3 is an
unstarted cloud-transport feature spanning plugin + server + client. Keeping it here meant a finished
plan could never retire — the deferral was correct, the filing was not.

## Verification still owed

- ~~Real-browser check of worker paths, on-demand repaint feel and the AO pass.~~ **DONE
  2026-07-31** — all three verified on a real GPU (`ANGLE / NVIDIA RTX 3060 / D3D11`) via
  `pnpm example` driven with Playwright. See "Browser-side verification" below. The edge half was
  closed the same day and is written up in
  [archive/edge-overlay-performance.md](../archive/edge-overlay-performance.md#gpu-visual-verification-2026-07-31--closes-the-last-open-item);
  that run is what repaired `pnpm example` (the package move had broken it) and moved it to
  `packages/visualization/examples`, which is what made these checks runnable at all.
- **Live Rhino check of the new encode cache** — the one remaining item, and it needs Rhino.
  Confirm hit rates behave on a real definition and that repeated solves plateau rather than growing
  memory. The logic is unit-covered (16 tests); the in-Rhino hit rate is not.

  **`BatchBlobCache.Stats()` has no caller outside its own tests** (verified 2026-07-31) — it
  exposes `(Count, Bytes, Hits, Misses)` and nothing reads it. So a content-addressed cache whose
  failure mode is _serving the wrong geometry_ has never had its hit rate observed on real
  geometry. Surfacing it somewhere (a component menu readout, a debug log on solve) would turn this
  from a manual one-off into something continuously visible — worth considering before doing the
  manual check, since the manual check only ever samples one session.

- ~~`dotnet test` on a net8 runtime~~ — done, the suite runs clean on this machine now (326 passed).
  The earlier note that the test host aborted at CoreCLR launch is no longer accurate.

## Browser-side verification (2026-07-31)

Run against `pnpm example` in headed Chrome on a real GPU (`ANGLE / NVIDIA RTX 3060 / D3D11`).

**1. Assembly worker paths — verified, and this is the half no unit test can reach.** The assembly
worker is a **blob-URL** worker built from `meshAssemblyWorkerSource()`, with a silent sync fallback
(`assemblyWorker = null`, never retried for the session). jsdom has no `Worker`, so **every existing
unit test exercises only the fallback** — whether the real worker constructs and returns correct
geometry was untested until now. In a real browser it constructs, and the `ASSEMBLY_WORKER_MIN_TRIANGLES`
= 50k gate behaves exactly as designed:

| Payload          | Worker messages | Result                                                      |
| ---------------- | --------------- | ----------------------------------------------------------- |
| ~60k tri (6×10k) | **1**           | assembled off-thread, 60,012 verts, normals present, ~50 ms |
| ~12k tri (2×6k)  | **0**           | correctly took the sync path below the gate                 |

**2. Repaint-on-demand — verified.** Idle sits at **4 renders/sec**, not 60 — that is the documented
`IDLE_REPAINT_INTERVAL_MS = 500` safety net for mutations that forget to `invalidate()`, not a
continuous loop. An orbit drag jumps to continuous rendering and it drops straight back to 4 fps when
the drag ends. Measured off `renderer.info.render.frame`, which only advances on a real `render()`.

**3. AO pass — verified.** `createRenderPipeline({ ambientOcclusion: true })` constructs on this GPU,
and `setAmbientOcclusion(true)` visibly darkens the contact crevices between boxes and their floor —
absent in the same frame with AO off. Worth recording: the `technical` look ships
`ambientOcclusion: false`, so AO is **off by default** in the viewer; it is opt-in per look or per
call, which is why a casual look at the demo suggests "AO does nothing".

**Measurement trap, recorded because it cost two wrong readings here.** `renderer.info.render` is
only meaningful **after** a frame has actually rendered. Reading it straight after `invalidate()`
samples the previous frame and shows no change — which reads as "the feature is broken" when it
isn't. Wait for `info.render.frame` to advance before comparing. The same trap made an early edge
reading look like the overlay wasn't drawing.

**Benches survived the package move** (checked, since the `pnpm example` harness had not). Both
`batch-parser.bench.ts` and `edges.bench.ts` run and produce sane numbers. At 1M tri the parse path
splits as: `parseMeshBatchObject` ~163 ms, `computeVertexNormals` ~86 ms, `inflateSync` ~28 ms — decode
dominates, matching the audit's model.
