---
'@selvajs/ui': patch
---

Drop the `rhino3dm` dependency. Curves now arrive pre-tessellated from the plugin, so the demo's
lazy WASM loader is gone and nothing in this package needs it. No public API change — the loader
lived in `src/demo/`, which is not exported.

The demo fixture's curve items carried openNURBS blobs that only rhino3dm could decode; they now
carry `points` baked with the same tessellation, so the demo renders identically.
