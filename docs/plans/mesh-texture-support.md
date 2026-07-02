# Optional UVs, vertex colors, and material textures in the mesh format

**Status:** Implemented (2026-07-02). This supersedes the 2026-06-27 proposal, which was written
against SLVA v2 — v3 (delta filter) had since claimed flag bit `0x4`, so the chunk flags shipped
as `0x8`/`0x10`.

## What shipped

The SLVA blob (still **version 3**) can carry two optional trailing chunks after the index block,
gated by new flag bits. When absent, the blob is **byte-identical** to a chunk-less write — plain
meshes pay nothing. Old decoders ignore trailing bytes, so new blobs degrade gracefully to
untextured/uncolored rendering on un-upgraded clients.

```
// existing blob, unchanged …
indexCount(u32) | indices

// -- UV chunk (flags bit 3, FlagHasUvs = 0x8) --
uvFormat(u32)        // 0 = uint16 quantized, 1 = float32 raw
uvOrigin(2×f64)      // identity (0,0 / 1,1) for float32
uvScale(2×f64)
uvs                  // uint16[vtx*2] OR float32[vtx*2]; count implied by vertexCount

// -- color chunk (flags bit 4, FlagHasVertexColors = 0x10) --
colors               // uint8 rgb[vtx*3]; alpha not carried
```

- **UV quantization** mirrors positions: `uv = origin + q * scale` with unsigned q in [0, 65535]
  and `scale = extent / 65535`; delta+zigzag filtered per component iff `FlagDeltaEncoded` (0x4).
  Falls back to float32 (never filtered) when any axis' step exceeds `1/4096` (~16 tile repeats),
  keeping quantization error under a texel at 4K.
- **Colors** are delta+zigzag filtered per channel (wrapped 8-bit) iff `FlagDeltaEncoded` —
  analysis gradients compress to near nothing under the SLVZ DEFLATE pass.
- **Mixed batches:** if ANY mesh in a batch has a channel, the whole batch carries it with neutral
  fill (UV `0,0`, color white) for the rest. White multiplies to identity in three.js and a `uv`
  attribute is inert without a map, so rendering is unaffected; the fill deltas compress to ~0.
- **Emission gates (automatic):** UVs ship only when the mesh has a full `TextureCoordinates` set
  AND its ThreeMaterial has a `Map` (brep meshing auto-generates TCs — presence alone would
  inflate everything). Colors ship whenever the mesh has a full `VertexColors` set.
- **Welding:** when a channel is exported, `CombineIdentical` runs with `ignoreAdditional: false`
  (channels not being exported are cleared first) so texture seams / color boundaries keep their
  split vertices instead of smearing.

## Textures end-to-end

- `ThreeMaterial.Map` (JSON `map`, omitted when null) carries a texture reference; it participates
  in `MaterialCache` identity.
- The **Three Material** component's `Texture` input accepts a bitmap (PNG-encoded), an http(s)
  or data URL (passed through), or an image file path. Bitmap/file bytes are SHA-256
  content-hashed into the process-wide `TextureAssetStore` and served at
  `http://localhost:{port}/assets/{hash}` by `LocalWebServer` (CORS `*`, immutable caching; a
  dedicated server instance starts lazily on first registration, so dev mode works too). In
  headless mode (Rhino.Compute) bytes fall back to an inline data URI — a v1 compromise that
  re-ships per solve; a warning fires above 2 MB.
- `@selvajs/compute` decodes the chunks (`FLAG_HAS_UVS`/`FLAG_HAS_VERTEX_COLORS` in
  `binary-parser.ts`), sets `uv` / normalized `color` attributes in `batch-parser.ts`, enables
  `vertexColors` when the batch carries colors, and loads `map` URLs through a session-wide
  texture cache (`texture-cache.ts`) — hash-keyed URLs mean each texture fetches/decodes once no
  matter how many solves reference it.

## Component versioning

Both **Display** and **Three Material** were frozen (obsolete-copy pattern,
`OBSOLETE_*_UntilV0_15_0` + `IGH_UpgradeObject` to the new GUIDs) — existing `.gh` files keep the
old behavior until the user explicitly upgrades the components.

## Consumers / round-trip

- `BinaryGeometryReader` (C#) surfaces `Uvs`/`Colors`; `DisplayBatchTransformer` threads them back
  through re-encode so Move/Rotate/Scale/Morph preserve them; `WebDisplayPreview` re-applies
  vertex colors to viewport preview meshes.
- Release order is safe in either direction: the plugin can ship before the `@selvajs/compute`
  bump (old decoders skip the chunks). Textured rendering lands when the compute package
  publishes (changesets, beta pre-mode) and selva bumps the catalog in `pnpm-workspace.yaml`.

## Deferred

- Vertex alpha (RGBA) and multi-UV channels — new flag bits + chunks if ever needed.
- Out-of-band asset delivery for cloud mode (today: data-URI fallback).
- normalMap/roughnessMap etc. — same `map` pattern when needed.
