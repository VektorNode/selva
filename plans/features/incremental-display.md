# Incremental display: remesh and resend only what changed

**Unfiled.** §1 and input-order streams are built; §2–4 are design only.

Scope: what a re-solve costs when most of the scene did not change. A colour, a texture or a
roughness value should not remesh anything, put geometry back on the wire, or re-upload it to the
GPU. One moved part should not remesh the rest; whether it resends the rest depends on how the
definition splits branches (see the unit of resend in §2). Same design locally and under
Rhino.Compute; only the mesh cache needs the Compute process to keep state between requests.

Companions: [cloud-binary-transport](./cloud-binary-transport.md) (the manifest below replaces its
"blob out of the values JSON" step) and [live-solve-channel](../archive/live-solve-channel.md) (the facts
about Compute routing used here come from there).

## Where we stand

The plugin reuses meshes and encoded geometry (§1); everything after it does the full job:

| Stage         | What happens on a material-only change                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display (C#)  | Material is an input, so the component reruns. It reuses every mesh and each branch's encoded geometry, and rebuilds only the table and materials.                                      |
| Payload       | Materials sit in the `MATL` chunk inside the same SLVM container as the geometry, so the bytes change even when the geometry did not.                                                   |
| Wire, local   | `WebSocketTransport` broadcasts every blob as a binary frame, every solve.                                                                                                              |
| Wire, Compute | The whole container travels as base64 inside the values JSON. Bitmap and file textures are data URIs inside `MATL` (headless has no asset server), so image bytes ship every solve too. |
| Browser       | A geometry chunk byte-identical to an earlier one reuses its `BufferGeometry`, so nothing is decoded or uploaded again, and its extracted edges; materials and meshes are rebuilt.      |

With the perf log on, `DisplayPerf` reports both caches' hits (`meshCache`, `blobCache`), plus
`reuse` (items whose `DataCRC` matches the previous solve) and `resend` (branches whose blob came
out byte-identical, which is what the transport work below would stop sending).

## The rule

**Everything is content-addressed, per stream. Each client declares which hashes it holds; whatever
sends to that client strips the rest.** State on either side only makes things cheaper. A lost
cache, a restarted Compute child or a reloaded tab produces a full payload, never a wrong one.

## 1. Mesh cache in the plugin

Two static, byte-bounded LRUs in `Selva.GH`: `MeshItemCache` and `GeometryBlobStore`.

**Item cache**, consulted per work item in `ComputeBatch`'s parallel pass.

- **Key:** geometry type + `DataCRC` (plus vertex colours and texture coordinates for a mesh,
  which its `DataCRC` skips), the meshing parameters, `mmPerUnit` and the UV step `DisplayUvs`
  runs (`UvSteps.For`, which both share). When that step is the grain pass, also `MapSize` and the
  item id, which seed the grain offset. Only there: keying every item on its id would make
  inserting one item at the front of a branch miss every item after it. Colour, opacity,
  roughness, finish, anisotropy and texture URL reach the mesh only through the UV step, so
  changing them is a hit.
- **Value:** the welded arrays (positions, indices, UVs, colours), plus the Rhino `Mesh` and bounds
  the viewport preview draws. A hit skips meshing, normals, UVs, weld and array extraction. Entries
  are shared across solves, so nothing may mutate them, and the byte bound covers the mesh as well
  as the arrays. A few hundred smooth Breps take a few hundred MB, so the bound is 1 GB on a
  desktop, where toggling between two whole-scene variants must keep both, and 256 MB per Compute
  child.

**Branch cache**, consulted per branch in the encode pass. Quantization bounds, the
planar/interleaved probe (two trial DEFLATEs) and the stream hash are all per branch, so item hits
alone still re-encode and re-hash every branch.

- **Key:** the branch's item keys, in the order the blob writes them (`SlvaMeshInput.ContentKey`,
  passed through `MeshBatchAssembler` to an `IGeometryBlobCache` the host supplies).
- **Value:** the encoded `GEOM` chunk. A hit also skips building the combined arrays. Once §2
  lands, each stream chunk and its hash.

A material-only change hits both levels: nothing is meshed, encoded or hashed. The branch key is
built from item keys, never from array contents, so a hit costs no hashing. Meshes are written in
input order (§2), so a change that regroups meshes hits too. One changed item still re-encodes its
whole branch.

On the desktop, closing any Grasshopper document empties both caches, so a closed definition
holds no memory. Under Compute this needs nothing extra: children are long-lived, so a static survives between
requests. Each child holds its own copy, so the byte bound is per child. The hit rate is bounded by
routing: `rhino.compute` round-robins across children with no affinity, so with `--childcount N` a
repeat solve lands on a cold child most of the time. Child affinity would fix that and belongs in
the Compute fork, not here; correctness never depends on it.

`DataCRC` is not free on large Breps. `DisplayPerf` reports the key cost as `cpuMs.key`: 2.4 ms
for 400 spheres and cylinders, against 700 ms or more to mesh and encode them.

## 2. Split the container into streams

Today `GEOM` is one SLVA blob holding positions, indices, UVs and colours. Per branch, split it:

| Stream                 | Changes when                                   | Browser keeps it as         |
| ---------------------- | ---------------------------------------------- | --------------------------- |
| positions + indices    | geometry changes, or a weld seam moves (below) | position / index attributes |
| UVs                    | mapping or `mapSize` changes                   | `uv` attribute              |
| vertex colours         | colour data changes                            | `color` attribute           |
| object table (`TABL`)  | name, layer, metadata, material assignment     | outliner entries, windows   |
| one chunk per material | that material changes                          | `THREE.Material`            |
| one chunk per texture  | the image bytes change                         | `THREE.Texture`             |

Normals are recomputed in the browser and follow positions.

**Weld seams couple the streams, and hashing handles it.** The weld keeps vertices apart wherever
an exported UV or colour differs. A uniform recolour leaves the weld identical, so positions hash
the same and only the colour stream moves. A change that moves a seam changes positions too, and
both are sent. No special casing, but the weld must be deterministic. Rhino's `CombineIdentical`
does it and neither test project loads Rhino, so pin it in Rhino, on
[display_pipeline_debug.ghx](../../fixtures/grasshopper/display_pipeline_debug.ghx), before relying
on it.

**Stream order must not depend on materials.** `MeshBatchAssembler` writes meshes in input order,
and material assignment lives only in `TABL`, as one run per stretch of consecutive meshes on one
material. Sorting by material made reassigning one part's material reorder the whole blob. The
browser gathers every run of a material into one merged mesh (`mergeGroupsOf`) from arbitrary
vertex windows, so this costs no draw calls. A regrouping no longer costs bytes or a plugin
re-encode, but the browser still decodes it in full: its finished-geometry cache keys on the merge
jobs, and a regroup changes them.

Each stream gets its own quantization origin and scale and its own planar/interleaved probe, as a
whole blob does today.

**Unit of resend: the branch, not the item.** One chunk per stream per branch. Per-item chunks
would lose cross-part DEFLATE dedupe: the delta filter turns repeated parts into repeated byte runs,
and DEFLATE only finds them within one stream (see the codec section of
[slva-format](../../docs/contributing/slva-format.md)). The cost: one moved part resends its
branch's whole positions stream, and the browser re-merges and re-uploads that branch's material
groups. A definition that emits one fat branch, the common case, gets the material and colour
savings but not this one. Parts that change together go in one branch; parts that change
independently go in separate ones.

This is a new SLVA/SLVM version. The frozen v3 fixtures stay frozen and keep pinning the old read
path.

## 3. The manifest and the `known` list

The Display output on the wire becomes a **manifest**: per branch, the stream hashes and byte
sizes, the table, material and texture hashes. Chunk bytes travel alongside only for hashes the
client did not declare.

Each client declares `known`: the hashes it holds. How it declares them depends on the transport
(§4). Hashes are 128 bits (SHA-256 truncated): a collision shows the wrong geometry with no error,
so this is not the place for a cheap hash. Only C# hashes; the browser and the Selva server never
compute one, they store or compare what they are told.

**Persisted and cached shapes do not change.** The `WebDisplayGoo` value, saved `.gh` files,
`.slvm` files, Display To File, Combine Display, and every solve cache (`cachesolve`, the server's
single-flight and `ISolveResultCache`) hold complete, self-contained payloads. Stripping known
chunks is a projection applied per client, after every cache, and never stored.

**Browser chunk store.** Two kinds of entry: chunks (parsed stream arrays, by hash) and the GPU
objects built from them (materials, textures, and merged geometries keyed by their branch's stream
hashes and group windows, so a colour change reuses the uploaded buffers). Three rules, from the GPU
leak the [caching audit](../archive/caching-audit-2026-07.md) found:

- Bounded by bytes. Evicting a GPU object disposes it.
- A GPU object the current scene or a `createSolveMemo` entry references is never evicted; refcount
  them. The memo copies geometry but shares materials, so its entries hold materials and textures.
- A hash declared in `known` is pinned until nothing can still strip against it: per request, until
  that response is applied or aborted; per connection, until an envelope stamped with a later
  `known` version arrives. Otherwise eviction between declaration and response leaves a reference
  the store can no longer resolve.

## 4. Transports

**Local.** Solves start from the canvas as often as from a page, and `WebSocketTransport`
broadcasts every result to every connection; the Rhino panel and a browser tab can be open
together. So `known` is connection state, not a request field:

- The page declares its hashes on connect, then sends additions and evictions as they happen, each
  bumping a version.
- The transport strips per connection and stamps the outputs envelope with the `known` version it
  stripped against. The envelope carries the manifest; frames carry only unknown chunks, each
  prefixed with its hash.
- A chunk sent before the page declares it is sent again: wasteful, never wrong.

The page still declares; the transport only applies it, and the state dies with the connection. No
protocol beyond this connection is involved, so this is the place to prove the design.

**Compute.** Strip in the Selva server, per response. The browser already solves through
`/api/compute`; the server forwards to Compute and gets the full payload back. The request body
carries `known`, and `@selvajs/solve`'s server pipeline strips after `cachesolve`, single-flight and
`ISolveResultCache`, all of which share one result between clients. It belongs in the pipeline, not
a route handler, so every route that serves a solve strips the same way. The server finds Display
outputs by their wire type and drops the listed chunk bytes; it never decodes geometry.

Compute never sees `known`: stock Compute works and the fork needs no change. Clients that call
Compute directly get full payloads. The Compute → server hop still carries every chunk as base64
inside the values JSON until [cloud-binary-transport](./cloud-binary-transport.md) moves it out;
that is the cheap hop, and server → browser carries only unknown chunks.

Textures in headless mode become ordinary texture chunks instead of data URIs, so an unchanged
image is never re-sent.

## Order

Read what `DisplayPerf` already reports on real projects first. `reuse.unchangedItems` against
`resend.unchangedBranches` bounds the opportunity: items whose geometry is unchanged while their
branch still resends are what this plan recovers. If that gap is small, stop. If it is large,
extend `DisplayPerf` to hash each proposed stream per branch. If
material-only and colour-only changes are rare in practice, the stream split is not worth a format
version.

Then the item cache: it pays in local mode on its own, with no wire change. Then the stream split,
branch cache and manifest over the local WebSocket. Compute last: it needs the manifest in the
values JSON and the strip in the server pipeline.

## Rejected

- **The producer remembers what it sent.** Breaks on round-robin children, Compute restarts and tab
  reloads. The client knows what it holds; the producer can only guess.
- **`known` inside the Compute request**, as a header the fork exposes or as a reserved hidden
  input. `cachesolve`, single-flight and `ISolveResultCache` share one result between clients.
  Stripping inside the solve on a header serves one client a result stripped against another's
  `known`; a hidden input splits the cache key, so they stop sharing. A header listing thousands of
  hashes also runs into proxy header limits.
- **Fetch chunks by hash from a separate endpoint**, as `TextureAssetStore` does for local
  textures. A second round trip, and under Compute nothing that would answer it holds the chunk:
  the Selva server keeps no payloads, and round-robin routing usually picks a child that never
  produced it.
- **Reviving `BatchBlobCache`.** It keyed on a batch's combined arrays, which exist only after
  meshing, so it never skipped meshing, and it cached one blob per batch, so a change to one item
  missed the whole batch. The branch cache keys on item keys and holds per-stream chunks.
- **Reviving the browser's `geometry-cache.ts`.** It fingerprinted samples from the head and tail of
  each buffer window, so a change in the middle could serve stale geometry. Hashes from C# replace
  the fingerprint.
- **Per-item chunks.** Lose cross-part compression; see the unit of resend in §2.
- **Binary diffs against the previous payload.** Both sides must agree on the base, which is
  exactly the shared state this design avoids. Content addressing gets the same savings without it.
- **Draco, meshoptimizer, Brotli.** Benchmarked and rejected for the codec; nothing here changes
  that.
