# `@selvajs/visualization` — a headless, extensible viewer core

> **Status: IN PROGRESS (updated 2026-07-29) — steps 1–3 landed, 4–8 open.** Extract parse + scene +
> render + session out of `@selvajs/compute` and `@selvajs/ui` into one framework-free package with a
> clean public API, small single-responsibility files, and documented layer boundaries. Scope:
> new `packages/visualization`; `@selvajs/compute` loses its `/visualization` export and `three`
> peer dep; `@selvajs/ui` keeps only the Svelte viewer shell + design-system widgets. Pre-release,
> so removals are free (no migration path). See migration steps at the bottom.
>
> **Landed:** `packages/visualization` scaffolded; `shared/` and `parse/` moved with their 108 tests;
> the three largest parsers split; `compute/visualization` no longer exports parsing; all five
> importers rewired.
>
> **Still in `@selvajs/compute`:** the whole `render/` layer (`threejs/`), so compute keeps its
> `three` peer dep for now. `scene/` and `session/` are untouched in `@selvajs/ui`.

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

    render/
      index.ts                  ← initThree, createRenderPipeline, camera/edges/grid/gizmo/measure…
      README.md                 ← "the CAD viewer toolkit"; extension: custom looks, edge strategy
      scene-setup/              ← three-initializer.ts (1708) EXPLODED along its private fns:
        init-three.ts           ← the initThree factory (orchestrator, ~200)
        create-scene.ts
        create-camera.ts
        setup-renderer.ts
        setup-lighting.ts       ← lighting + shadow fit
        setup-environment.ts    ← env map + floor
        setup-controls.ts
        setup-events.ts         ← pointer/resize handlers (~230, its own file already)
        animation-loop.ts
        defaults.ts             ← applyDefaults + option types
        dispose.ts              ← disposeMaterialWithTextures + teardown
      camera-controller.ts      (343 → keep)
      render-pipeline.ts        (153)
      edges.ts                  (793 → split ↓, keep public addEdges here ~200)
      edges/
        extraction.ts           ← sync/async/worker edge extraction
        cache.ts                ← segment + overlay cache
        overlay.ts              ← MaterialPool, buildEdgeOverlay, distance fade
      edge-detection-pass.ts    (221)
      edge-extract.ts           (224)
      grid.ts                   (226)
      view-gizmo.ts             (155)
      label-layer.ts            (134)
      measure.ts                (404 → optional split: tool.ts + snapping.ts)
      near-plane.ts             (82)
      three-materials.ts        (153)
      three-helpers.ts          (253)

    scene/                      ← NEW layer, extracted from SceneManager.svelte
      index.ts
      README.md                 ← "the parse↔render bridge"; extension: selection/visibility events
      scene-controller.ts       ← owns THREE.Scene: setBatches (diff add/remove), dispose, events
      visibility.ts             ← show/hide + hidden-set logic (pure, from SceneManager)
      selection.ts              ← single/range/multi selection logic (pure, from SceneManager)
      layers.ts                 ← layer/category grouping + partial-hidden calc (pure)
      types.ts                  ← MeshMetadata, SceneEvent, SceneObjectInfo

    session/                    ← moved from ui/src/lib/compute, de-Svelte-d
      index.ts                  ← createSolveSession, drivers, types
      README.md                 ← "inputs → solve → outputs"; extension: write a SolveDriver
      solve-session.ts          ← createSolveSession (from createSolveSession.svelte.ts, no runes)
      solve-session-core.ts     (122 → keep) pure transition logic
      solve-memo.ts             (140 → keep)
      compute-throttle.ts       (109 → keep, drop .svelte)
      drivers/
        driver.ts               ← SolveDriver + SolveReporter interfaces
        request-response.ts     ← createRequestResponseDriver (memo + throttle)
        # websocket driver stays in plugin-ui — it's transport-specific — but implements this iface
      defaults.ts               ← getDefaultValue (relocated pure dep)
      external-storage.ts       ← getExternalInputs/readExternalValue (relocated pure dep)
      solve-fn.ts               ← SolveFn, SolveResult types
```

Result: **no file over ~300 lines**, every folder maps to one layer, each layer has a README naming
its extension points. A contributor adding e.g. a new edge strategy touches only `render/edges/`.

## The parse↔render bridge (`scene/`)

`SceneManager.svelte` today mixes two things:

- **pure scene-graph state** — visibility sets, selection (single/range/ctrl), layer grouping,
  partial-hidden math → moves into `scene/{visibility,selection,layers}.ts`
- **an outliner UI panel** — search box, collapsible tree, DOM → **stays in `@selvajs/ui`** as a thin
  Svelte wrapper that renders `SceneController` state and forwards clicks.

```ts
class SceneController {
	constructor(scene: THREE.Scene, opts?: SceneControllerOptions);
	setBatches(batches: DisplayBatch[]): void; // diff → add/remove into the scene
	setVisible(id: string, visible: boolean): void;
	select(id: string, mode: 'single' | 'toggle' | 'range'): void;
	layers(): LayerGroup[]; // grouping for an outliner UI
	getMetadata(id: string): MeshMetadata;
	on(event: 'change' | 'select', cb): () => void; // plain emitter, no Svelte
	dispose(): void;
}
```

- Headless: `parseComputeResponse` → `new SceneController(scene)` → `setBatches(...)` → own render loop.
- Svelte: `SceneManager.svelte` becomes a ~80-line `$effect` wrapper over `SceneController`.

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
4. **render/** — move `threejs/`; **explode `three-initializer.ts`** into `scene-setup/*`;
   split `edges.ts` into `edges/*`. Also fold away the two seams step 3 had to leave behind: the
   duplicated `MaterialAppearanceOptions` (correction 6) and the `onMaxAnisotropy` injection
   (correction 5) — once `render/` and `parse/` are in one package, the renderer can import the
   texture cache directly again.
5. **session/** — move `ui/src/lib/compute/*` + pure deps (`schema/defaults`, `external/storage`,
   `types/solveFn`); rename `.svelte.ts` files (no runes to lose); split drivers into `drivers/`.
6. **scene/** — extract pure logic from `SceneManager.svelte` into `SceneController` + helpers;
   reduce `SceneManager.svelte` to a wrapper in `@selvajs/ui`.
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
