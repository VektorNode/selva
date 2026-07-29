---
'@selvajs/compute': patch
'@selvajs/selva': patch
'@selvajs/ui': patch
---

Update `rhino3dm` from 8.17.0 to 8.32.0.

No API surface used by Selva changed. The upgrade was verified by loading both
WASM modules side by side and diffing their runtime surfaces: `CommonObject.decode`,
`Point`, `Line`, `Curve.isPolyline`/`tryGetPolyline`, `getBoundingBox`, and the
emscripten `delete()`/`isDeleted()` lifecycle are all unchanged. 8.32.0 is a strict
superset — it adds `BrepLoop`/`BrepTrim` topology classes, SubD iterators,
`Material.setTexture`, and `Mesh.toThreejsBuffers`, none of which the current
pipeline uses. The 16 dropped top-level exports are emscripten internals
(`HEAPU8`, `_malloc`, `ready`) that nothing references.

Both documented runtime quirks the display-item parser works around still hold in
8.32.0, so the workarounds stay: `tryGetPolyline` returns the `Polyline` directly
rather than the `[ok, Polyline]` tuple its type declares, and `getBoundingBox`
takes no arguments at runtime despite its `.d.ts` signature.

The package still ships no `exports` field, so plugin-ui's
`rhino3dm/rhino3dm.wasm?url` Vite asset import keeps resolving; the emitted bundle
was confirmed byte-identical to the 8.32.0 WASM. One source-breaking type change
exists but is unused here — `File3dm.add*` methods (`addMesh`, `addCurve`, …) now
require a second `attributes` argument.
