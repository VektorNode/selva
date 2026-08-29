# `shared/` — the bottom layer

**Internal.** There is no `@selvajs/visualization/shared` entrypoint. This is what `parse/`,
`render/` and `scene/` have in common, and it depends on nothing else in the package — so anything
put here must stay free of scene, camera, renderer and controls concerns.

The parts consumers actually need — `VisualizationError`/`ErrorCodes`, the logger, and the look
vocabulary — are re-exported from `/render`, which a viewer host already imports.

## Contents

| File                  | Owns                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `errors.ts`           | `VisualizationError`, `ErrorCodes`                                                         |
| `logger.ts`           | `getLogger`, `setLogger`, `enableDebugLogging`, the `Logger` interface                     |
| `encoding.ts`         | `decodeBase64ToBinary`                                                                     |
| `types.ts`            | `LOOKS`/`Look`, `LookPreset`, `LookMaterialOverride`, `MaterialAppearanceOptions`          |
| `looks.ts`            | `LOOK_PRESETS`, `DEFAULT_LOOK`, `materialAppearanceForLook`                                |
| `geometry.ts`         | `parseColor`, `applyOffset`, `computeCombinedBoundingBox`                                  |
| `gpu-ownership.ts`    | `canDisposeMaterial`, `protectMaterials` — the module-singleton claim                      |
| `gpu-dispose.ts`      | `disposeMaterial`, `disposeObjectTree` — the only traversal that should free scene content |
| `gpu-capabilities.ts` | `publishMaxAnisotropy`, `observeMaxAnisotropy`                                             |

## Why these live here

**Errors, logging, base64.** None is a compute concern, and importing them from `@selvajs/compute`
was most of what stopped this package standing on its own. Per-file rationale is in the file headers.

**Geometry/colour helpers.** `parse/` needs colours, grounding and bounds, and must never import
upward from `render/`.

**GPU helpers.** Every disposal path in both `parse/` and `render/` obeys the same ownership rules;
`gpu-ownership.ts`'s docblock has the model.

## Adding a look

Add an entry to `LOOKS` and a matching record in `LOOK_PRESETS` — `Look` derives from `LOOKS`, so the
type and the list can't drift. A look carries **only** lighting and material dials, never edges or
grid: those are independent overlays. `lineart` is the one look that is incomplete without edges,
and it says so with `requiresEdges` rather than reaching for the overlay — honouring that flag is
the host's job.

A look that repaints the geometry (as `arctic`, `xray`, `lineart` and `wireframe` do) sets
`materialOverride`. `setLook`
snapshots each material's parsed values before the first override and restores them when switching
back to a look without one, so the model's own colours survive the round trip. A host that re-solves
must call `setLook` again: the new meshes arrive wearing the parser's materials.
