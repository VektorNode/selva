# `@selvajs/visualization`

Framework-free (no Svelte, no runes); `three` is a peer dep. Four layers that **depend downward only**: `scene`, `render`, and `parse` are siblings (none imports another) and each may import `shared`. Each layer has its own barrel and README naming its extension points.

- `/scene`: `createSceneOutliner`: reads a scene (visibility/selection/layers), never owns content
- `/render`: `initThree` plus the CAD viewer toolkit (camera, edges, grid, gizmo, measure)
- `/parse`: backend payload → THREE meshes (`webdisplay`, `display-items`)
- `shared/`: **internal**: coordinate frame, look presets, errors, logging, geometry/color math. Not a published entrypoint; what consumers need is re-exported from `/render`.

**The public API is deliberately minimal: do not re-export a symbol just because it exists.** `initThree` owns the render toolkit and hands live instances back on `ThreeViewer`, so their factories stay unexported; `createSceneOutliner` composes the scene layer's parts; the SLVA binary wire format is private to `parseMeshBatch*`. Export handle _types_ so hosts can annotate, keep constructors internal. The root `.` entrypoint intentionally re-exports nothing; import from a layer.

**One seam must be preserved so a layer never depends upward:** `render/` takes an `onMaxAnisotropy` hook rather than calling into `parse/` (the host wires it to `setTextureAnisotropy` from `/parse`).
