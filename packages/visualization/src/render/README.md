# `render/` — the CAD viewer toolkit

A configured THREE scene (camera, lighting, environment, controls, render loop) plus the overlays
that make it read as CAD: edges, grid, nav gizmo, HTML labels, measurement, ambient occlusion.

Depends downward on `shared/` only. It deliberately does **not** import `parse/` — the renderer knows
nothing about wire formats, and a host that does both wires them together (see
[Anisotropy](#anisotropy-the-one-render↔parse-seam)).

**`initThree` owns this toolkit.** It constructs the camera controller, grid, gizmo, measure tool,
render pipeline and near-plane fitter from `ThreeInitializerOptions` and returns the live instances
on `ThreeViewer`. The individual factories are therefore internal — the barrel exports their handle
_types_ so hosts can annotate, not their constructors. The tables below map the layer's internals;
they are not a list of public exports.

## Contents

| Path                                                       | Owns                                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scene-setup/`                                             | `initThree` and everything it composes — see below                                                                                                                 |
| `edges.ts`                                                 | `addEdges`/`addEdgesAsync`/`removeEdges`; targeting and attachment. Reached via `viewer.applyEdges`/`clearEdges`                                                   |
| `edges/`                                                   | `options` (defaults/constants), `extraction` (worker + content cache), `line-geometry` (builds the renderable line geometry), `overlay` (materials + density fade) |
| `camera-controller.ts`                                     | Perspective↔ortho swap, view presets, framing tweens                                                                                                               |
| `render-pipeline.ts`                                       | Postprocessing composer (GTAO, screen-space edges, output pass)                                                                                                    |
| `edge-detection-pass.ts` / `edge-extract.ts`               | The screen-space edge pass; the fast worker-portable extractor                                                                                                     |
| `grid.ts`, `view-gizmo.ts`, `label-layer.ts`, `measure.ts` | Independent viewer overlays                                                                                                                                        |
| `near-plane.ts`                                            | Per-frame near-plane fitting (depth precision when zoomed out)                                                                                                     |
| `three-helpers.ts`                                         | `updateScene`, `clearScene`, `computeContentBounds`                                                                                                                |
| `three-materials.ts`                                       | The shared material singletons (`SHARED_MATERIALS` is what `clearScene` spares)                                                                                    |
| `up-axis.ts`                                               | The scene-up basis every orientation default derives from                                                                                                          |
| `types.ts`                                                 | The `ThreeInitializerOptions` surface                                                                                                                              |

### `scene-setup/`

`initThree` was one 1700-line function; it is now an orchestrator (`init-three.ts`) over one file per
construction step — `create-scene`, `create-camera`, `setup-renderer`, `setup-lighting` (plus the
shadow-frustum fit), `setup-environment` (HDR/PMREM + floor), `setup-controls`, `setup-events`
(picking, selection, keyboard), `animation-loop`, `defaults` (the option-precedence resolver), and
`dispose` (teardown sweeps). Each takes the resolved config and returns its object; the orchestrator
owns only the wiring and the returned viewer handle.

## Quick start

```typescript
import { initThree, updateScene } from '@selvajs/visualization/render';
import { getThreeMeshesFromComputeResponse } from '@selvajs/visualization/parse';

const { scene, camera, controls, applyEdges, dispose } = initThree(canvas, {
	look: 'technical',
	edges: { enabled: true },
	grid: { enabled: true }
});

const meshes = await getThreeMeshesFromComputeResponse(response, { rhino });
updateScene(scene, meshes, camera, controls, false);
applyEdges(scene);

dispose(); // frees the GL context, not just its objects
```

## Extension points

- **A new look** — add to `LOOKS` + `LOOK_PRESETS` in `shared/`. A look carries only
  lighting/material dials; edges and grid are independent overlays and a look never toggles them.
- **A new edge strategy** — everything lives under `edges/`. `extraction.ts` owns how segments are
  produced (fast path, content cache, worker), `overlay.ts` how they are drawn (material pooling,
  density fade). The public entry only targets meshes and attaches.
- **A different up axis** — set `environment.sceneUp`. Every orientation default (iso camera, sun,
  grid plane, floor normal, hemisphere light, environment rotation) derives from it via `up-axis.ts`.
  Note this reorients the _viewer_; it does not rotate incoming geometry.
- **A custom render pass** — `render-pipeline.ts` builds the composer; `initThree` toggles it via
  `setAmbientOcclusion` and the edge fallback.

## The render↔parse seam

`render/` never imports `parse/`. Two things nonetheless need to cross that line, and **neither
requires host wiring** — both are self-managing:

- **GPU capabilities (anisotropy).** `initThree` calls `publishMaxAnisotropy` at init;
  `parse/webdisplay/texture-cache.ts` subscribes via `observeMaxAnisotropy` at module load. The
  observer fires immediately on subscribe, so module load order doesn't matter. The legacy
  `onMaxAnisotropy` option still exists but is **not needed to get sharp textures**.
- **Cache teardown.** Every cross-solve cache calls `registerCacheRelease(...)` at module init.
  `initThree` calls `retainCaches()` and invokes the returned release in `dispose()`. It is
  refcounted, so with several live viewers only the last one out actually frees — an unmount
  never wipes caches another viewer is still using.

`releaseParseCaches` remains exported as an escape hatch (reclaiming memory under pressure, or a
test isolating module state), not as a step anyone must remember.

## GPU ownership: ask, don't remember

Every GPU resource has exactly one owner — a cache, a module singleton, or the scene. The rule lives
in `shared/gpu-ownership.ts`, and **`shared/gpu-dispose.ts`'s `disposeObjectTree` is the only
traversal that should dispose scene content.**

This is centralized because it previously wasn't: three separate walkers each carried a different
subset of the guards, and the gaps between them were exactly where two leaks lived (the edge-cache
F1 leak, and cache-owned textures being freed while the cache still served them). If you need a new
teardown path, call `disposeObjectTree` — do not write a fourth `traverse` that calls `.dispose()`.
