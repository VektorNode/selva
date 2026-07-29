---
'@selvajs/visualization': minor
'@selvajs/compute': major
'@selvajs/ui': patch
'@selvajs/selva': patch
---

Extract parsing and rendering into a new `@selvajs/visualization` package.

`@selvajs/compute` was doing two unrelated jobs: talking to Rhino.Compute, and turning the response
into Three.js objects. The second job is now its own package with documented layer boundaries
(`session → scene → render → parse → shared`, depending downward only), so a consumer can build
their own viewer over it.

This lands the bottom three layers — `shared/`, `parse/` and `render/`. **`@selvajs/compute` no
longer depends on `three` in any form** (peer dep and dev deps both gone); it is now pure
solve/data. `scene/` and `session/` still live in `@selvajs/ui` and move in a follow-up.

**Breaking — `@selvajs/compute`:**

- **`@selvajs/compute/visualization` is removed entirely.** Everything it exported now lives in
  `@selvajs/visualization`:

  | Was                                                                                                                                                                                                   | Now                                                               |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
  | `initThree`, `updateScene`, camera, grid, gizmo, edges, labels, measure, render pipeline, materials, up-axis helpers                                                                                  | `@selvajs/visualization/render`                                   |
  | `getThreeMeshesFromComputeResponse`, `parseMeshBatch{,Object,Blob}`, `parseBinaryMeshBatch`, `parseDisplayItems`, texture cache, wire-format constants (`BINARY_MESH_MAGIC`, `FLAG_*`, `UV_FORMAT_*`) | `@selvajs/visualization/parse`                                    |
  | `LOOKS`, `Look`, `parseColor`, `applyOffset`, `computeCombinedBoundingBox`                                                                                                                            | `@selvajs/visualization/shared` (also re-exported from `/render`) |

- `GrasshopperResponseProcessor.extractMeshesFromResponse()` is **removed**. It coupled the solve
  client to a renderer, which the new layering forbids. Its `response` and `debug` fields are now
  public, so call the parser directly:

  ```ts
  import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';

  const meshes = await getThreeMeshesFromComputeResponse(processor.response, { rhino });
  ```

- `initThree` no longer reaches into the texture cache itself — `render/` must not import `parse/`.
  To keep color maps sharp at grazing angles, wire the new `onMaxAnisotropy` option:

  ```ts
  import { setTextureAnisotropy } from '@selvajs/visualization/parse';

  initThree(canvas, { onMaxAnisotropy: setTextureAnisotropy });
  ```

  Omitted, textures keep three's default anisotropy of 1 — sharpness regresses, nothing breaks.

- `decodeBase64ToBinary` is now exported from the package root (the binary mesh parser needs it, and
  its forgiving-base64 normalization plus Node pool-slab copy are too subtle to duplicate).

**Also in this change:** the five largest files were split along the seams they already had, with no
behavior change. `three-initializer` 1743→407 (`scene-setup/*`, 14 files — the `ThreeViewer` handle,
the postprocessing pipeline and the runtime appearance setters each became their own module),
`edges` 874→233 (`edges/{options,extraction,cache,overlay}.ts`), `batch-parser` 1007→466
(`batch/{metadata,materials,merge,assembly-worker}.ts`), `binary-parser` 713→329
(`binary/{header,geometry,textures}.ts`), `display-items-parser` 440→77
(`items/{curves,points,appearance}.ts`). All 288 tests moved with the code and pass.
