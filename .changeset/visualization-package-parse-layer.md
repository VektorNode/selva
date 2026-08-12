---
'@selvajs/visualization': minor
'@selvajs/compute': major
'@selvajs/ui': minor
'@selvajs/selva': patch
---

Extract parsing and rendering into a new `@selvajs/visualization` package.

`@selvajs/compute` was doing two unrelated jobs: talking to Rhino.Compute, and turning the response
into Three.js objects. The second job is now its own package with documented layer boundaries
(`session → scene → render → parse → shared`, depending downward only), so a consumer can build
their own viewer over it.

This lands all five layers — `shared/`, `parse/`, `render/`, `scene/` and `session/`.
**`@selvajs/compute` no longer depends on `three` in any form** (peer dep and dev deps both gone);
it is now pure solve/data, and `@selvajs/ui` keeps only the Svelte shells plus the design system.

**Fixed — hiding an object in the viewer now survives a solve.**

Hiding a mesh in the scene manager and then changing an input brought it straight back: a solve
discards all scene content and rebuilds it, and hidden state was keyed on the per-instance
`THREE.Object3D.uuid`, which does not survive that. It is now keyed on the object's Grasshopper
identity (`sourceComponentId` + `originalIndex`, or a display item's `id`, falling back to
name+layer for content from older plugin versions), so it survives any number of solves. Hiding is
also remembered when a definition edit stops producing that geometry — if it comes back, it comes
back hidden.

**New in `@selvajs/visualization` — `@selvajs/visualization/scene`:**

The viewer's object list is no longer trapped in a Svelte component. `createSceneOutliner` answers
the questions any presentation of a scene has to answer — which children are content rather than
cameras/lights/grid, how they group by layer, what is hidden, what is selected — with no DOM:

```ts
import { createSceneOutliner } from '@selvajs/visualization/scene';

const outliner = createSceneOutliner(scene);
outliner.searchQuery = 'wall';
outliner.layerGroups(); // Map<layerName, Object3D[]>, search-filtered
outliner.toggleObject(mesh); // follows a multi-selection
outliner.select(uuid, { shiftKey, toggleKey });
```

It **reads** the scene and toggles `.visible`; `updateScene` remains the sole owner of scene
contents. Its mutable state is injectable, so a Svelte host passes `SvelteSet`s and gets reactivity
without any subscribe/emit machinery:

```ts
createSceneOutliner(scene, { sets: { hidden, selected, collapsed } });
```

Hosts driving their own viewer must call `outliner.applyTo()` after each solve to re-apply hidden
state to the rebuilt content — `<Viewer>` does this for you.

`getSceneObjects`, `groupByLayer`, `filterLayerGroups`, `isSceneContent` and the visibility/selection
state machines are exported individually for consumers that want the parts, not the composition.

**New in `@selvajs/ui` — `useSolveSession`:**

The Solve Session moved to `@selvajs/visualization/session` and is now framework-free: its state
reads through plain getters plus a `subscribe()` seam, so it can drive a headless solve with no
Svelte in the picture. In a component, use the new binding instead of the raw factory — it
subscribes once and republishes as rune state, which is what keeps `session.values`/`meshes` live
in markup:

```ts
import { useSolveSession } from '@selvajs/ui';

const driver = createRequestResponseDriver(onSolve, () => session, {
	// `isSolving` lives on the driver, which the session can't observe — republish it.
	onChange: () => session.notify()
});
const session = useSolveSession({ schema, scopeKey, driver });
```

Calling `createSolveSession` directly in a component still compiles and returns correct values, but
nothing re-renders. `@selvajs/ui` re-exports it (plus `SolveDriver`, `SolveReporter`, `SolveFn`,
`SolveResult` and the `external/storage` helpers) from its new home, so existing imports from
`@selvajs/ui` and `@selvajs/ui/external` keep working unchanged.

**Breaking — `@selvajs/compute`:**

- **`@selvajs/compute/visualization` is removed entirely.** Everything it exported now lives in
  `@selvajs/visualization`:

  | Was                                                                                                                                                                                                   | Now                                                                         |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
  | `initThree`, `updateScene`, camera, grid, gizmo, edges, labels, measure, render pipeline, materials, up-axis helpers                                                                                  | `@selvajs/visualization/render`                                             |
  | `getThreeMeshesFromComputeResponse`, `parseMeshBatch{,Object,Blob}`, `parseBinaryMeshBatch`, `parseDisplayItems`, texture cache, wire-format constants (`BINARY_MESH_MAGIC`, `FLAG_*`, `UV_FORMAT_*`) | `@selvajs/visualization/parse`                                              |
  | `LOOKS`, `Look`, `parseColor`, `applyOffset`, `computeCombinedBoundingBox`                                                                                                                            | `@selvajs/visualization/shared` (also re-exported from `/render`)           |
  | `createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`, `SolveFn`, `SolveResult`, `createComputeThrottle`, `createSolveMemo`, the `external/storage` helpers             | `@selvajs/visualization/session` (all still re-exported from `@selvajs/ui`) |

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
(`items/{curves,points,appearance}.ts`), the session's driver split out into
`session/drivers/{driver,request-response}.ts`, and `SceneManager.svelte` 319→234 (its logic now in
`scene/`). 425 tests pass.
