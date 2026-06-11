---
'@selvajs/ui': patch
---

Expose `Viewer` and its `ViewerConfig` type from the published public API so external applications can embed the standalone 3D viewer directly (driven by a `meshes` array and an optional `viewerConfig`), without going through `ComputeApp`.
