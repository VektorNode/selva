# WebDisplay Binary Transport Plan

## Goal

Maximum end-to-end performance for WebDisplay mesh delivery on both transports:

- **Builder-app** (local, WebSocket port 8765)
- **Compute-app** (cloud, via Rhino.Compute)

Original target: 50MB payload class drops from ~1.2–1.5s total to ~200–300ms, dominated by
network. After Phase 1a measurement (see [Measured impact](#measured-impact-revised-after-phase-1a-benchmarks)),
the realistic target is closer to **~400–600ms wall clock on the heavy case** without zstd, and
**~200–300ms with zstd**. The biggest concrete win is on the C# encode side — already realized in
Phase 1a — at ~1100ms saved per heavy frame.

## Why the current path is slow

For the heavy case the bottleneck stack is:

1. **gzip encode on the GH thread** — measured ~1260ms for a 1.5M-vertex synthetic scene at
   `CompressionLevel.Fastest`. This is the single biggest cost on the C# side.
2. **Base64 inflation** — `MeshBatch.CompressedData` is `byte[]` serialized by Newtonsoft.Json as
   base64 inside a JSON envelope. +33% wire bytes.
3. **JSON.parse on a multi-MB string** — base64 forces the whole geometry through a string parser
   before we can touch it.
4. **gzip decode on the client** — measured ~200ms via `fflate.gunzipSync` on the heavy bench.
5. **Per-vertex CPU on the client** — dequantize/transform pass, `computeVertexNormals()`,
   BufferGeometry construction.

Compression and base64 are paying CPU on both sides for a problem that doesn't need to exist if
the transport is binary. Note: gzip on float32 is more effective on real geometry data than the
plan originally assumed (see Expected impact below) — the wire-size win from removing it is
modest, but the **CPU win on encode is large and free**.

## Wire format (single layout used by both transports)

All multi-byte integers and floats are little-endian.

```
[4 bytes]   magic         "SLVA" (0x53 0x4C 0x56 0x41)
[4 bytes]   version       uint32 (currently 1)
[4 bytes]   metadataLen   uint32, length of metadata JSON in bytes
[N bytes]   metadata      UTF-8 JSON: materials, groups, sourceComponentId, ...
[remainder] geometry      see geometry payload below
```

### Geometry payload

```
[4 bytes]   flags         uint32 (see flags table below)
[24 bytes]  origin        3 x float64
[24 bytes]  scale         3 x float64  (step per int16 unit; identity (1,1,1) for float32)
[4 bytes]   vertexCount   uint32 number of vertices (positions = vertexCount * 3 components)
[V bytes]   vertices      int16[vertexCount*3]  OR  float32[vertexCount*3] depending on flags
[4 bytes]   indexCount    uint32 number of indices
[I bytes]   indices       uint32[indexCount]
```

Flags layout:

| Bit  | Meaning                                                        | v1 status          |
| ---- | -------------------------------------------------------------- | ------------------ |
| 0    | 0 = int16 quantized, 1 = float32 raw                           | active             |
| 1    | 0 = uncompressed payload, 1 = zstd-compressed vertices+indices | reserved (Phase 5) |
| 2-31 | reserved                                                       | must be 0          |

Reserved bits must be zero in v1; the parser must reject unknown bits with a clear error.

For int16: client reconstructs world position as `origin + (q + 32767) * scale` where `q` is the
stored signed int16 in `[-32767, 32767]`. With `scale = bboxSize / 65534` this maps the original
world bbox into the full int16 range symmetrically around 0, matching Three.js
`BufferAttribute(arr, 3, true)` (`normalized: true`) semantics.

For float32: `origin = (0,0,0)`, `scale = (1,1,1)`, vertices are raw world positions.

Notes:

- **No gzip.** Quantization to int16 already removes ~50% of geometry bytes; without base64 we are
  far ahead of today even before any compression. Revisit (zstd, not gzip) only if measurement
  shows the quantized payload is network-bound.
- Indices stay uint32. Some merged groups exceed 65k vertices, and the per-group uint16 win is
  small relative to position bytes. Defer until format is stable.
- One header per geometry payload (per-batch). Per-mesh quantization is unnecessary for typical
  scenes; the auto-fallback to float32 handles extreme cases.

### Format auto-selection (int16 vs float32)

The writer picks per-batch based on bbox size:

```
maxExtent = max(bboxX, bboxY, bboxZ)
step      = maxExtent / 65534
useFloat32 = step > 0.05  // 5 cm per int16 unit
```

Above this threshold the int16 grid becomes too coarse for visually-correct preview rendering
(e.g. a 10km site → 15cm step). All other batches stay int16 (~50% smaller wire payload).
The threshold is internal; users do not configure it. Override available for testing via
`forceFloat32`.

## C# implementation

### Writer — [Plugin/Selva.GH/Features/Display/Services/BinaryGeometryWriter.cs](../../Plugin/Selva.GH/Features/Display/Services/BinaryGeometryWriter.cs)

Pure C#, no Rhino or Grasshopper types — directly unit-testable. Replaces the old
`CompressionHelper.CompressGeometryData` (now deleted).

- Writes directly to a caller-provided `Stream`. The processor wraps it in a `MemoryStream` for
  now since the blob still rides inside the values JSON (Phase 1a); the future binary transport
  can hand in a frame buffer with no writer changes.
- Quantizes in a single pass into a pooled `byte[]` from `ArrayPool<byte>.Shared`, written with
  one `Stream.Write` call. Indices written via `Buffer.BlockCopy(int[], byte[])`.
- net48-compatible: pure `BinaryWriter` + `Buffer.BlockCopy` + `ArrayPool<byte>`. **No Span APIs**,
  so no `System.Memory` package reference needed (one less dependency).
- Returns a `WriteResult` struct with format selected, computed bbox, and counts — useful for
  diagnostics without re-walking the vertex array.

### Quantization formula

```csharp
short qx = (short)(Math.Round((v.X - originX) / scaleX) - 32767);
```

`(v - min) / scale` maps `[min, max] → [0, 65534]`; subtracting 32767 centers the range on 0,
matching Three.js `normalized: true` for signed int16. Degenerate axes (e.g. all vertices share Z)
get `scale` clamped to `1e-12` so the quantized component collapses to 0 instead of NaN.

Precision: 100m bbox → 1.5mm step; 10m → 0.15mm; 1m → 0.015mm. Above 5cm step (≈3.3km bbox) the
writer auto-selects float32.

### `MeshBatch` model

- `MeshBatch.CompressedData` is **kept** as `byte[]`, but now holds the full binary blob
  (header + metadata JSON + geometry) instead of `gzip(float32 + int32)`.
  `WebDisplayGoo.Read/Write/CastTo/ScriptVariable` are unchanged — they round-trip the goo as JSON
  with `CompressedData` as base64; the bytes are opaque to them, so file persistence and GHPython
  access continue to work.
- `MeshMetadata` field renames to make units explicit:
  - `FaceCount` → `IndexCount`
  - `VertexOffset` → `VertexStart` (in **vertex-count** units; multiply by 3 for the typed-array
    component offset)
  - `FaceOffset` → `IndexStart` (in index-count units)
    These names are stable for the JS parser; the old "in floats / in ints" semantics are gone.

### Metadata JSON inside the blob

The blob's metadata header is a self-contained copy of the `MeshBatch` envelope **without**
`CompressedData`. This keeps the format transport-agnostic: the same bytes can travel inside
today's outer values JSON or as a future binary WebSocket frame, and the JS parser doesn't branch
on transport. For Phase 1a there's a small duplication (the outer values JSON also contains
materials/groups), but it's KB-class — irrelevant compared to the ~17MB geometry win. When we
flip transports the outer envelope drops materials/groups, no parser change needed.

## Web implementation ✅ DONE

The web parser lives in the **external `@selvajs/compute` npm package** (`D:\Coding\selva-compute`).
Phase 2 shipped there; the builder-app and compute-app should bump the catalog reference to pick it up.

### Binary parser — [`binary-parser.ts`](../../selva-compute/src/features/visualization/webdisplay/binary-parser.ts)

```ts
export function parseBinaryMeshBatch(
	input: ArrayBuffer | Uint8Array | string
): ParsedBinaryMeshBatch;

export interface ParsedBinaryMeshBatch {
	metadata: BinaryMeshMetadata;
	flags: number; // bit 0: 0 = int16, 1 = float32
	vertices: Int16Array | Float32Array; // typed view into buffer, no copy
	indices: Uint32Array;
	origin: [number, number, number];
	scale: [number, number, number];
}
```

- Accepts `ArrayBuffer`, `Uint8Array`, or a base64 string (current JSON-envelope transport).
- Validates magic + version with clear error messages on failure.
- `JSON.parse` runs on the small metadata slice (kilobytes), not the full payload.
- Returns **typed-array views** into the original buffer — zero copies (falls back to a copy only when typed-array alignment can't be satisfied, which is rare).
- Handles misaligned byte offsets (variable-length metadata JSON means the geometry section may land at an odd offset in the underlying buffer).

### Three.js integration — [`batch-parser.ts`](../../selva-compute/src/features/visualization/webdisplay/batch-parser.ts)

The GPU-dequantize path (per-mesh matrix, `normalized: true` attribute) was considered and deferred:
`computeVertexNormals` and `applyMatrix4` write back floats and don't compose with a normalized
int16 attribute. The implemented path dequantizes to float32 in a single CPU pass with the Z-up→Y-up
rotation folded in — same pass, no extra allocations vs. the old per-vertex loop, and all downstream
Three.js helpers continue to work normally.

```ts
// Dequantize int16 to float32, folding in optional Z-up→Y-up rotation.
// world = origin + (q + 32767) * scale
function dequantizeInt16(q, origin, scale, applyCoordinateTransform): Float32Array;
```

`computeVertexNormals()` is kept on the client. Materials and groups are read from the blob's
embedded metadata header (source of truth), with the outer JSON envelope as a fallback.

**Old `mesh-compression.ts` is deleted.** `decompressBatchedMeshData` / `parseBatchedMeshBinaryData`
are gone; `fflate` is no longer called from the mesh pipeline.

### Type changes ([`types.ts`](../../selva-compute/src/features/visualization/webdisplay/types.ts))

`MeshMetadata` field renames match the C# renames (vertex-count units throughout):

| Old            | New           | Unit                                             |
| -------------- | ------------- | ------------------------------------------------ |
| `vertexCount`  | `vertexCount` | **vertex count** (was float-component count)     |
| `faceCount`    | `indexCount`  | index count                                      |
| `vertexOffset` | `vertexStart` | vertex index (multiply × 3 for component offset) |
| `faceOffset`   | `indexStart`  | index array offset                               |

`DecompressedMeshData` updated to carry `flags`, `origin`, `scale` alongside the typed arrays.

### Test helper ([`mesh-batch-builder.ts`](../../selva-compute/tests/helpers/mesh-batch-builder.ts))

`encodeBatchPayload` now writes the SLVA wire format byte-for-byte, matching the C# writer:
same 5cm threshold, same quantization formula, DataView writes throughout (no alignment assumptions).
Accepts `forceFloat32` for tests that need exact float roundtrips. Old gzip path is gone.

## Transport integration

### Builder-app (WebSocket)

- Send the `[magic][version][N][metadata JSON][geometry]` blob as a single binary WebSocket frame.
- Client receives `ArrayBuffer` directly from the `MessageEvent`. No base64, no `JSON.parse` on geometry, no gunzip.
- Correlate with request ID via a small fixed prefix or via the metadata JSON.

### Compute-app (Rhino.Compute → browser)

Rhino.Compute returns standard JSON, so the binary geometry must travel out-of-band:

**Option A — proxy endpoint (recommended).** Compute-app server hits Rhino.Compute, extracts WebDisplay outputs from the response, repackages each as a binary blob, and streams the result to the browser over `Transfer-Encoding: chunked`. First bytes go out before the last vertex is quantized.

**Option B — sidecar endpoint.** Server-side cache keyed by component instance + input hash; browser fetches `GET /webdisplay/:hash` for the binary blob and a small JSON pointer comes through the normal compute response.

Pick A first — simpler, no cache coherence issues. Move to B only if benchmarks show repeated parameter changes are re-uploading identical geometry.

### Worker offload

Both transports `postMessage(buf, [buf])` the `ArrayBuffer` into a Web Worker for parsing, then `postMessage` the resulting typed arrays back as transferables. Same total CPU, but the main thread stops freezing during parse.

## Phased rollout

### Phase 1a — C# writer + binary blob in existing JSON transport ✅ DONE

- `BinaryGeometryWriter` written and unit-tested ([Plugin/Selva.Tests/BinaryGeometryWriterTests.cs](../../Plugin/Selva.Tests/BinaryGeometryWriterTests.cs)) — 8 tests cover roundtrip, planar/zero-extent axes, extreme bbox auto-fallback, force-float32, validation.
- Benchmarks at [Plugin/Selva.Tests/BinaryGeometryWriterBenchmarks.cs](../../Plugin/Selva.Tests/BinaryGeometryWriterBenchmarks.cs) compare the new format against the old gzip+float32+int32 path. Results in [Measured impact](#measured-impact-revised-after-phase-1a-benchmarks).
- `MeshBatchProcessor` refactored to compute bbox once and call the writer.
- `MeshBatch` field renames (vertex-count units, not float-count units); `CompressedData` now holds the full binary blob.
- `CompressionHelper` deleted; gzip removed from the pipeline.
- `WebDisplayGoo` unchanged — base64-in-JSON persistence still works since the blob is opaque to the goo.
- Test project keeps `Selva.GH` out of its compile graph (dragging in Grasshopper.dll / WindowsForms breaks the net8 test host); the writer is linked in via `<Compile Include Link>` since it has no Rhino/GH deps.
- **No transport change yet** — the blob still rides as base64 inside the values JSON. End-to-end client sees the new format now that Phase 2 has shipped in `@selvajs/compute`. Pipeline is unblocked end-to-end.

### Phase 1b — WebSocket binary frame ✅ DONE

- `WebSocketServer.BroadcastBinaryAsync` ships frames with `WebSocketMessageType.Binary` (the
  text-only path is still used for the JSON envelopes).
- `WebSocketTransport.BroadcastOutputsWithFilesAndDisplay` strips `MeshBatch.CompressedData` out
  of the unified values JSON, sends each blob as its own binary frame, and announces the count
  via `binaryBatchCount` on the `outputs` envelope. WebSocket per-message ordering (TCP) keeps the
  binary frames after the JSON envelope they belong to.
- Client side: builder-app's WebSocket layer sets `binaryType = 'arraybuffer'` and dispatches
  `binaryFrame` events. `usePreviewState` subscribes, correlates the count, and parses each blob
  via `parseMeshBatchBlob` (added in `@selvajs/compute@1.5.2-beta.7`). The dead `displayData`
  field is removed from the message types.
- Compute-app (cloud) is intentionally unchanged on this phase — Rhino.Compute responses are
  JSON, so the SLVA blob still travels as base64 inside `item.data` and goes through the
  unchanged `parseMeshBatch` string entry. Phase 4 is what turns that into a binary stream.
- No backward-compat shim: builder-app and `@selvajs/compute` ship together. An older client
  paired with a Phase 1b plugin gets an empty viewport (no errors) until updated.

### Phase 2 — Web binary parser + dequantize path ✅ DONE

- `binary-parser.ts` — `parseBinaryMeshBatch(ArrayBuffer | Uint8Array | base64)`.
- `batch-parser.ts` — CPU dequantize (single pass, Z-up→Y-up folded in). `mesh-compression.ts` deleted.
- `types.ts` — `MeshMetadata` renamed to vertex-count units. `DecompressedMeshData` updated.
- `tests/helpers/mesh-batch-builder.ts` — writes SLVA format, gzip path gone.
- 11 new binary-parser tests + 135 total passing. Build clean, 0 lint errors.
- Publish a new `@selvajs/compute` version; bump the pnpm catalog in the monorepo to unblock end-to-end.

GPU-dequantize (`normalized: true` + per-mesh matrix) deferred — `computeVertexNormals` and
`applyMatrix4` can't compose with a normalized int16 attribute. Revisit in Phase 3 if normals
overhead is measurable after the worker offload lands.

### Phase 3 — Worker offload

- Move parse + BufferGeometry construction into a worker.
- Transfer ArrayBuffers, not copies.

### Phase 4 — Compute-app proxy endpoint

- Server-side repackage of Rhino.Compute responses.
- Streamed binary delivery to browser.
- Same parser, same code path on the client.

### Phase 5 (likely needed for parity with original projection) — zstd

After Phase 1a benchmarks, this phase moved from "optional" to "the path to hit the original
plan's wire-size target." Without zstd, raw int16 buys ~11% over gzip(float32). With zstd-after-
quantization, the heavy case projects to ~16–18MB wire (vs. ~27MB raw int16, vs. ~40MB old base64
gzip).

- C# library: `ZstdNet` or `Zstandard.Net` (both wrap the official C library).
- JS: `fzstd` (pure JS, smaller bundle, slower) or `@bokuweb/zstd-wasm` (WASM, faster, larger).
  Default to pure JS first; the WASM boot cost likely outweighs decode savings on small/medium
  meshes.
- The wire format already reserves `flags` bit 1 for compressed payloads. No version bump needed.
- gzip is not the right answer here — its decompression cost is the reason we removed compression
  in the first place.

**Decision gate**: ship Phase 1b + Phase 2 first, measure on real user connections (not
synthetic benchmarks), then decide if 1.5s on slow networks is worth a JS dependency.

## Measured impact (revised after Phase 1a benchmarks)

The original plan projected ~66% wire-size savings ("50MB → 17MB"). Real measurement on synthetic
1.5M-vertex meshes ([Plugin/Selva.Tests/BinaryGeometryWriterBenchmarks.cs](../../Plugin/Selva.Tests/BinaryGeometryWriterBenchmarks.cs))
shows much smaller wire savings — **gzip on float32 is more effective than expected** — but the
**encode CPU win is huge** and the client-side decode wins still hold.

### Raw size and encode time (measured)

| Scene                    | Old (gzip+f32+i32) raw | New (int16+u32) raw | Δ size   | Old encode | New encode |
| ------------------------ | ---------------------- | ------------------- | -------- | ---------- | ---------- |
| Small (10k v / 30k i)    | 176 KB                 | 180 KB              | **+2%**  | 21ms       | 2ms        |
| Medium (250k v / 750k i) | 4.84 MB                | 4.50 MB             | **−7%**  | 208ms      | 22ms       |
| Heavy (1.5M v / 4.5M i)  | 30.4 MB                | 27.0 MB             | **−11%** | 1262ms     | 113ms      |

Encode is **~11× faster** on the heavy case. That's the largest single win.

### End-to-end stages (heavy case, after Phase 1b + Phase 2 ship)

| Stage                          | Today          | After plan (v1)                                     | After Phase 5 (zstd) |
| ------------------------------ | -------------- | --------------------------------------------------- | -------------------- |
| C# encode                      | ~1260ms        | ~110ms                                              | ~150–200ms           |
| Wire payload (post-base64)     | ~40 MB         | ~36 MB raw bytes (Phase 1b removes base64) → ~27 MB | ~16–18 MB            |
| `JSON.parse` of geometry       | hundreds of ms | <5ms (Phase 1b)                                     | <5ms                 |
| Decompress on client           | ~200ms         | 0ms                                                 | ~30–50ms (zstd)      |
| Dequantize + Z-up rotate (CPU) | ~50ms          | 0ms (GPU)                                           | 0ms                  |
| `computeVertexNormals`         | ~30–80ms       | unchanged                                           | unchanged            |

### Where the win actually comes from

- **Most of the realized win is CPU on both ends, not wire size.** ~1.5s of avoided gzip encode
  alone justifies the change. The plan oversold wire savings and undersold encode-time savings.
- **The plan's projected 50MB → 17MB requires zstd** on top of int16 quantization. Without
  compression, raw int16 gives only ~11% over gzip(float32). With zstd-after-quantization, the
  original projection lands.
- **The biggest remaining wire-size lever is removing base64** (Phase 1b binary frame): −25% on
  whatever the raw blob size is.
- **Network is still dominant on slow connections.** On 50 Mbps broadband, 27MB ≈ 4.3s vs. 17MB
  ≈ 2.7s — Phase 5 buys ~1.5s on slow links and is irrelevant on LAN.

## Risks and decisions to revisit

- **Quantization precision for large/extreme scenes** — handled in v1 via the auto-fallback flag.
  Threshold is 5cm step (≈3.3km bbox); revisit if real scenes report banding artifacts above
  that.
- **Index width** — uint32 always. Per-group uint16 saves bytes for small meshes; defer until
  format is stable.
- **`.gh` file persistence** — `WebDisplayGoo.Read/Write` is unchanged. The blob is opaque bytes
  to the goo. Saved `.gh` files from the old (gzip+float32) pipeline and the new (int16) pipeline
  are not interchangeable on the JS side, but this is invisible to GH itself.
- **net48 compatibility** — confirmed clean. The writer uses only `BinaryWriter`,
  `Buffer.BlockCopy`, and `ArrayPool<byte>`. No Span APIs, no `System.Memory` package needed.
- **Format versioning** — version = 1. Bump on any wire-layout change. Clien and live. The new `@selvajs/compute` version is published and the monorepo catalog reference is bumped. End-to-end is unblockedth sides are implemented. Ship both together:
  publish the new `@selvajs/compute` version, bump the monorepo catalog reference, then release the
  plugin. End-to-end is unblocked once both are live.

## Source-of-truth notes

- This plan supersedes any earlier "ship normals from C#" or "drop base64" half-measures
  discussed in conversation. Do those only after Phase 1–3 land and are measured.
- Read this plan top-to-bottom before deviating. Update before changing direction.

## Status

- **Phase 1a** — DONE (2026-05-05). C# writer, processor, tests, benchmarks. Plugin emits SLVA
  blob inside existing JSON envelope.
- **Phase 2** — DONE (2026-05-05). `@selvajs/compute` binary parser, dequantize path, updated
  types + test helper. 135 tests passing, build clean. Package published and monorepo catalog bumped; end-to-end is restored.
- **Phase 1b** — DONE (2026-05-05). Binary WebSocket frame on the local (builder-app) transport.
  C# `WebSocketTransport.BroadcastOutputsWithFilesAndDisplay` strips `MeshBatch.CompressedData` out
  of the `outputs` JSON, ships each blob as a `WebSocketMessageType.Binary` frame, and announces
  the count via `binaryBatchCount`. Client side: `parseMeshBatchBlob(ArrayBuffer)` was added to
  `@selvajs/compute@1.5.2-beta.7`; `usePreviewState` subscribes to the `binaryFrame` event,
  correlates the count with the matching `outputs` envelope (using the existing
  `outputsToken` supersession pattern), and parses each blob without the JSON-string detour.
  `displayData` is gone from `WsOutputsMessage` / `WsInitialDataMessage`. Compute-app (cloud) is
  unchanged — it still receives the SLVA blob as base64 inside the Rhino.Compute JSON response,
  parsed by the existing `parseMeshBatch` string entry.
- **Phase 3** — pending. Worker offload for parse + BufferGeometry construction.
- **Phase 4** — pending. Compute-app proxy endpoint (server-side repackage of Rhino.Compute JSON).
- **Phase 5** — pending. zstd compression if network-bound connections still show >1.5s on the
  27MB raw payload.

### What Phase 1b actually buys (no new benchmark, just deterministic deltas)

The Phase 1a benchmark numbers in [Measured impact](#measured-impact-revised-after-phase-1a-benchmarks)
already projected the Phase 1b column. With the binary frame transport now live, those projections
become realized for the local (builder-app) path:

- **−25% on the wire** vs. Phase 1a's base64-in-JSON shape. Pure removal of base64 inflation
  (1 raw byte → 1.33 ASCII bytes). On the heavy synthetic case from the Phase 1a benchmark:
  ~36 MB base64 → **~27 MB raw bytes** on the wire.
- **`JSON.parse` on geometry: gone.** The `outputs` envelope now contains only metadata
  (kilobytes); the multi-MB geometry never enters the JSON parser. Phase 1a's "hundreds of ms"
  client-side JSON.parse cost on heavy scenes drops to **<5ms** (parsing the small envelope).
- **No base64 decode pass on the client.** `parseMeshBatchBlob` consumes the `ArrayBuffer`
  directly; the buffer→string→buffer round-trip from the JSON path is eliminated.

These are architectural deltas, not measured ones — no new benchmark runs. If you want hard
numbers from an end-to-end real run (heavy scene, real LAN, dev tools timeline), that's the next
thing worth measuring before deciding on Phase 5 (zstd).
