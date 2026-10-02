---
'@selvajs/visualization': patch
---

Fix shading and aliasing artifacts on sheet-metal models. Normals are recomputed from a full weld, area-weighted and split at creases sharper than 30°, so faces welded across a fold no longer smear into streaks around holes, and identical parts shade alike however the writer welded their seams. Closed-solid detection welds seam copies that float32 rounding left a step or two apart, so closed Breps are culled reliably. With ambient occlusion on, the scene renders with 4× MSAA below 2× DPR and at the full pixel ratio (`aoPixelRatio` now caps only the AO buffers), removing dashed highlights, jagged silhouettes and HiDPI blur. The dynamic near plane measures triangles clipped to the view, so a large mesh beside the camera no longer pins it to the floor.
