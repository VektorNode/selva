# `render/` — the CAD viewer toolkit

A configured THREE scene (camera, lighting, environment, controls, render loop) plus the overlays
that make it read as CAD: edges, grid, nav gizmo, HTML labels, measurement, ambient occlusion.

Depends downward on `shared/` only. It deliberately does **not** import `parse/` — the renderer knows
nothing about wire formats, and a host that does both wires them together (see
[Anisotropy](#anisotropy-the-one-render↔parse-seam)).

## Contents

| Path                                                       | Owns                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `scene-setup/`                                             | `initThree` and everything it composes — see below                                                                                       |
| `edges.ts`                                                 | Public `addEdges`/`addEdgesAsync`/`removeEdges`; targeting and attachment                                                                |
| `edges/`                                                   | `options` (defaults/constants), `extraction` (worker + caches), `cache` (refcounted line geometry), `overlay` (materials + density fade) |
| `camera-controller.ts`                                     | Perspective↔ortho swap, view presets, framing tweens                                                                                     |
| `render-pipeline.ts`                                       | Postprocessing composer (GTAO, screen-space edges, output pass)                                                                          |
| `edge-detection-pass.ts` / `edge-extract.ts`               | The screen-space edge pass; the fast worker-portable extractor                                                                           |
| `grid.ts`, `view-gizmo.ts`, `label-layer.ts`, `measure.ts` | Independent viewer overlays                                                                                                              |
| `near-plane.ts`                                            | Per-frame near-plane fitting (depth precision when zoomed out)                                                                           |
| `three-helpers.ts`                                         | `updateScene`, `clearScene`, `computeContentBounds`                                                                                      |
| `three-materials.ts`                                       | The shared material singletons (`SHARED_MATERIALS` is what `clearScene` spares)                                                          |
| `up-axis.ts`                                               | The scene-up basis every orientation default derives from                                                                                |
| `types.ts`                                                 | The `ThreeInitializerOptions` surface                                                                                                    |

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

## Anisotropy: the one render↔parse seam

`initThree` reports the GPU's max anisotropy through an injected `onMaxAnisotropy` callback rather
than calling the parse layer's texture cache itself. That keeps the dependency direction one-way:
`render/` never imports `parse/`. Hosts that do both should forward it —

```typescript
import { setTextureAnisotropy } from '@selvajs/visualization/parse';

initThree(canvas, { onMaxAnisotropy: setTextureAnisotropy });
```

Omitting it is safe: anisotropy stays at 1, so colour maps are softer at grazing angles but nothing
breaks.
