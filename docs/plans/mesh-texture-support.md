# Plan: Optional texture/UV support in the binary mesh format

**Status:** Proposed (2026-06-27)
**Scope decided:** Producer-side UV chunk only in this repo. All texture _handling_ (image
fetch/decode, `MeshPhysicalMaterial.map`, caching, asset resolution) lives in `@selvajs/compute`,
which the user owns. UV coordinates encoded as **float32**. No image bytes in this repo's blob.

This plan was written after reading the actual producer code (this repo) **and the real
`@selvajs/compute` source** at `/Users/felix/coding/selva-compute` (currently v2.6.0). The binding
constraints below are confirmed against that source, not assumed from the minified bundle.

---

## TL;DR

Add an **optional UV-coordinate chunk** to the SLVA mesh blob, gated by a new flag bit. When a mesh
carries texture coordinates we append `vertexCount × 2` float32 values **after** the index block;
when it doesn't, the blob is byte-for-byte identical to today. No version bump, no cost to
untextured meshes.

This repo's job ends at _emitting geometry_. Turning UVs into a textured render — loading images,
binding `map`/`normalMap`, asset delivery — is `@selvajs/compute`'s responsibility and is **out of
scope here**. The format change is the easy 20%; it is **inert until the compute decoder reads the
chunk and the material system references textures**.

---

## Why now / the goal

Meshes today ship position + topology only. Rhino meshes routinely carry
`Mesh.TextureCoordinates`, and the user wants textured display without inflating the payload for
meshes that don't need it. Hence: **optional, zero-cost-when-absent.**

---

## The format today (SLVA v2)

Written by [BinaryGeometryWriter.cs](../../Plugin/Selva.GH/Features/Display/Services/BinaryGeometryWriter.cs),
read back by [BinaryGeometryReader.cs](../../Plugin/Selva.GH/Features/Display/Services/BinaryGeometryReader.cs)
(C# preview) and by `parseBinaryMeshBatch` (the SLVA decoder) in `@selvajs/compute`
(`selva-compute/src/features/visualization/webdisplay/binary-parser.ts`). The format is implemented
in **two production places — both writers are C# in this repo; the only TS encoders in
`selva-compute` are test fixtures.** Layout, little-endian:

```
magic "SLVA" | version(u32) | metadataLen(u32) | metadata JSON
flags(u32) | origin(3×f64) | scale(3×f64) | vertexCount(u32) | vertices | indexCount(u32) | indices
```

- `flags` bit0 (`FlagFloat32 = 0x1`): float32 vs int16-quantized vertices.
- `flags` bit1 (`FlagUint16Indices = 0x2`): uint16 vs uint32 indices.
- Vertices are **position only** — no normals, UVs, or vertex colors anywhere in the pipeline.
  [GeoMeshProcessor.ConvertMeshToArrays()](../../Plugin/Selva.GH/Features/Display/Services/GeoMeshProcessor.cs#L21)
  drops everything except position + faces, even though `Mesh.TextureCoordinates` is available.

---

## The two constraints that shape the design

Both are confirmed in `parseBinaryMeshBatch`
(`selva-compute/src/features/visualization/webdisplay/binary-parser.ts:105-252`). The user **owns**
`@selvajs/compute`, so it _can_ be changed — but old/un-upgraded clients still run the current
decoder, so the format change must be backward-safe regardless.

1. **Cannot bump the version.** The decoder validates
   `if (version < MIN_SUPPORTED_VERSION || version > BINARY_MESH_VERSION) throw`
   (`MIN_SUPPORTED_VERSION = 1`, `BINARY_MESH_VERSION = 2`, `binary-parser.ts:20-28`). Emitting
   version 3 would make every current client reject the blob. New optional data must ride **inside
   the existing version envelope**.

2. **Trailing bytes are safe.** `parseBinaryMeshBatch` reads metadata → geometry header → vertices →
   index count → indices, then **returns immediately** (`binary-parser.ts:244-251`). It never
   asserts it consumed the whole buffer. So bytes appended _after_ the index block are **silently
   ignored** by current decoders. This is the extension seam: append the UV chunk after indices,
   gated by a spare flag bit. Old decoders skip it; upgraded decoders that check the bit read it.

Together these give the zero-cost-when-absent property: no flag bit + no chunk ⇒ identical bytes;
flag bit + chunk ⇒ old clients render untextured (ignore trailing data), new clients render
textured.

---

## Proposed format change

Add one flag bit and an optional trailing chunk:

```
// existing blob, unchanged …
indexCount(u32) | indices

// -- NEW: appended only when FlagHasUv is set --
uvCount(u32)        // == vertexCount; sanity/forward-compat
uvs                 // float32[vertexCount * 2]  (u, v per vertex)
```

- New flag: `FlagHasUv = 0x4` (bit 2) on the existing `flags` word.
- **float32**, 8 bytes/vertex. Chosen over int16-quantized-to-[0,1] because UVs commonly exceed
  [0,1] for tiling and int16 precision can shimmer on large textures. The chunk only exists when
  UVs are present, so untextured meshes pay nothing — the size argument for quantizing is moot.
- UVs are **per combined-vertex**, in the same order as the combined vertex array, so the web side
  slices them per-mesh by the existing `vertexStart`/`vertexCount` exactly like positions.

---

## Producer-side work (this repo)

1. **[GeoMeshProcessor.cs](../../Plugin/Selva.GH/Features/Display/Services/GeoMeshProcessor.cs)** —
   also extract `mesh.TextureCoordinates` when `Count == vertexCount`; return an optional
   `float[] uvs` (length `vertexCount * 2`), or `null` when absent/mismatched. A mesh with no/partial
   texture coords contributes no UVs.

2. **[MeshBatchProcessor.cs](../../Plugin/Selva.GH/Features/Display/Services/MeshBatchProcessor.cs)** —
   thread `uvs` through `ProcessedMesh` and rebase into a combined `allUvs` array alongside
   `allVertices` (same cursor logic, 2 components/vertex instead of 3). **Decision needed:** a batch
   is mixed when some meshes have UVs and some don't. Simplest correct rule: emit the UV chunk only
   if **every** mesh in the batch has valid UVs; otherwise omit it entirely (meshes are batched
   together, and a partial UV buffer has no well-defined values for the UV-less vertices). Revisit
   if real definitions need per-mesh mixing.

3. **[BinaryGeometryWriter.cs](../../Plugin/Selva.GH/Features/Display/Services/BinaryGeometryWriter.cs)** —
   add `FlagHasUv`; accept an optional `float[] uvs` param. When non-null and length ==
   `vertexCount * 2`, set the bit and append `uvCount(u32)` + float32 UVs after the index block.
   When null, write nothing — current behaviour preserved.

4. **[BinaryGeometryReader.cs](../../Plugin/Selva.GH/Features/Display/Services/BinaryGeometryReader.cs)** —
   read the chunk back when `FlagHasUv` is set, so the C# viewport preview stays in lockstep. (This
   reader is in-repo, so it can't drift like the external one.)

5. **Tests** — extend
   [BinaryGeometryWriterTests.cs](../../Plugin/Selva.Tests/BinaryGeometryWriterTests.cs): round-trip
   a mesh with UVs, assert the flag bit + chunk, and assert a no-UV mesh produces byte-identical
   output to today (the zero-cost guarantee).

**Explicitly NOT in this repo's scope:** material texture-reference fields in the metadata JSON
([DisplayBatch.cs](../../Plugin/Selva.GH/Features/Display/Services/DisplayBatch.cs)
`SerializableMaterial`). Those are only meaningful once compute consumes them, and the user wants
texture handling to live entirely in `@selvajs/compute` — so the material `map`/asset schema is
designed and owned there, not here.

---

## Consumer-side work (`@selvajs/compute` — separate repo, NOT this scope)

Captured here with real names/paths so the seam is documented; tracked/implemented in the compute
repo. All paths relative to `/Users/felix/coding/selva-compute`.

- **Format constants** (`src/features/visualization/webdisplay/binary-parser.ts:9-36`): add
  `FLAG_HAS_UV = 0x4` next to `FLAG_FLOAT32` / `FLAG_UINT16_INDICES`. Keep these in lockstep with
  the C# `BinaryGeometryWriter` flags — they are the same wire contract in two languages.
- **Decoder** `parseBinaryMeshBatch` (`binary-parser.ts:105-252`): when `flags & FLAG_HAS_UV`, read
  the trailing `uvCount(u32)` + `float32[uvCount*2]` after the index block, and add
  `uvs: Float32Array | null` to the `ParsedBinaryMeshBatch` result (currently
  `{metadata, flags, vertices, indices, origin, scale}`). No version-validation change.
- **Mesh builders** in `src/features/visualization/webdisplay/batch-parser.ts`:
  - `createMergedMesh` (`:356-426`) and `createIndividualMeshes` (`:432-479`) both slice positions
    per-mesh by `meshMeta.vertexStart`/`vertexCount` and call `computeVertexNormals()` (`:403`,
    `:461`). Slice `uvs` with the **same** start/count (×2 instead of ×3) and
    `geometry.setAttribute('uv', new THREE.BufferAttribute(slicedUvs, 2))` right after the
    `position`/`setIndex` calls.
- **Material system**: extend `SerializableMaterial` (`types.ts:7-13`) with optional texture
  reference fields, and load images into `MeshPhysicalMaterial.map` in `createMaterial`
  (`batch-parser.ts:297-342`). **Wrinkle:** `createMaterial` is currently **synchronous**; texture
  loading via `THREE.TextureLoader` is async, so this forces either making `createMaterial` async
  (and threading the await up through the build path) or assigning `material.map` post-load and
  flagging `needsUpdate`. Decide in the compute repo. **All texture handling lives in compute**, per
  the scope decision — including how image bytes reach the browser (recommended pattern below).
- **Tests**: extend `src/features/visualization/webdisplay/__tests__/binary-parser.test.ts` (the
  encoder fixtures there build SLVA blobs to decode — add a UV-chunk fixture + round-trip) and
  `__tests__/batch-parser.test.ts` (assert the `uv` attribute is set and sliced correctly in both
  the merged and individual paths).

### Recommended asset-delivery pattern (for the compute repo)

Not decided here, but the analysis that informed the scope split, recorded so it isn't re-derived:

- Reference textures by **content hash / id** in the material model, never inline bytes. Mesh blob
  stays geometry-only and tiny.
- Deliver bytes **out-of-band, keyed by hash**: `GET /assets/{hash}` off the plugin's local HTTP
  server in WebSocket/local mode; CDN/object storage in cloud mode. Browser caches by immutable URL
  (hash = content), so textures fetch **once** and never re-ship on a re-solve.
- This matters because Selva's hot loop re-solves geometry on every slider nudge while the texture
  is unchanged — embedding bytes in the blob would re-ship megabytes per tick. (glTF makes the same
  external-vs-GLB trade-off; hash-keyed references are the streaming-friendly default.)
- `.dmf` portable export ([DmfFile.cs](../../Plugin/Selva.GH/Features/Display/Services/DmfFile.cs))
  can inline hashed assets at save time for a self-contained file — a serialization concern, not a
  wire-protocol one.

---

## Sequencing

1. **This repo:** UV chunk in writer/reader/processor behind `FlagHasUv` + tests. Self-contained,
   verifiable in isolation (round-trip + byte-identity-when-absent), ships independently. Inert
   until step 2.
2. **`@selvajs/compute`:** add `FLAG_HAS_UV`, decoder reads the chunk, builders set the `uv`
   attribute, material/asset plumbing. First point at which a textured mesh actually renders. Ships
   via the repo's existing Changesets release flow (`changeset publish`); this repo's plugin then
   bumps the `@selvajs/compute` catalog version in `pnpm-workspace.yaml` to consume it.
3. **`.dmf`/cloud asset delivery** as needed.

The format extension is low-risk and backward-safe. The visible payoff lands only after the compute
work — keep that expectation explicit when prioritising.

---

## Open decisions

- **Mixed-UV batches:** all-or-nothing per batch (proposed) vs. per-mesh UV presence. Start
  all-or-nothing; revisit with a real definition that needs mixing.
- **UV channel count:** single channel (uv0) proposed. Multi-UV (lightmaps etc.) is a later flag
  bit + chunk if ever needed.
- **Texture-reference schema + asset transport:** owned by `@selvajs/compute`; recorded above as a
  recommendation, decided in that repo.
