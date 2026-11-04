# The display pipeline and the SLVA format

What happens between a Brep on the Grasshopper canvas and a lit, selectable mesh in the browser.

Five stages: meshing and encoding in Grasshopper, transport, then parsing and the scene in the browser. The C# Display component encodes; `batch-parser.ts` and `binary-parser.ts` decode. Both ends have to agree, so read the normative-spec note in stage 2 before changing either.

## Stage 1: Meshing (Grasshopper)

The **Display** component takes geometry as a tree and converts anything that isn't already a mesh into one, using the meshing settings on its `MS` input (default: Rhino's `MeshingParameters.Default`).

Alongside the geometry it reads four parallel trees: `Name` (N, the object's name in the scene outliner), `Layer` (L, a grouping path such as `Structure/Walls` that builds the outliner tree), `Metadata` (D, `Key=Value` strings shown when the user selects the object) and `Material` (M, a **Three Material**; objects sharing a material get batched together).

**One batch per input branch.** The output tree mirrors the input tree rather than flattening, so branch structure you built upstream survives into the viewer.

Two things worth knowing here:

- **Meshing is the expensive part.** It runs on a background task, not the solver thread, so Grasshopper stays responsive. But on a slow definition it still dominates. If your geometry doesn't change between solves, mesh once and cache it with **Display To File** / **Display From File**.
- **Non-mesh geometry rides along as JSON.** Curves and points are not meshed; they travel as _display items_ alongside the binary blob. Curves are tessellated to a polyline here, on the plugin side, which is why the browser needs no `rhino3dm`.

## Stage 2: Encoding (Grasshopper)

The meshes are packed into a compact binary format:

1. **Group by material.** Identical materials dedupe to one. Meshes stay in input order, and each run of consecutive meshes on one material becomes a group, so a material can head several groups. Keeping input order means the geometry bytes never depend on which material a mesh has. The browser gathers every group of one material into one merged mesh per layer, so interleaving costs no draw calls.
2. **Quantize.** Vertex positions snap to a signed 16-bit grid spanning the geometry's bounding box: half the size of float32, with error far below anything visible. If the step would exceed 5 cm per int16 unit (measured in metres via the document's unit scale, so ~3.3 km wide in any unit), the block falls back to raw float32 rather than degrade the preview. UVs quantize to unsigned 16 bits the same way, with their own fallback past 1/4096 (heavily tiled UVs). Vertex colours are 8-bit per channel and never fall back.
3. **Delta filter.** Each vertex component is stored as the difference from the previous vertex, zigzag-mapped so small differences become small unsigned numbers. Welded meshes have spatially-local vertices, so the deltas cluster near zero. This is a PNG-style pre-filter: it exists purely to make the last step work better. A side effect worth knowing: it makes a part's vertex stream translation-invariant, so repeated parts (the same screw placed 500 times) become repeated byte runs that DEFLATE dedupes. That gives instancing-like savings with no instancing in the format.
4. **Byte layout, chosen per blob.** The filtered streams are written either interleaved (x,y,z per vertex) or planar byte-split (all X deltas, then Y, then Z, low bytes before high). Neither wins everywhere, so the writer deflates both and keeps the smaller, recording the choice in a flag bit. Planar wins on welded surfaces and on scatters of substantial parts. Interleaved wins on batches of very small repeated parts (bolts, posts, panel clips): each copy's delta stream is too short to form useful LZ77 matches once planar scatters it across six distant planes. Which one wins turns on the vertex count of the individual repeated part, not on how many copies the batch holds, and nothing cheap infers part size from a flat vertex array (a batch arrives as one concatenated buffer with no part boundaries), hence the measurement. Colors stay interleaved unconditionally: planar loses on noisy per-channel data. Batches under 4096 vertices skip the probe and take planar. Thresholds and measurements are in `ChoosePlanarLayout` in `SlvaWriter.cs`.
5. **Deflate.** The chosen stream is compressed, and the geometry blob wrapped in an `SLVZ` container when that actually shrinks it. Decoders sniff `SLVA` vs `SLVZ` from the leading magic, so the result is self-describing.
6. **The SLVM container.** The finished geometry blob is packed with everything else the batch carries into one chunked container: the bytes that travel as `CompressedData` and, with the item chunks added, sit on disk as a `.slvm` file. The chunks are `GEOM` (the blob from steps 1 to 5), `TABL`, `MATL`, `TEXR`, `CRVS`, `PNTS`, `CLSD` and `EXTN`; the header and every chunk's payload are specified in [`SlvmDocument.cs`](../../Plugin/Selva.Slva/Container/SlvmDocument.cs).

   Readers skip unknown chunk types by length; that is the format's extension mechanism. The `TABL` object table is columnar and pays only for what's present: per-mesh vertex/triangle counts (vertex/index **starts are never stored**: geometry is concatenated in table order, so windows are prefix sums and can't overlap by construction), material run-lengths, names/layers as string-pool references (the auto-numbering default collapses to one mode byte), and sparse attr columns (the key stored once, then only the objects carrying it: `gh:branch`, `ifc:guid`, `style:color`, …). Object identity is the reserved `id` attr in `TABL`, split back out on read. Selva's own host data, the Rhino NURBS JSON behind each curve, lives in `EXTN "selva.gh"`, so the core container stays free of Grasshopper concepts: a foreign reader gets every mesh, name, layer and material without knowing Selva exists.

   The wire container omits the item chunks (curves/points travel as JSON alongside, stage 3); the `.slvm` file includes them. Ids travel inside the file, so Display From File needs no restamping, and the geometry is never re-encoded. A file also carries `EXTN "selva.units"`, the unit system its coordinates are in: the viewer scales by the open document's units, so Display From File warns when they differ.

Version gates are additive within the geometry blob: each SLVA bump so far only added a flag bit, and readers ignore trailing bytes, so a decoder handles every blob back to version 1. That matters because blobs persist: saved `.gh` files, `.slvm` mesh files and cached compute results must stay decodable after an upgrade. The frozen pre-v4 fixtures under `packages/schemas/fixtures/slva/v3/` pin this on both stacks; never regenerate them. Containers are gated separately and dispatched on the leading magic: new bytes are always SLVM v3, and both stacks read SLVM v3 and the bare SLVA/SLVZ blobs in old `.gh` files. Only the C# `SlvmFile` also reads the legacy `DMF1` file container. Unlike the geometry blob, the container version is an exact match, not a floor: SLVM v2 was a pre-release layout that never shipped, so nothing on disk carries it and readers reject it outright. The cross-stack container fixtures live under `packages/schemas/fixtures/slvm3/` (`UPDATE_SLVM_FIXTURES=1 dotnet test` regenerates).

> **The byte-level spec is normative and lives in code, in two places that must agree:** for the geometry blob, the remarks block at the top of [`SlvaWriter.cs`](../../Plugin/Selva.Slva/Geometry/SlvaWriter.cs) (encoder) and the constants in [`binary/header.ts`](../../packages/visualization/src/parse/webdisplay/binary/header.ts) (decoder); for the container, [`SlvmDocument.cs`](../../Plugin/Selva.Slva/Container/SlvmDocument.cs) (TABL layout in [`SlvmTable.cs`](../../Plugin/Selva.Slva/Container/SlvmTable.cs)) and [`binary/slvm.ts`](../../packages/visualization/src/parse/webdisplay/binary/slvm.ts). Change them together and bump the version.
>
> The format is internal to the plugin and `@selvajs/visualization`. It is versioned and can change without a major bump; don't build against it directly.

## Stage 3: Transport

The blob travels inside a `DisplayBatch` JSON envelope (`types.ts`): base64 over HTTP from Rhino.Compute, raw binary over the plugin's WebSocket.

Producing these payloads requires the VektorNode Rhino.Compute fork.

This is the stage to look at when a scene is slow to _appear_ but fast to _interact with_. Check the payload size with the **Display Size** component. If it's large, the usual causes are meshing too finely, or emitting geometry the user can't see.

## Stage 4: Parsing (browser)

Handled by `@selvajs/visualization` in its `/parse` layer. It reverses the encode:

```
solve response
  └─ webdisplay-parser      pick out display data, scale to metres, ground, bound
       └─ batch-parser      entry points; dispatches the off-thread worker path
            ├─ binary-parser     SLVA decode: header, inflate, un-delta, dequantize
            ├─ batch/metadata    validate group windows, dequantize
            ├─ batch/materials   SerializableMaterial → MeshPhysicalMaterial
            ├─ batch/merge       build merged + individual meshes
            └─ mesh-assembly     the pure assembly function the worker and main thread share
```

Curves and points go down a separate path. Nothing is decoded in the browser: the plugin tessellates curves and sends `points`, which become fat `Line2` lines and `THREE.Points` clouds. This package has no `rhino3dm` dependency.

Two behaviours to know:

- **Parsing can run in a worker.** Decoding a large blob on the main thread would block the UI, so the batch parser has an off-thread path.
- **Absent data is not an error, corrupt data is.** An envelope with no display data yields an empty scene. A _truncated_ blob or an out-of-range group window throws: better a visible failure than a silently half-rendered model.

## Stage 5: The scene

The parsed meshes are added to the Three.js scene by the viewer (`/render`), and the scene outliner (`/scene`) reads visibility, selection, and the layer tree off them. The `Layer` strings from stage 1 are what build that tree; the `Metadata` pairs are what the selection panel shows.

Three invariants hold across the whole pipeline:

- **One coordinate frame end to end.** The Three scene _is_ Rhino's Z-up frame. Vertices pass through unrotated; nothing anywhere reintroduces a rotation.
- **Reuse across solves is narrow.** `batch/finished-cache.ts` hands back the same `BufferGeometry` when the geometry bytes match an earlier batch byte for byte (256 MB cap), and `render/edges/extraction.ts` keeps edge results keyed on those geometries' arrays. Never write to a parsed geometry's attributes.
- **The scene owns its GPU resources.** Geometries and textures are disposed with the objects holding them, except geometry shared from the finished-geometry cache; the ownership rule is in `shared/gpu-ownership.ts`.

## Debugging a bad scene

| Symptom                                    | Look at                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Nothing renders                            | Is the Display output actually reaching the schema? Check the UI Bridge picked it up.                      |
| Geometry is there but untextured/grey      | Material wired? A texture that failed to load leaves the base colour.                                      |
| Faceted where it should be smooth          | Meshing settings on Display's `MS` input.                                                                  |
| Slow to load                               | **Display Size**. Then meshing density, then how much geometry you're emitting at all.                     |
| Slow to orbit once loaded                  | Too many distinct material and layer pairs: each pair is its own draw call after merging. Share materials. |
| Scene looks right, outliner is a flat list | The `Layer` input is empty. It's what builds the tree.                                                     |
| Curves missing, meshes fine                | Curves arrive pre-tessellated from the plugin. An older plugin build won't send them.                      |

## Next

- [Parse layer](../../packages/visualization/src/parse/README.md): the barrel this format is decoded behind.
- [Caching](../self-hosting/concepts/caching.md): what is and isn't reused between solves.
