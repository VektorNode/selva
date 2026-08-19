# @selvajs/visualization

## 1.0.1

### Patch Changes

- e782803: chore(deps): bump the npm group across 1 directory with 12 updates

## 1.0.0

### Major Changes

- 4512068: Curves arrive pre-tessellated. rhino3dm is gone from this package entirely — no dependency, no
  optional decode path, nothing in the browser that reads Rhino geometry.

  `DisplayCurve.points` (flat `[x,y,z, …]`, Rhino's Z-up frame) is now **required**, and
  `DisplayCurve.json` is deleted. The plugin tessellates; `items/curves.ts` builds the `Line2`
  straight from the result.

  **Removed — all of these were the rhino3dm fallback:**

  - `MeshExtractionOptions.rhino` and `MeshExtractionOptions.loadRhino`
  - `DisplayItemParseOptions` in its entirety — `parseDisplayItems(items)` now takes one argument
  - `DisplayCurve.json`

  ```diff
  -getThreeMeshesFromComputeResponse(response, { rhino: await loadRhino() })
  +getThreeMeshesFromComputeResponse(response)

  -parseDisplayItems(items, { rhino })
  +parseDisplayItems(items)
  ```

  **A curve without `points` now throws `VisualizationError` instead of rendering.** It means the
  definition was solved by a Display component predating backend tessellation, and the message says
  so — upgrade it in Grasshopper (Solution → Upgrade obsolete components) and re-save. Skipping was
  the wrong call: a scene quietly missing its curves is indistinguishable from a definition that has
  none, so the failure had to be loud enough to act on. The throw aborts the batch; every other
  unrenderable item is still logged and skipped.

- 4512068: The solve session moves out of `@selvajs/visualization` into `@selvajs/solve/client`.

  `@selvajs/visualization` is now **mesh conversion + viewer, and nothing else**. The session was a
  schema-driven form state machine that typed meshes as `unknown` and never inspected one — its
  presence was why the package couldn't be described in a sentence. With it gone the package also
  drops its last Selva dependency (`@selvajs/schemas`), so every sub-path needs only `three`,
  `rhino3dm` and `fflate`.

  **Breaking — `@selvajs/visualization`:**

  - **The `/session` sub-path export is removed.** Import from `@selvajs/solve/client` instead
    (`createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`,
    `createSolveMemo`, `stableInputKey`, the external-input storage helpers, the pure
    `solve-session-core` transitions). `SolveFn`/`SolveResult` come from `@selvajs/solve/shared`.
  - The root barrel no longer re-exports any of the above.
  - `@selvajs/ui` re-exports all of it unchanged, so hosts importing from `@selvajs/ui` or
    `@selvajs/ui/public` need no edit.

  **Renamed — `createComputeThrottle` → `createAsyncThrottle`** (`isComputing` → `isRunning`). It is
  generic over `T`, takes any `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute
  nor HTTP nor geometry — plugin-ui drives it over a WebSocket. The old name said "compute" only
  because of where the file happened to live.

  **Mesh ownership is now injected, not assumed.** `SolveResult<TMesh>` is opaque and the result memo
  no longer imports `three`; the clone/dispose rules are a `MeshPolicy` passed in. The three.js
  implementation is `meshPolicy`, newly exported from `@selvajs/visualization/parse`:

  ```ts
  import { meshPolicy } from '@selvajs/visualization/parse';
  const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
  ```

  `ComputeApp` wires this for you. A custom driver must pass it, or a memo hit will serve geometry the
  viewer already disposed. `createSolveMemo(max)` accordingly becomes
  `createSolveMemo({ max, meshPolicy })`.

  **Fixed while extracting it:** the memo's mesh clone copied `geometry.userData` **by reference**, so
  a cloned geometry shared the cross-solve geometry cache's ownership flag. `clearScene` skips flagged
  geometries (the cache disposes those itself), which meant nothing ever freed the memo's clones. The
  clone now copies `userData` before dropping the flag, and `releaseSceneObjects` refuses to dispose
  genuinely cache-owned geometry.

- 4512068: Remove the deprecated no-ops left on the public surface. Nothing in this repo relied on their
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

- 4512068: Trim the public API to what consumers actually need. The package exported ~110 symbols across five
  entrypoints while consumers used 23 — the surface described the package's file layout rather than
  its contract, and every re-exported internal was a compatibility promise nobody had asked for.

  Nothing in this repo imported a removed symbol; the four in-repo consumers (`@selvajs/ui`,
  `@selvajs/plugin-ui`, `@selvajs/selva`, plus tests) are unchanged.

  ## Breaking — removed entrypoints

  **1. `@selvajs/visualization/shared` is gone.** It is now the internal cross-layer import surface.
  What consumers need is re-exported from `/render`:

  ```diff
  -import { setLogger, VisualizationError, LOOKS } from '@selvajs/visualization/shared';
  +import { setLogger, VisualizationError, LOOKS } from '@selvajs/visualization/render';
  ```

  `parseColor`, `applyOffset`, `computeCombinedBoundingBox`, `rhinoToThree`, `decodeBase64ToBinary`,
  `Vec3` and `CACHED_GEOMETRY_USERDATA_FLAG` are no longer public.

  **2. The root `.` entrypoint re-exports nothing.** It was `export *` over all four layers, which
  defeated the sub-path split. Import from the layer you need — the layering is now enforced by the
  import graph rather than merely documented.

  ```diff
  -import { initThree } from '@selvajs/visualization';
  +import { initThree } from '@selvajs/visualization/render';
  ```

  ## Breaking — `/render`

  `initThree` already owns the toolkit: it builds the camera controller, grid, gizmo, measure tool,
  render pipeline and near-plane fitter from `ThreeInitializerOptions` and returns the live instances
  on `ThreeViewer`. Their factories are no longer exported — configure through the options, reach
  through the viewer (`viewer.grid`, `viewer.measureTool`, `viewer.applyEdges`/`clearEdges`, …).

  Removed: `createCameraController`, `createGrid`, `createViewGizmo`, `createMeasureTool`,
  `snapToVertex`, `createRenderPipeline`, `createLabelLayer`, `createNearPlaneFitter`,
  `EdgeDetectionPass`, `addEdges`, `addEdgesAsync`, `removeEdges`, `isEdgeOverlay`,
  `EDGE_USERDATA_KIND`, `EDGES_SKIPPED_TRIANGLE_CAP`, `applyDefaults`,
  `disposeMaterialWithTextures`, `clearScene`, `computeContentBounds`, the `Materials` namespace, the
  `up-axis` helpers (`buildUpBasis`, `environmentRotationFor`, `isoOffset`, `sunOffset`, `upToAxis`),
  and the types `GridOptions`, `EdgeOptions`, `MeasureOptions`, `RenderPipeline`,
  `RenderPipelineOptions`, `EdgeDetectionOptions`, `LabelLayer`, `LabelHandle`, `NearPlaneFitter`,
  `ResolvedOptions`, `UpBasis`.

  Kept: `initThree`, `updateScene`, `ThreeViewer`, the full `ThreeInitializerOptions` config surface,
  the handle types (`CameraController`, `CameraProjection`, `ViewPreset`, `Grid`, `ViewGizmo`,
  `MeasureTool`), and — newly surfaced here — the errors, logger seam and look vocabulary.

  ## Breaking — `/parse`

  The SLVA binary wire format is now private to `parseMeshBatch*`; it is an implementation detail that
  changes without a major bump. Removed: `parseBinaryMeshBatch`, `BINARY_MESH_MAGIC`,
  `COMPRESSED_MESH_MAGIC`, `BINARY_MESH_VERSION`, `MIN_SUPPORTED_VERSION`, all `FLAG_*` and
  `UV_FORMAT_*` constants, `BinaryMeshMetadata`, `ParsedBinaryMeshBatch`.

  Also removed: `parseMeshBatch` (use `parseMeshBatchObject` / `parseMeshBatchBlob`),
  `cloneSceneObjects` / `releaseSceneObjects` (reach them as `meshPolicy.clone` / `.release`),
  `clearTextureCache`, `TEXTURE_CACHE_MAX_ENTRIES`, and the deprecated `MeshBatch` alias — use
  `DisplayBatch`.

  `setTextureAnisotropy` stays: it is the host's half of the `onMaxAnisotropy` seam that keeps
  `render/` from importing `parse/`.

  ## Breaking — `/scene`

  `createSceneOutliner` composes this layer, so its parts are no longer exported individually — reach
  them via `outliner.visibility` / `.selection` / `.layerGroups()`. Removed: `HELPER_IDS`,
  `isSceneContent`, `getSceneObjects`, `prettyType`, `DEFAULT_LAYER`, `groupByLayer`,
  `filterLayerGroups`, `getStableKey`, `createVisibilityState`, `createSelectionState`.

  Kept: `createSceneOutliner`, `SceneOutliner`, `SceneOutlinerOptions`, the state handle types
  (`VisibilityState`, `SelectionState`, `SelectionModifiers`), and the helpers a host needs while
  rendering an outliner row — `getObjectLabel`, `getTypeLabel`, `getTrackingKey`.

### Minor Changes

- 4512068: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

- 4512068: Viewer app seam: host apps can now own scene content and pointer input.

  - `initThree` returns a `tools` registry. Register a `PointerTool` and it competes for canvas
    clicks ahead of object selection, ordered by priority; `setActive` enforces one active tool.
    Measure and the view gizmo are pre-registered as `'measure'` and `'gizmo'`.
  - `addUserGeometry(object, appId?)` takes an owner id, tagging `userData.source = 'app:<id>'`, and
    `clearUserGeometry(appId?)` clears one app's geometry instead of everything. Untagged `'user'`
    geometry keeps working as before. `clearScene` spares both, so host content survives a solve.
  - `labelLayer` is on `ThreeViewer` and always built. It was previously created only when
    `measure.enabled`, leaving other annotation consumers with no way to reach one.
  - `pickThreshold` and `snapToVertex` are public, so a host tool's grab band and vertex snapping
    match the built-in tools instead of drifting from them.

  No new tools ship here — apps bring their own. See `src/render/VIEWER-APPS.md`.

- 4512068: Extract parsing and rendering into a new `@selvajs/visualization` package.

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

- 4512068: `@selvajs/visualization` no longer depends on `@selvajs/compute`.

  Mesh conversion and the viewer now work for a consumer who has neither Selva nor Rhino.Compute:
  `shared/`, `parse/`, `render/` and `scene/` need only `three`, `rhino3dm` and `fflate`. Four things
  moved in-package:

  - **`VisualizationError` replaces `RhinoComputeError`** in the parse layer. The old name described a
    transport the failure had nothing to do with — on the plugin's WebSocket path a corrupt mesh blob
    never went near Rhino.Compute. **The `code` values are unchanged** (`VALIDATION_ERROR`,
    `INVALID_STATE`, `ENVIRONMENT_ERROR`), so catch-sites matching on `error.code` keep working; only
    code matching on `instanceof RhinoComputeError` or `error.name` needs updating.
  - **A local logger** (`getLogger`/`setLogger`/`enableDebugLogging` from
    `@selvajs/visualization/render`). It defaults to no-op, exactly as compute's does, so output is
    unchanged. For one sink across both packages:

    ```ts
    import { setLogger } from '@selvajs/visualization/render';
    import { getLogger } from '@selvajs/compute';

    setLogger(getLogger());
    ```

  - **A local `decodeBase64ToBinary`**, copied from compute rather than imported.
  - **The Grasshopper response envelope is now declared structurally** as `DisplayComputeResponse`
    (exported from `@selvajs/visualization/parse`) — only the fields the parser actually reads.
    `getThreeMeshesFromComputeResponse` is otherwise unchanged and compute's
    `GrasshopperComputeResponse` stays assignable to it, so existing calls need no edit.

  The package now depends on nothing from Selva at all: the solve session, which was the one part
  still reaching for `@selvajs/schemas`, has moved to `@selvajs/solve/client`.

### Patch Changes

- 4512068: Fix `initThree`'s `edges` options being silently dropped: `maxTriangles`, `maxSegments` and
  `screenSpaceFallback` never reached the edge pipeline.

  All three are documented on `EdgesConfig` and read at runtime — `applyEdges` forwards the two caps to
  `addEdgesAsync`, and `updateEdgeFallback` checks `screenSpaceFallback` before switching the
  screen-space edge pass on. But `applyDefaults` never copied them out of the caller's options, so they
  resolved to `undefined` on every viewer: the triangle cap was pinned to its 4M default (a host could
  neither lower it to protect a weak GPU nor raise it), and `screenSpaceFallback: false` did nothing.

  `ResolvedOptions` is `Required<>` only at the top level, so `edges` kept `EdgesConfig`'s optional
  members and the omission type-checked. `applyDefaults` now passes the three through — left
  `undefined` when unset, so `resolveOptions` in `edges/options.ts` stays the single owner of the 4M /
  2M defaults instead of a second copy free to drift. A regression test asserts every `EdgesConfig` key
  survives resolution.

  Found by GPU-verifying the screen-space edge pass in a real browser, which no unit test can cover.

- 4512068: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

## 1.0.0-beta.4

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

## 1.0.0-beta.3

### Minor Changes

- d747039: Viewer app seam: host apps can now own scene content and pointer input.

  - `initThree` returns a `tools` registry. Register a `PointerTool` and it competes for canvas
    clicks ahead of object selection, ordered by priority; `setActive` enforces one active tool.
    Measure and the view gizmo are pre-registered as `'measure'` and `'gizmo'`.
  - `addUserGeometry(object, appId?)` takes an owner id, tagging `userData.source = 'app:<id>'`, and
    `clearUserGeometry(appId?)` clears one app's geometry instead of everything. Untagged `'user'`
    geometry keeps working as before. `clearScene` spares both, so host content survives a solve.
  - `labelLayer` is on `ThreeViewer` and always built. It was previously created only when
    `measure.enabled`, leaving other annotation consumers with no way to reach one.
  - `pickThreshold` and `snapToVertex` are public, so a host tool's grab band and vertex snapping
    match the built-in tools instead of drifting from them.

  No new tools ship here — apps bring their own. See `src/render/VIEWER-APPS.md`.

## 1.0.0-beta.2

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

## 1.0.0-beta.1

### Major Changes

- 9f60b66: Curves arrive pre-tessellated. rhino3dm is gone from this package entirely — no dependency, no
  optional decode path, nothing in the browser that reads Rhino geometry.

  `DisplayCurve.points` (flat `[x,y,z, …]`, Rhino's Z-up frame) is now **required**, and
  `DisplayCurve.json` is deleted. The plugin tessellates; `items/curves.ts` builds the `Line2`
  straight from the result.

  **Removed — all of these were the rhino3dm fallback:**

  - `MeshExtractionOptions.rhino` and `MeshExtractionOptions.loadRhino`
  - `DisplayItemParseOptions` in its entirety — `parseDisplayItems(items)` now takes one argument
  - `DisplayCurve.json`

  ```diff
  -getThreeMeshesFromComputeResponse(response, { rhino: await loadRhino() })
  +getThreeMeshesFromComputeResponse(response)

  -parseDisplayItems(items, { rhino })
  +parseDisplayItems(items)
  ```

  **A curve without `points` now throws `VisualizationError` instead of rendering.** It means the
  definition was solved by a Display component predating backend tessellation, and the message says
  so — upgrade it in Grasshopper (Solution → Upgrade obsolete components) and re-save. Skipping was
  the wrong call: a scene quietly missing its curves is indistinguishable from a definition that has
  none, so the failure had to be loud enough to act on. The throw aborts the batch; every other
  unrenderable item is still logged and skipped.

## 1.0.0-beta.0

### Major Changes

- 8b2c168: The solve session moves out of `@selvajs/visualization` into `@selvajs/solve/client`.

  `@selvajs/visualization` is now **mesh conversion + viewer, and nothing else**. The session was a
  schema-driven form state machine that typed meshes as `unknown` and never inspected one — its
  presence was why the package couldn't be described in a sentence. With it gone the package also
  drops its last Selva dependency (`@selvajs/schemas`), so every sub-path needs only `three`,
  `rhino3dm` and `fflate`.

  **Breaking — `@selvajs/visualization`:**

  - **The `/session` sub-path export is removed.** Import from `@selvajs/solve/client` instead
    (`createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`,
    `createSolveMemo`, `stableInputKey`, the external-input storage helpers, the pure
    `solve-session-core` transitions). `SolveFn`/`SolveResult` come from `@selvajs/solve/shared`.
  - The root barrel no longer re-exports any of the above.
  - `@selvajs/ui` re-exports all of it unchanged, so hosts importing from `@selvajs/ui` or
    `@selvajs/ui/public` need no edit.

  **Renamed — `createComputeThrottle` → `createAsyncThrottle`** (`isComputing` → `isRunning`). It is
  generic over `T`, takes any `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute
  nor HTTP nor geometry — plugin-ui drives it over a WebSocket. The old name said "compute" only
  because of where the file happened to live.

  **Mesh ownership is now injected, not assumed.** `SolveResult<TMesh>` is opaque and the result memo
  no longer imports `three`; the clone/dispose rules are a `MeshPolicy` passed in. The three.js
  implementation is `meshPolicy`, newly exported from `@selvajs/visualization/parse`:

  ```ts
  import { meshPolicy } from '@selvajs/visualization/parse';
  const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
  ```

  `ComputeApp` wires this for you. A custom driver must pass it, or a memo hit will serve geometry the
  viewer already disposed. `createSolveMemo(max)` accordingly becomes
  `createSolveMemo({ max, meshPolicy })`.

  **Fixed while extracting it:** the memo's mesh clone copied `geometry.userData` **by reference**, so
  a cloned geometry shared the cross-solve geometry cache's ownership flag. `clearScene` skips flagged
  geometries (the cache disposes those itself), which meant nothing ever freed the memo's clones. The
  clone now copies `userData` before dropping the flag, and `releaseSceneObjects` refuses to dispose
  genuinely cache-owned geometry.

- 46327d9: Remove the deprecated no-ops left on the public surface. Nothing in this repo relied on their
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

- 49cac15: Trim the public API to what consumers actually need. The package exported ~110 symbols across five
  entrypoints while consumers used 23 — the surface described the package's file layout rather than
  its contract, and every re-exported internal was a compatibility promise nobody had asked for.

  Nothing in this repo imported a removed symbol; the four in-repo consumers (`@selvajs/ui`,
  `@selvajs/plugin-ui`, `@selvajs/selva`, plus tests) are unchanged.

  ## Breaking — removed entrypoints

  **1. `@selvajs/visualization/shared` is gone.** It is now the internal cross-layer import surface.
  What consumers need is re-exported from `/render`:

  ```diff
  -import { setLogger, VisualizationError, LOOKS } from '@selvajs/visualization/shared';
  +import { setLogger, VisualizationError, LOOKS } from '@selvajs/visualization/render';
  ```

  `parseColor`, `applyOffset`, `computeCombinedBoundingBox`, `rhinoToThree`, `decodeBase64ToBinary`,
  `Vec3` and `CACHED_GEOMETRY_USERDATA_FLAG` are no longer public.

  **2. The root `.` entrypoint re-exports nothing.** It was `export *` over all four layers, which
  defeated the sub-path split. Import from the layer you need — the layering is now enforced by the
  import graph rather than merely documented.

  ```diff
  -import { initThree } from '@selvajs/visualization';
  +import { initThree } from '@selvajs/visualization/render';
  ```

  ## Breaking — `/render`

  `initThree` already owns the toolkit: it builds the camera controller, grid, gizmo, measure tool,
  render pipeline and near-plane fitter from `ThreeInitializerOptions` and returns the live instances
  on `ThreeViewer`. Their factories are no longer exported — configure through the options, reach
  through the viewer (`viewer.grid`, `viewer.measureTool`, `viewer.applyEdges`/`clearEdges`, …).

  Removed: `createCameraController`, `createGrid`, `createViewGizmo`, `createMeasureTool`,
  `snapToVertex`, `createRenderPipeline`, `createLabelLayer`, `createNearPlaneFitter`,
  `EdgeDetectionPass`, `addEdges`, `addEdgesAsync`, `removeEdges`, `isEdgeOverlay`,
  `EDGE_USERDATA_KIND`, `EDGES_SKIPPED_TRIANGLE_CAP`, `applyDefaults`,
  `disposeMaterialWithTextures`, `clearScene`, `computeContentBounds`, the `Materials` namespace, the
  `up-axis` helpers (`buildUpBasis`, `environmentRotationFor`, `isoOffset`, `sunOffset`, `upToAxis`),
  and the types `GridOptions`, `EdgeOptions`, `MeasureOptions`, `RenderPipeline`,
  `RenderPipelineOptions`, `EdgeDetectionOptions`, `LabelLayer`, `LabelHandle`, `NearPlaneFitter`,
  `ResolvedOptions`, `UpBasis`.

  Kept: `initThree`, `updateScene`, `ThreeViewer`, the full `ThreeInitializerOptions` config surface,
  the handle types (`CameraController`, `CameraProjection`, `ViewPreset`, `Grid`, `ViewGizmo`,
  `MeasureTool`), and — newly surfaced here — the errors, logger seam and look vocabulary.

  ## Breaking — `/parse`

  The SLVA binary wire format is now private to `parseMeshBatch*`; it is an implementation detail that
  changes without a major bump. Removed: `parseBinaryMeshBatch`, `BINARY_MESH_MAGIC`,
  `COMPRESSED_MESH_MAGIC`, `BINARY_MESH_VERSION`, `MIN_SUPPORTED_VERSION`, all `FLAG_*` and
  `UV_FORMAT_*` constants, `BinaryMeshMetadata`, `ParsedBinaryMeshBatch`.

  Also removed: `parseMeshBatch` (use `parseMeshBatchObject` / `parseMeshBatchBlob`),
  `cloneSceneObjects` / `releaseSceneObjects` (reach them as `meshPolicy.clone` / `.release`),
  `clearTextureCache`, `TEXTURE_CACHE_MAX_ENTRIES`, and the deprecated `MeshBatch` alias — use
  `DisplayBatch`.

  `setTextureAnisotropy` stays: it is the host's half of the `onMaxAnisotropy` seam that keeps
  `render/` from importing `parse/`.

  ## Breaking — `/scene`

  `createSceneOutliner` composes this layer, so its parts are no longer exported individually — reach
  them via `outliner.visibility` / `.selection` / `.layerGroups()`. Removed: `HELPER_IDS`,
  `isSceneContent`, `getSceneObjects`, `prettyType`, `DEFAULT_LAYER`, `groupByLayer`,
  `filterLayerGroups`, `getStableKey`, `createVisibilityState`, `createSelectionState`.

  Kept: `createSceneOutliner`, `SceneOutliner`, `SceneOutlinerOptions`, the state handle types
  (`VisibilityState`, `SelectionState`, `SelectionModifiers`), and the helpers a host needs while
  rendering an outliner row — `getObjectLabel`, `getTypeLabel`, `getTrackingKey`.

### Minor Changes

- 7751bd0: Extract parsing and rendering into a new `@selvajs/visualization` package.

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

- e3c4832: `@selvajs/visualization` no longer depends on `@selvajs/compute`.

  Mesh conversion and the viewer now work for a consumer who has neither Selva nor Rhino.Compute:
  `shared/`, `parse/`, `render/` and `scene/` need only `three`, `rhino3dm` and `fflate`. Four things
  moved in-package:

  - **`VisualizationError` replaces `RhinoComputeError`** in the parse layer. The old name described a
    transport the failure had nothing to do with — on the plugin's WebSocket path a corrupt mesh blob
    never went near Rhino.Compute. **The `code` values are unchanged** (`VALIDATION_ERROR`,
    `INVALID_STATE`, `ENVIRONMENT_ERROR`), so catch-sites matching on `error.code` keep working; only
    code matching on `instanceof RhinoComputeError` or `error.name` needs updating.
  - **A local logger** (`getLogger`/`setLogger`/`enableDebugLogging` from
    `@selvajs/visualization/render`). It defaults to no-op, exactly as compute's does, so output is
    unchanged. For one sink across both packages:

    ```ts
    import { setLogger } from '@selvajs/visualization/render';
    import { getLogger } from '@selvajs/compute';

    setLogger(getLogger());
    ```

  - **A local `decodeBase64ToBinary`**, copied from compute rather than imported.
  - **The Grasshopper response envelope is now declared structurally** as `DisplayComputeResponse`
    (exported from `@selvajs/visualization/parse`) — only the fields the parser actually reads.
    `getThreeMeshesFromComputeResponse` is otherwise unchanged and compute's
    `GrasshopperComputeResponse` stays assignable to it, so existing calls need no edit.

  The package now depends on nothing from Selva at all: the solve session, which was the one part
  still reaching for `@selvajs/schemas`, has moved to `@selvajs/solve/client`.

### Patch Changes

- 46327d9: Fix `initThree`'s `edges` options being silently dropped: `maxTriangles`, `maxSegments` and
  `screenSpaceFallback` never reached the edge pipeline.

  All three are documented on `EdgesConfig` and read at runtime — `applyEdges` forwards the two caps to
  `addEdgesAsync`, and `updateEdgeFallback` checks `screenSpaceFallback` before switching the
  screen-space edge pass on. But `applyDefaults` never copied them out of the caller's options, so they
  resolved to `undefined` on every viewer: the triangle cap was pinned to its 4M default (a host could
  neither lower it to protect a weak GPU nor raise it), and `screenSpaceFallback: false` did nothing.

  `ResolvedOptions` is `Required<>` only at the top level, so `edges` kept `EdgesConfig`'s optional
  members and the omission type-checked. `applyDefaults` now passes the three through — left
  `undefined` when unset, so `resolveOptions` in `edges/options.ts` stays the single owner of the 4M /
  2M defaults instead of a second copy free to drift. A regression test asserts every `EdgesConfig` key
  survives resolution.

  Found by GPU-verifying the screen-space edge pass in a real browser, which no unit test can cover.
