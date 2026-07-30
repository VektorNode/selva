# `shared/` — the bottom layer

What every layer above has in common. Depends on nothing else in this package, so anything placed
here must stay free of scene, camera, renderer and controls concerns.

**This layer is internal.** Its barrel is the cross-layer import surface for `parse/`, `render/` and
`scene/`; it is not a published entrypoint (there is no `@selvajs/visualization/shared`). The parts
consumers need — `VisualizationError`/`ErrorCodes`, the logger seam, and the look vocabulary — are
re-exported from `render/`, which is the barrel a viewer host already imports.

## Contents

| File                  | Owns                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `errors.ts`           | `VisualizationError`, `ErrorCodes`                                        |
| `logger.ts`           | `getLogger`, `setLogger`, `enableDebugLogging`, the `Logger` interface    |
| `encoding.ts`         | `decodeBase64ToBinary`                                                    |
| `coordinate-frame.ts` | The Rhino↔Three frame. Both are Z-up, so `rhinoToThree` is the identity.  |
| `types.ts`            | `LOOKS`/`Look`, `LookPreset`, `MaterialAppearanceOptions`                 |
| `looks.ts`            | `LOOK_PRESETS`, `DEFAULT_LOOK`, `materialAppearanceForLook`               |
| `geometry.ts`         | `parseColor`, `applyOffset`, `computeCombinedBoundingBox`, the cache flag |

## Why errors, logging and base64 live here rather than coming from `@selvajs/compute`

They used to come from there, and that dependency was most of what stopped this package standing on
its own. None of the three is a compute concern:

- **`VisualizationError`** replaces `RhinoComputeError`, which mis-named the failure: on the plugin's
  WebSocket path a bad mesh blob never went near Rhino.Compute. The `code` values are deliberately
  identical to compute's so catch-sites matching on `error.code` are unaffected.
- **`getLogger`/`setLogger`** are a logging facility. It defaults to no-op (as compute's does); a
  host wanting one sink for both calls `setLogger(getLogger())` with compute's logger.
- **`decodeBase64ToBinary`** is a ~20-line copy of compute's, kept in sync by hand. Duplicating it
  is cheaper than the package dependency it used to buy. Its subtleties — WHATWG forgiving-base64
  normalization and the Node pool-slab copy — are why it is a copy and not a rewrite.

## Why the geometry/color utilities live here

`parse/` needs them (colors on materials, grounding and bounds on freshly built meshes) and `parse/`
must never import upward from `render/`. They are pure object math — no scene graph — so `shared/` is
their correct home rather than the render layer's `three-helpers`.

## Extension points

- **A new look** — add an entry to `LOOKS` and a matching `LOOK_PRESETS` record. `Look` derives from
  `LOOKS`, so the type and the enumerable list can't drift, and consumers iterating `LOOKS` (e.g. a
  style picker) pick it up automatically.
- A look carries **only** lighting/material dials — never edges or grid, which are independent
  overlays.
