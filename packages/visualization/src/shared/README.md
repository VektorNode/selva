# `shared/` — the bottom layer

What every layer above has in common. Depends on nothing else in this package, so anything placed
here must stay free of scene, camera, renderer and controls concerns.

**This layer is internal.** Its barrel is the cross-layer import surface for `parse/`, `render/` and
`scene/`; it is not a published entrypoint (there is no `@selvajs/visualization/shared`). The parts
consumers need — `VisualizationError`/`ErrorCodes`, the logger seam, and the look vocabulary — are
re-exported from `render/`, which is the barrel a viewer host already imports.

## Contents

| File                  | Owns                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `errors.ts`           | `VisualizationError`, `ErrorCodes`                                                         |
| `logger.ts`           | `getLogger`, `setLogger`, `enableDebugLogging`, the `Logger` interface                     |
| `encoding.ts`         | `decodeBase64ToBinary`                                                                     |
| `coordinate-frame.ts` | The Rhino↔Three frame. Both are Z-up, so `rhinoToThree` is the identity.                   |
| `types.ts`            | `LOOKS`/`Look`, `LookPreset`, `MaterialAppearanceOptions`                                  |
| `looks.ts`            | `LOOK_PRESETS`, `DEFAULT_LOOK`, `materialAppearanceForLook`                                |
| `geometry.ts`         | `parseColor`, `applyOffset`, `computeCombinedBoundingBox`                                  |
| `gpu-ownership.ts`    | `canDispose*`/`protectMaterials`, the cache userdata flags, cache registry, `retainCaches` |
| `gpu-dispose.ts`      | `disposeMaterial`, `disposeObjectTree` — the only traversal that should free scene content |
| `gpu-capabilities.ts` | `publishMaxAnisotropy`, `observeMaxAnisotropy`                                             |

## Why errors, logging and base64 live here rather than coming from `@selvajs/compute`

None of the three is a compute concern, and that dependency was most of what stopped this package
standing on its own:

- **`VisualizationError`** replaces `RhinoComputeError`, which mis-named failures on paths (e.g. the
  plugin WebSocket) that never touch Rhino.Compute. `code` values match compute's so catch-sites are
  unaffected.
- **`getLogger`/`setLogger`** default to no-op, like compute's; a host wanting one sink calls
  `setLogger(getLogger())` with compute's logger.
- **`decodeBase64ToBinary`** is a ~20-line copy of compute's, kept in sync by hand — cheaper than the
  dependency it used to buy.

## Why the geometry/color and GPU-ownership utilities live here

`parse/` needs `geometry.ts` (colors, grounding, bounds) and must never import upward from `render/`.
`gpu-ownership.ts`/`gpu-dispose.ts`/`gpu-capabilities.ts` are the shared rules every disposal path
and cache in both `parse/` and `render/` obeys — see their docblocks for the ownership model.

## Extension points

A new look: add an entry to `LOOKS` and a matching `LOOK_PRESETS` record — `Look` derives from
`LOOKS`, so the type and the list can't drift. A look carries **only** lighting/material dials, never
edges or grid (independent overlays).
