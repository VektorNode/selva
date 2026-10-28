---
'@selvajs/visualization': minor
'@selvajs/ui': patch
---

Parsing a mesh batch whose geometry is byte-identical to an earlier one reuses its `BufferGeometry` and extracted edges, so a solve that only changed materials, names or layers neither re-decodes the scene nor uploads it to the GPU again. The cache owns those geometries: `updateScene` frees the GPU copy of every cached geometry the new scene doesn't draw, so switching back to a cached variant costs an upload but no decode. New `clearGeometryCache()` from `/parse` empties the cache; `Viewer` calls it when it is destroyed.

Merging by material now gathers every group of a material, wherever it sits in the batch, into one mesh. The plugin keeps meshes in input order, so a material can head several groups.
