# Selva.Slva

The SLVA mesh format, as a Rhino-free `netstandard2.0` library: encode meshes (plus curves,
points, materials, and per-object attributes) into one compact self-describing byte stream,
and read it back. The same bytes travel over Selva's WebSocket, sit inside `.gh` archives,
and are the `.slvm` file — and a foreign host can write or read them without knowing
Grasshopper exists.

The byte-level spec lives in code headers (see below) and is explained in
[docs/contributing/slva-format.md](../../docs/contributing/slva-format.md).

## The three wire layers

| Layer | Magic  | What it is                                                                    | Spec (normative)                                              |
| ----- | ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| SLVA  | `SLVA` | Geometry blob: quantized/delta/byte-split vertices + indices, UV/color chunks | `Geometry/SlvaWriter.cs`                                      |
| SLVZ  | `SLVZ` | Optional raw-DEFLATE wrapper around any SLVA blob                             | `Geometry/SlvzCompressor.cs`                                  |
| SLVM  | `SLVM` | Chunked container: GEOM, TABL (object table), MATL/TEXR, CRVS/PNTS, EXTN      | `Container/SlvmDocument.cs`, TABL in `Container/SlvmTable.cs` |

Readers sniff the leading magic; unknown SLVM chunks are skipped by length — that is the
format's extension mechanism, so old readers survive new chunk types.

## Writing a batch from raw arrays

```csharp
var batch = MeshBatchAssembler.CreateBatch(
    new List<SlvaMeshInput>
    {
        new SlvaMeshInput
        {
            Vertices = vertices,          // float[] x,y,z per vertex
            Faces = faces,                // int[] 3 per triangle, mesh-local
            Name = "wall",
            Layer = "Structure/Walls",
            Material = ThreeMaterial.Default(),
            Metadata = new Dictionary<string, string> { ["myapp:fire"] = "REI60" },
        },
    },
    batchId: "my-batch-id");

// batch.CompressedData is the finished SLVM container (wire shape, no item chunks).
// For an .slvm file (items included):
using var fs = File.Create("part.slvm");
SlvmFile.Write(fs, batch);
```

Reading: `SlvmFile.Read(stream)` for files, `SlvmDocument.Read(bytes)` for raw containers,
`SlvaReader.Read(bytes)` to decode a geometry blob into world-space arrays.

## Extension points for other hosts

Two mechanisms, both already part of the wire format:

- **Per-object attributes** — `SlvaMeshInput.Metadata` / `MeshMetadata.Metadata` string
  pairs land in TABL's sparse attr columns: the key is stored once, then only the objects
  carrying it. Namespace your keys (`myapp:key`) — Selva uses `gh:*` and reserves
  `style:*` for item styling. No format change, no version bump, readers that don't know a
  key just carry it through.
- **EXTN chunks** — an opaque namespaced payload per host:
  `SlvmDocument.Write(batch, blob, includeItems, extensions)` with
  `{"myapp": payloadBytes}` writes one EXTN chunk; `SlvmDocument.Read` returns foreign
  namespaces in `ReadResult.Extensions`, and the rebuild helpers (`Restamp`,
  `StripItems`) preserve them. Selva's own `selva.gh` extension (batch id + Rhino curve
  JSON) is just the first client of this mechanism.

## The contract with the TypeScript decoder

`packages/schemas/fixtures/slva/` and `slvm2/` hold golden files this library's writer must
reproduce byte-for-byte (`SlvaFixtureContractTests`, `SlvmFixtureContractTests`) and the TS
parser must decode (`packages/visualization`'s fixture tests). Change the writer and the TS
reader together and bump the format version; `fixtures/slva/v3/` is frozen forever and pins
backward compatibility. Details: [packages/schemas/README.md](../../packages/schemas/README.md).
