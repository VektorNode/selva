---
'@selvajs/visualization': minor
---

Decode SLVA v4 mesh blobs, which shrink display payloads 28–50% on typical geometry

The plugin's mesh writer gained a fourth wire-format version that stores its delta-filtered
vertex, index and UV streams as byte planes (all X deltas, then Y, then Z, low bytes before
high) instead of interleaving them. Near-zero deltas turn the high planes into runs of zeros,
so the DEFLATE pass that follows compresses far better: measured on blobs produced by the real
writer, a welded 65k-vertex surface drops from 144 KB to 104 KB (−28%), a 262k-vertex surface
from 636 KB to 409 KB (−36%), and a 3000-part CAD scatter from 116 KB to 58 KB (−50%). Cloud
delivery multiplies each saving by 1.33× because the payload is base64-encoded.

The layout is chosen per blob and flagged in the header — the plugin measures both and keeps the
smaller, since batches made mostly of byte-identical repeated parts compress better interleaved.
So this parser now handles both v4 layouts plus every earlier version; blobs persisted by older
plugins (saved `.gh` files, `.slvm` mesh files, cached compute results) decode unchanged, pinned
by frozen pre-v4 golden fixtures on both stacks.

Decoding is slightly faster than before, despite the extra plane merge, because there is less to
inflate. `parseBinaryMeshBatchRaw` gains `planarByteSplit` and `uint16Indices` on its result, and
`AssemblyInput` requires them — both are internal wire-level surfaces.
