---
'@selvajs/visualization': major
---

Remove the deprecated no-ops left on the public surface. Nothing in this repo relied on their
behaviour — all three were already documented as inert.

- **`applyTransforms` is gone** from `MeshBatchParsingOptions` and `DisplayItemParseOptions`. Selva
  keeps one coordinate frame end to end — the Three scene _is_ Rhino's Z-up frame — so the flag
  never rotated anything. Drop it from call sites; geometry lands where it already landed.

  ```diff
  -parseMeshBatchBlob(blob, { mergeByMaterial: false, applyTransforms: true })
  +parseMeshBatchBlob(blob, { mergeByMaterial: false })
  ```

- **`ViewGizmo.update()` and `ViewGizmo.isAnimating` are gone.** The wrapper hit-tests the axis
  sprites and drives the camera controller directly, so it never animates: `update` was an empty
  function and `isAnimating` was hardcoded `false`. Both existed only to mirror three's `ViewHelper`
  shape. The per-frame `gizmo.update(delta)` call is removed from the animation loop.

- **`rhinoToThree` and `Vec3` are gone** from the internal `shared/` barrel, along with
  `disposeMaterialWithTextures` (an alias for `disposeMaterial`). None were reachable from a
  published entrypoint.
