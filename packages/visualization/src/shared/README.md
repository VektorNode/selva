# `shared/` — the bottom layer

What every layer above has in common. Depends on nothing else in this package, so anything placed
here must stay free of scene, camera, renderer and controls concerns.

## Contents

| File                  | Owns                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `coordinate-frame.ts` | The Rhino↔Three frame. Both are Z-up, so `rhinoToThree` is the identity.  |
| `types.ts`            | `LOOKS`/`Look`, `LookPreset`, `MaterialAppearanceOptions`                 |
| `looks.ts`            | `LOOK_PRESETS`, `DEFAULT_LOOK`, `materialAppearanceForLook`               |
| `geometry.ts`         | `parseColor`, `applyOffset`, `computeCombinedBoundingBox`, the cache flag |

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
