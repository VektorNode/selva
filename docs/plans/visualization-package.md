# `@selvajs/visualization` — a headless, extensible viewer core

> **Status: IN PROGRESS (updated 2026-07-29) — steps 1–6 landed, 7–8 open.** Extract parse + scene +
> render + session out of `@selvajs/compute` and `@selvajs/ui` into one framework-free package with a
> clean public API, small single-responsibility files, and documented layer boundaries. Scope:
> new `packages/visualization`; `@selvajs/compute` loses its `/visualization` export and `three`
> peer dep; `@selvajs/ui` keeps only the Svelte viewer shell + design-system widgets. Pre-release,
> so removals are free (no migration path). See migration steps at the bottom.
>
> **Landed:** `packages/visualization` scaffolded; all five layers — `shared/`, `parse/`, `render/`,
> `scene/` and `session/` — moved with their 425 tests; the five largest files split
> (`batch-parser`, `binary-parser`, `display-items-parser`, `three-initializer`, `edges`);
> `@selvajs/compute/visualization` deleted outright; every importer rewired. **`@selvajs/compute` no
> longer depends on `three` in any form** — it is pure solve/data. The Solve Session is now
> framework-free, with `useSolveSession` in `@selvajs/ui` as its Svelte binding; the scene outliner
> is framework-free via injected sets, with `SceneManager.svelte` reduced to rendering.
>
> **Left in `@selvajs/ui` by design:** the Svelte shells — `Viewer.svelte`, `SceneManager.svelte`,
> `useSolveSession.svelte.ts`, `solving.svelte.ts` — plus the design system.

## Corrections to this plan, found while executing it

The plan was written against a stale file tree. Recorded here so the remaining steps aren't planned
against the same wrong assumptions:

1. **Paths.** Everything lives under `src/features/visualization/`, not `src/visualization/`. Line
   counts also drifted: `three-initializer.ts` is 1734 (not 1708), `edges.ts` 874 (not 793),
   `binary-parser.ts` 713, `batch-parser.ts` 1007.
2. **`d:\Coding\selva-compute` is a stale clone, not a source of truth.** It holds an older parallel
   copy of `features/visualization` (no `edge-extract`, `edge-detection-pass`, `up-axis`). Ignore it;
   `packages/compute` is canonical.
3. **The dependency direction is viz → compute, so compute can never import viz.** The parse layer
   needs `getLogger`, `RhinoComputeError`/`ErrorCodes` and `decodeBase64ToBinary`, all of which live
   in compute's `core`. That single edge decides several things the plan left open — see below.
4. **`parse/` depended upward on `render/`** via four symbols in `three-helpers` (`parseColor`,
   `applyOffset`, `computeCombinedBoundingBox`, `CACHED_GEOMETRY_USERDATA_FLAG`). They are pure
   object/color math with no scene graph, so they moved into `shared/` — which is what let `parse/`
   move before `render/` does.
5. **Two render→parse edges had to be cut**, both consequences of (3):
   - `initThree` called `setTextureAnisotropy` directly. Now an injected `onMaxAnisotropy` hook.
   - `GrasshopperResponseProcessor.extractMeshesFromResponse()` called the mesh parser. **Removed**
     (approved as a breaking change); `response`/`debug` are public so callers invoke the parser.
6. **`MaterialAppearanceOptions` is deliberately declared twice** — once in `shared/types.ts`, once
   in compute's `features/visualization/types.ts`. The renderer must describe a look's material dials
   without depending on the parse layer that consumes them. The duplicate disappears when `render/`
   moves in step 4.
7. **A test moved in the opposite direction.** `clearScene skips disposing cache-owned geometries`
   tests a render function, so it went to compute's `three-helpers.test.ts`; the cache half of that
   contract stayed with the cache.
8. **Step 8's "add a changeset" is understated** — this is a breaking `major` for `@selvajs/compute`,
   not a pre-release bump.

Found while executing step 4:

9. **Both seams from correction 5/6 resolved, but only one the way the plan predicted.**
   - `MaterialAppearanceOptions` (and `LOOKS`/`Look`/`LookPreset`): the duplicate is gone.
     `render/types.ts` re-exports them from `shared/`. They did **not** move into `render/` — `parse/`
     still needs them to bake materials, and `parse/` may not import `render/`. `shared/` is their
     permanent home, not a waypoint.
   - `onMaxAnisotropy`: **kept as an injected hook, deliberately not reverted.** The plan assumed that
     once `render/` and `parse/` shared a package the renderer could call `setTextureAnisotropy`
     directly. It could — but that would make `render/` depend upward on `parse/`, breaking principle 2
     for one line of convenience. The hook costs the host one option and keeps the render layer usable
     with no parser at all. Documented in `render/README.md`.
10. **`three` left compute completely, not just as a peer dep.** Step 4's brief said "drops `three`
    peer dep" (step 7). In fact `peerDependencies`, `peerDependenciesMeta`, the `three`/`@types/three`
    devDeps, the `external: ['three']` tsup line, and `tests/helpers/bench-geometry.ts` (only the moved
    edge tests used it) all went. `packages/compute/src/features/` now contains `grasshopper/` alone.
11. **`three-initializer.ts` needed three more cuts than the plan's "explode along its private fns".**
    Splitting only the private helpers left the factory at 680 lines, because most of what remained
    wasn't helper code — it was (a) the returned handle's ~90 documented members, inline as a
    return-type annotation, so a reader hit line 123 before any wiring, and (b) two clusters of
    closures over mutable state the plan hadn't listed: the postprocessing pipeline
    (`renderPipeline`/`aoEnabled`/`edgeFallbackActive`/`builtWithAo` + five functions) and the runtime
    appearance setters. Extracted as `viewer.ts` (a named `ThreeViewer` interface),
    `pipeline-controller.ts` and `appearance.ts` — 680 → 407. The pipeline extraction also removed a
    latent coupling: `setLook` used to assign `aoEnabled` directly then call `syncPipeline`, and both
    edge callbacks open-coded the same "only sync when it actually changed" guard. Those now go
    through `setAmbientOcclusion` / `setEdgeFallback`.
12. **The moved render tests needed a vitest setup file that didn't exist in the new package.**
    `applyDefaults` reads `window.devicePixelRatio`, and compute's `tests/setup.ts` had been quietly
    stubbing `global.window = {}` for every suite in that package. Under viz's config (no
    `setupFiles`) nine tests failed with `window is not defined`. Added
    `packages/visualization/tests/setup.ts` with just the browser-global stub — **not** compute's
    `global.fetch = vi.fn()`, which the viz suites don't need. The empty-object stub matters: it makes
    `devicePixelRatio` `undefined` → `Math.min(undefined, 2)` → `NaN` → the `||` falls through, which
    is the branch the default-resolution tests assert.

Found while executing step 5:

13. **"Rename the `.svelte.ts` files (no runes to lose)" was wrong — there were runes to lose.**
    `createSolveSession` used `$state` + `$state.snapshot`, and `computeThrottle` used `$state`.
    Worse, the reactivity crossed the package boundary: `ComputeApp.svelte` reads
    `session.values`/`meshes`/`isSolving` straight into markup, and `usePreviewState` forwards the
    same getters onward. Moving them into a package with no Svelte compiler would have left both
    apps reading correct values that never re-render — a silent failure with no type or test error.
    **Resolved with a `subscribe()` seam** (user-approved): the session is plain getters + a
    listener set, and `@selvajs/ui` gains `useSolveSession.svelte.ts`, which subscribes once and
    bumps a `$state` counter each getter reads. `usePreviewState` does the same by hand, because it
    builds its session lazily on the first `initialData` rather than at component init, so
    `useSolveSession`'s `$effect` binding doesn't fit.
14. **`isSolving` needed a `notify()` escape hatch.** It forwards to the driver, so no session
    mutation ever fires for it and a subscribe-only host would never see the spinner move.
    `SolveSession.notify()` fires subscribers without changing state; the request/response driver
    takes an `onChange` wired to it. The WebSocket driver needs none — its `isSolving` is backed by
    the socket store's own `$state` and stays reactive on its own.
15. **`session/` is not renderer-free.** `solve-memo.ts` imports `three` to clone and dispose scene
    objects (audit C1: the viewer disposes what it renders, so the memo can neither share instances
    nor drop them silently). **Accepted and documented** rather than hooked out — `three` is already
    a peer dep of the package. The layer diagram's "depends on nothing below" means _no dependency
    on `scene`/`render`/`parse`_, which still holds.
16. **Two `@selvajs/ui` files became re-export shims rather than moving.** `external/storage.ts` and
    `schema/defaults.ts` back published sub-path exports (`@selvajs/ui/external`) that external host
    apps import. `publint` caught the first one by failing the build. The implementations moved;
    the paths still resolve.
17. **`dispatch()` now copies the projected inputs.** It used to pass `$state.snapshot(...)` output,
    which was already a fresh object. Without runes, `pickInputValues` returns a map aliasing the
    live values, so a driver holding it across an async solve would see later edits. Spread added,
    with a test pinning it.
18. **A stale note in `ui/CONTEXT.md` was corrected.** It claimed ui's vitest runs without the Svelte
    plugin so runes can't execute in tests. The config has had `plugins: [svelte()]` for a while;
    the rune-module tests were running fine. The paragraph now documents the new binding instead.

Found while executing step 6:

19. **`SceneController` described a component that doesn't exist.** The plan specified `setBatches()`
    diffing batches into the scene, `dispose()`, `getMetadata()`, and an `on('change'|'select')`
    emitter — i.e. a controller that _owns_ scene content. `SceneManager.svelte` owns none of that.
    It is an **outliner over an already-populated scene**: `Viewer.svelte` calls `updateScene`, and
    SceneManager only reads `scene.children` and toggles `.visible`. Building the specified API
    would have meant writing a second owner of the scene graph alongside `updateScene` — the setup
    that produces double-dispose bugs. **Shipped `createSceneOutliner` instead**, which extracts what
    was actually there. `scene-controller.ts` and `types.ts` were not created; `MeshMetadata` and
    `LayerGroup` don't exist because nothing needed them (`MeshMetadataDialog.svelte` reads
    `userData` directly, and layer groups are a plain `Map`).
20. **The emitter seam was unnecessary — injected sets are better here.** The session layer needed
    `subscribe()` because its state is scalars behind getters. The outliner's state is three
    _sets_, so the host can supply `SvelteSet`s via `options.sets` and get reactivity with no
    subscribe/emit machinery at all. Only `searchQuery` and the shift-anchor aren't sets; the host
    mirrors those. Net effect: `SceneManager.svelte` 319 → 234 lines, script 162 → ~70, and the
    controller stays plain TypeScript.
21. **Hidden state never survived a solve — now fixed, as a deliberate follow-up.** Both the old
    component and the first cut of the outliner keyed on `THREE.Object3D.uuid`, which three
    regenerates per instance, so hiding a mesh and dragging a slider brought it back. Shipped as a
    separate change on top of the extraction (user-approved), because it is a behaviour change, not
    a refactor:
    - `identity.ts` synthesizes a stable key — `userData.id` → `sourceComponentId:originalIndex` →
      `name:layer` → uuid fallback. The first two already existed as a documented convention
      ("stable pick key") in the parse layer; nothing new had to be put on the wire.
    - `VisibilityState.applyTo(objects)` re-hides the set against freshly built content;
      `SceneOutliner.applyTo()` wraps it and clears selection. `Viewer.svelte` calls it in the same
      `untrack` block that re-attaches edge overlays.
    - Hidden keys are **never pruned** and `applyTo` **only hides, never shows** — so a definition
      edit doesn't lose the user's hiding, and this never fights another feature that hid something.
22. **The outliner had to move out of `SceneManager.svelte` to make that work.** The panel is behind
    `{#if sceneManagerOpen}`, so it unmounts when closed — taking the hidden set with it, and
    leaving nothing to call `applyTo()` after a solve. It now lives in `Viewer.svelte` (which owns
    the scene and persists) and arrives as a prop. This is the general rule, now in the README:
    **whoever owns the scene owns the outliner**, never the panel.
23. **The injected-set seam has a sharp edge worth knowing.** A framework observes the _set_, not
    the outliner — so `visibility.isHidden(obj)`, which reaches the set through a plain reference
    inside the outliner, reads correctly but does **not** re-render. The markup has to go through
    the injected set itself: `hidden.has(getTrackingKey(obj))`. Caught by inspection after
    `svelte-check` and every test passed on the broken version — the same class of silent failure
    as correction 13, and the reason `getTrackingKey` is exported rather than left private.

## Goal

One pure-TS package that owns **parse → scene → render → session** with a clean public API, so a
consumer can build their own UI over it. Designed for **extension and maintenance**: small
single-responsibility files, one obvious home for each concern, a stable barrel per layer, and a
documented dependency direction.

Modelled on ShapeDiver's engine split (`data-engine` + `rendering-engine` + `session-engine`)
collapsed into one package — we don't have their team size or plugin ecosystem to justify 25 packages,
but we adopt their **layer boundaries** internally.

## Design principles (the "super nice to work with" part)

1. **One concern per file, ~50–250 lines.** No file over ~300 lines. Today's worst offenders get
   split along seams they already have (`three-initializer.ts` 1708 → 8 files; `batch-parser.ts`
   1006 → 4; `edges.ts` 793 → 3).
2. **Layers depend downward only.** `session → scene → render → parse → shared`. Never up. A new
   contributor can predict where code lives from what it depends on.
3. **Each layer has its own barrel** (`index.ts`) — the only cross-layer import surface. Files inside
   a layer import siblings by relative path; other layers import the barrel. Refactor a layer's
   internals freely without touching consumers.
4. **Pure core, framework-free.** No Svelte, no runes. `three` and `rhino3dm` are peer deps.
   Everything is `create*()` factories or plain classes returning plain objects/event emitters.
5. **Extension points are explicit.** Materials, looks, edge strategies, drivers, and coordinate
   frames are pluggable via options objects and small interfaces — documented in each layer README.

## Layer boundaries & dependency direction

```
session/   pure state machine + drivers   ─depends→ (nothing below; transport-agnostic)
   │
scene/     SceneController: parse-output → live THREE.Scene, visibility/selection/layers
   │  ↓ consumes render/ for helpers, parse/ types
render/    THREE scene setup + CAD viewer toolkit (camera, edges, grid, gizmo, measure…)
   │  ↓
parse/     backend payload → THREE meshes + metadata (webdisplay, display-items)
   │  ↓
shared/    coordinate frame, look presets, common types, errors
```

`session/` is intentionally independent of `scene`/`render`/`parse` — it only knows `SolveResult`
(inputs→outputs+meshes). That's what lets the same session drive WebSocket (plugin) and
Rhino.Compute (cloud) transports, and lets a headless consumer solve without ever rendering.

## Target file tree

```
packages/visualization/
  README.md                     ← overview + the layer diagram above
  package.json                  ← @selvajs/visualization, peer: three, rhino3dm
  src/
    index.ts                    ← top barrel: re-exports each layer's public barrel

    shared/                     ← ✅ BUILT (as below, with two deltas)
      index.ts
      README.md
      coordinate-frame.ts       ← from coordinate-transform.ts (13 lines)
      looks.ts                  ← LOOK_PRESETS + materialAppearanceForLook (from three-initializer)
      types.ts                  ← Look, LookPreset, MaterialAppearanceOptions
      geometry.ts               ← ADDED: parseColor, applyOffset, computeCombinedBoundingBox,
                                   CACHED_GEOMETRY_USERDATA_FLAG (lifted out of three-helpers so
                                   parse/ stops importing upward — see correction 4)
      # errors.ts NOT created: RhinoComputeError/ErrorCodes are imported from @selvajs/compute
      # directly. A re-export would be indirection with no added behaviour.

    parse/                      ← ✅ BUILT (as below)
      index.ts                  ← parseComputeResponse, parseMeshBatch*, parseDisplayItems + types
      README.md                 ← "how a payload becomes meshes"; extension: custom material hook
      webdisplay/
        webdisplay-parser.ts    (307 → keep)  top-level entry
        binary-parser.ts        (713 → split ↓)
        binary/
          header.ts             ← magic/version/section parsing
          geometry.ts           ← vertex/index/normal decode
          textures.ts           ← embedded texture blocks
        batch-parser.ts         (1007 → 466: entry funcs + the off-thread worker path, which
                                 straddles materials/merge and doesn't cut cleanly any further)
        batch/
          assembly-worker.ts    ← getAssemblyWorker/requestAssembly (worker plumbing)
          materials.ts          ← createMaterial, sRGB decode
          merge.ts              ← createMergedMesh/finalizeMergedMesh/individual meshes
          metadata.ts           ← validateGroupMetadata, metadataFail, key helpers
        mesh-assembly.ts        (315 → keep)
        geometry-cache.ts       (137 → keep)
        texture-cache.ts        (202 → keep)
        types.ts                (153 → keep)
      display-items/
        display-items-parser.ts (440 → 77: dispatch only)
        items/                  ← named `items/`, not `display-items/` — nesting a folder inside its
                                   own namesake made every import path read twice
          curves.ts             ← rhino3dm decode + adaptive tessellation (315)
          points.ts             ← point extraction (55)
          appearance.ts         ← ADDED: materialParams + DEFAULT_COLOR, shared by both (17)
        types.ts                (72)

    render/                     ← ✅ BUILT (as below)
      index.ts                  ← initThree, createRenderPipeline, camera/edges/grid/gizmo/measure…
      README.md                 ← "the CAD viewer toolkit"; extension: custom looks, edge strategy
      scene-setup/              ← three-initializer.ts (1743) EXPLODED along its private fns:
        init-three.ts           (407)  the initThree factory — wiring only
        viewer.ts               (107)  ThreeViewer: the returned handle's ~90 documented members,
                                   split out so the factory's wiring isn't buried under them
        pipeline-controller.ts  (107)  ADDED: owns the postprocessing composer and the two
                                   independent reasons to want one (AO, screen-space edge fallback)
        appearance.ts           (148)  ADDED: the runtime lighting/material setters incl. setLook
        defaults.ts             (233)  applyDefaults + ResolvedOptions + defaultUp
        setup-events.ts         (231)  picking, selection, keyboard
        animation-loop.ts       (169)
        setup-lighting.ts       (114)  lighting + fitShadowToContent
        setup-environment.ts    (112)  HDR/PMREM + addFloor
        setup-renderer.ts       (49)
        dispose.ts              (47)   material/object-tree/scene teardown sweeps
        setup-controls.ts       (34)
        create-camera.ts        (26)
        create-scene.ts         (15)
        __tests__/              ← defaults.test.ts, dispose.test.ts (renamed from look-presets /
                                   three-initializer, which no longer name their subject)
      camera-controller.ts      (360 → keep)
      render-pipeline.ts        (153)
      edges.ts                  (874 → 233: public API, target collection, attachment)
      edges/
        options.ts              ← EdgeOptions, defaults, tuning constants, resolveOptions (129)
        extraction.ts           ← sync/async/worker extraction + content-keyed segment cache (264)
        cache.ts                ← refcounted per-geometry line-geometry cache + edgeSpacingOf (140)
        overlay.ts              ← MaterialPool, buildEdgeOverlay, density fade (162)
      edge-detection-pass.ts    (221)
      edge-extract.ts           (224)
      grid.ts                   (232)
      view-gizmo.ts             (155)
      label-layer.ts            (134)
      measure.ts                (404 → kept whole; the snapping half doesn't cut free cleanly)
      near-plane.ts             (90)
      three-materials.ts        (153)
      three-helpers.ts          (259 → 182: parseColor/applyOffset/computeCombinedBoundingBox and
                                   the cache flag now come from shared/, where step 2 put them)
      types.ts                  ← ThreeInitializerOptions (look types re-exported from shared/)
      up-axis.ts                (128)

    scene/                      ← ✅ BUILT — extracted from SceneManager.svelte (see correction 19)
      index.ts                  (32)   the layer barrel
      README.md                 ← "reads the scene, never owns it"; the injected-sets seam, the
                                   identity table + applyTo contract; extension points
      outliner.ts               (149)  createSceneOutliner: composes the five below
      identity.ts               (66)   getStableKey/getTrackingKey — survives a solve (corr. 21)
      objects.ts                (66)   isSceneContent/HELPER_IDS, getObjectLabel, prettyType
      layers.ts                 (53)   groupByLayer + filterLayerGroups
      visibility.ts             (93)   hidden-set + subtree .visible + tri-state + applyTo
      selection.ts              (89)   click / ctrl / shift-range + anchor subscribers
      __tests__/                ← 82 tests: outliner, identity, objects, layers, visibility,
                                   selection
      # No scene-controller.ts / types.ts: the outliner does not own scene content, so there is
      # no setBatches to diff and no MeshMetadata to model — see correction 19.

    session/                    ← ✅ BUILT — moved from ui/src/lib/compute, de-runed
      index.ts                  (54)   the layer barrel
      README.md                 ← "inputs → solve → outputs"; the subscribe() seam +
                                   extension: write a SolveDriver
      solve-session.ts          (197)  createSolveSession: state ownership + subscriber set
      solve-session-core.ts     (122)  pure transition logic
      solve-memo.ts             (140)  keeps its `three` import — see correction 15
      compute-throttle.ts       (122)  single-in-flight, latest-wins (was computeThrottle.svelte.ts)
      external-storage.ts       (64)   getExternalInputs/readExternalValue
      solve-fn.ts               (29)   SolveFn, SolveResult
      drivers/
        driver.ts               (30)   SolveDriver + SolveReporter interfaces
        request-response.ts     (75)   createRequestResponseDriver (memo + throttle)
        # websocket driver stays in plugin-ui — it's transport-specific — but implements this iface
      __tests__/                ← 55 tests: solve-session, solve-session-core, compute-throttle,
                                   solve-memo, external-storage
      # defaults.ts NOT created: getDefaultValue already lives in @selvajs/schemas; session
      # imports it from there directly, and ui/src/lib/schema/defaults.ts stays a re-export shim.

    # Left behind in @selvajs/ui as the Svelte binding for this layer:
    #   lib/compute/useSolveSession.svelte.ts  ← subscribes + republishes as $state
    #   lib/compute/solving.svelte.ts          ← adaptive spinner delay, pure UI timing
```

Result: **no file over ~300 lines**, every folder maps to one layer, each layer has a README naming
its extension points. A contributor adding e.g. a new edge strategy touches only `render/edges/`.

## The parse↔render bridge (`scene/`)

`SceneManager.svelte` today mixes two things:

- **pure scene-graph state** — visibility sets, selection (single/range/ctrl), layer grouping,
  partial-hidden math → moves into `scene/{visibility,selection,layers}.ts`
- **an outliner UI panel** — search box, collapsible tree, DOM → **stays in `@selvajs/ui`** as a thin
  Svelte wrapper that renders `SceneController` state and forwards clicks.

**What actually shipped** — `SceneOutliner`, not `SceneController`. See correction 19 for why the
spec below was wrong; kept for the record.

```ts
const outliner = createSceneOutliner(scene, {
	sets: { hidden, selected, collapsed }, // inject SvelteSets → free reactivity
	onAnchorChange: (uuid) => {}
});
outliner.searchQuery = 'wall';
outliner.objects(); // content only: no cameras, lights, grid, floor, labels
outliner.layerGroups(); // Map<layer, Object3D[]>, search-filtered
outliner.toggleObject(obj); // follows a multi-selection
outliner.select(uuid, { shiftKey, toggleKey });
outliner.reset(); // after a solve — uuids are regenerated
```

- Headless: `getSceneObjects` + `groupByLayer` alone drive an export filter or screenshot cropper.
- Svelte: `SceneManager.svelte` is a 234-line component with ~70 lines of script, all rendering.

## Public API (`src/index.ts`)

```ts
export * from './session'; // createSolveSession, createRequestResponseDriver, SolveDriver, SolveResult
export * from './scene'; // SceneController, MeshMetadata, LayerGroup
export * from './parse'; // parseComputeResponse, parseDisplayItems, DisplayBatch, DisplayItem
export * from './render'; // initThree, createRenderPipeline, camera/edges/grid/gizmo/measure
export * from './shared'; // LOOKS, Look, coordinate frame
```

Sub-path exports mirror the layers so consumers tree-shake:
`@selvajs/visualization/{session,scene,parse,render}`.

## Decision: neutral scene graph (ShapeDiver's `ITreeNode`)? — **No, not now.**

They parse glTF into a renderer-neutral tree so `three` never touches the data layer (SSR/workers/
alt-renderer/headless GLB export). We parse straight into THREE. The neutral layer's only payoff is
multi-renderer / no-WebGL, which isn't on the roadmap. Keep `three` as a peer dep of the parse layer;
revisit only if headless geometry export becomes real. Recorded here as a reversible decision.

## Migration steps (each independently reviewable, tests move with code)

1. ✅ **DONE** — Scaffold `packages/visualization` (package.json, tsconfig, tsup, eslint, vitest,
   README with layer diagram). Note: like `compute`, it self-lints via its own `eslint.config.mjs`
   and is excluded from the root ESLint run — two tsconfig roots error under typescript-eslint 8.64+.
2. ✅ **DONE** — **shared/** — `coordinate-frame.ts`, `looks.ts` extracted out of `three-initializer`,
   `types.ts`, plus `geometry.ts` (the four pure utilities lifted out of `three-helpers`; see
   correction 4).
3. ✅ **DONE** — **parse/** — moved `webdisplay/` + `display-items/` with all 108 tests; split
   `batch-parser` 1007→466, `binary-parser` 713→329, `display-items-parser` 440→77. Dropped the
   parse exports from `@selvajs/compute/visualization`; rewired all 5 importers.
4. ✅ **DONE** — **render/** — moved `threejs/` (14 modules + 14 test files) to `render/`; exploded
   `three-initializer.ts` 1743 → `scene-setup/*` (14 files, largest 407); split `edges.ts` 874 → 233
   - `edges/{options,extraction,cache,overlay}.ts`. Deleted `@selvajs/compute/visualization` and
     `src/visualization.ts`; **dropped `three` from compute entirely** (peer dep _and_ devDeps —
     `packages/compute/src/features/` now holds only `grasshopper/`). Rewired `Viewer.svelte`, the sole
     remaining importer, to `@selvajs/visualization/render`. See corrections 9–11.
5. ✅ **DONE** — **session/** — moved `ui/src/lib/compute/*` + `external/storage` + `types/solveFn`
   with all 55 tests; split drivers into `drivers/{driver,request-response}.ts`. The runes are
   gone: the session is framework-free with a `subscribe()` seam, and `@selvajs/ui` gains
   `useSolveSession.svelte.ts` as its Svelte binding. `@selvajs/ui/external` and `schema/defaults`
   remain as re-export shims so published sub-paths keep resolving. See corrections 13–18.
6. ✅ **DONE** — **scene/** — extracted `SceneManager.svelte`'s logic into `createSceneOutliner` +
   `{objects,layers,visibility,selection}.ts` with 82 new tests; the component drops 319 → 234 lines
   and holds only rendering. Shipped as an outliner over a scene it doesn't own, **not** the
   `SceneController` the plan specified — see corrections 19–21.
7. Rewire `@selvajs/ui`, `plugin-ui`, `selva` imports to `@selvajs/visualization`. `compute` becomes
   pure solve/data (drops `three` peer dep).
8. `pnpm build && pnpm check && pnpm test` green; add changeset. **`@selvajs/compute` takes a `major`**
   — `extractMeshesFromResponse()` is gone and `/visualization` no longer exports the parsers.
   (Pre-existing, unrelated: `@selvajs/supabase-provider`'s conformance suites fail without Supabase
   credentials — they fail identically on a clean tree, so don't read them as a regression.)

## Out of scope

- Neutral scene-graph layer (deferred, see decision).
- Splitting into separate data/render/session packages (one package, internal layers is right for us).
- Renaming the session API to match ShapeDiver (ours is fine; `SolveDriver.report()` push model beats
  their promise-returning `customize()` for WebSocket).
- Auth/tenancy/platform (unrelated).

```

```
