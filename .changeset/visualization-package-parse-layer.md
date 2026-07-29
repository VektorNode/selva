---
'@selvajs/visualization': minor
'@selvajs/compute': major
'@selvajs/ui': patch
'@selvajs/selva': patch
---

Extract payload parsing into a new `@selvajs/visualization` package.

`@selvajs/compute` was doing two unrelated jobs: talking to Rhino.Compute, and turning the response
into Three.js objects. The second job is now its own package with documented layer boundaries
(`session → scene → render → parse → shared`, depending downward only), so a consumer can build
their own viewer over it and `compute` can head toward being pure solve/data.

This lands the bottom two layers — `shared/` and `parse/`. The Three.js _rendering_ toolkit
(`initThree`, camera, edges, grid, gizmo, measure) still ships from `@selvajs/compute/visualization`
and moves in a follow-up.

**Breaking — `@selvajs/compute`:**

- `@selvajs/compute/visualization` no longer exports the parsers. `getThreeMeshesFromComputeResponse`,
  `parseMeshBatch{,Object,Blob}`, `parseBinaryMeshBatch`, `parseDisplayItems`, the texture cache and
  their types now come from `@selvajs/visualization/parse`. The wire-format constants
  (`BINARY_MESH_MAGIC`, `FLAG_*`, `UV_FORMAT_*`) moved with them.
- `GrasshopperResponseProcessor.extractMeshesFromResponse()` is **removed**. It coupled the solve
  client to a renderer, which the new layering forbids. Its `response` and `debug` fields are now
  public, so call the parser directly:

  ```ts
  import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';

  const meshes = await getThreeMeshesFromComputeResponse(processor.response, { rhino });
  ```

- `initThree` no longer reaches into the texture cache itself. To keep color maps sharp at grazing
  angles, wire the new `onMaxAnisotropy` option to `setTextureAnisotropy`:

  ```ts
  import { setTextureAnisotropy } from '@selvajs/visualization/parse';

  initThree(canvas, { onMaxAnisotropy: setTextureAnisotropy });
  ```

  Omitted, textures keep three's default anisotropy of 1 — sharpness regresses, nothing breaks.

- `decodeBase64ToBinary` is now exported from the package root (the binary mesh parser needs it, and
  its forgiving-base64 normalization plus Node pool-slab copy are too subtle to duplicate).

**Also in this change:** the three largest parsers were split along the section seams they already
had — `batch-parser` 1007→466 lines (`batch/{metadata,materials,merge,assembly-worker}.ts`),
`binary-parser` 713→329 (`binary/{header,geometry,textures}.ts`), and `display-items-parser` 440→77
(`items/{curves,points,appearance}.ts`). Behavior is unchanged; all 108 parse tests moved with the
code and pass.
