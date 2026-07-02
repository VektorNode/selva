---
'@selvajs/compute': minor
---

Optional UV / vertex-color channels and material textures for the SLVA mesh format.

- `parseBinaryMeshBatch` decodes the new trailing chunks (`FLAG_HAS_UVS` 0x8, `FLAG_HAS_VERTEX_COLORS` 0x10): quantized-or-float32 UVs are returned as absolute `Float32Array` pairs, colors as raw RGB bytes. Blobs without the chunks decode byte-for-byte as before (zero cost when absent).
- Mesh builders set `uv` and normalized `color` BufferAttributes on both the merged and per-mesh paths, sliced per mesh by `vertexStart`/`vertexCount`.
- `SerializableMaterial` gains an optional `map` texture URL; textures load through a session-wide URL-keyed cache (`clearTextureCache` exported for teardown) and `vertexColors` is enabled automatically when a batch carries colors.
