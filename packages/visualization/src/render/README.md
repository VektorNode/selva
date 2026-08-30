# `render/` — the CAD viewer toolkit

This folder builds the 3D viewer you see on screen: camera, lights, controls, grid, edges, labels,
measurement, and the render loop.

It only depends on `shared/`. It does not read wire formats or know how compute responses are parsed.
That part belongs to `parse/`.

`initThree` is the main entry point. It creates the viewer pieces and returns the live viewer object.
The lower-level constructors stay internal; the package exposes the handles you use, not the pieces
that build them.

## Main pieces

| Path                                                       | What it does                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `scene-setup/`                                             | Builds the viewer with `initThree`                               |
| `edges.ts`                                                 | Adds and removes edge overlays                                   |
| `edges/`                                                   | Edge settings, extraction, and line building                     |
| `camera-controller.ts`                                     | Camera presets, framing, and perspective/ortho switching         |
| `render-pipeline.ts`                                       | The post-processing chain                                        |
| `edge-detection-pass.ts` / `edge-extract.ts`               | Screen-space edge detection                                      |
| `grid.ts`, `view-gizmo.ts`, `label-layer.ts`, `measure.ts` | Extra viewer overlays                                            |
| `near-plane.ts`                                            | Keeps the near clip plane sane when zoomed out                   |
| `three-helpers.ts`                                         | Helpers like `updateScene`, `clearScene`, and bounds calculation |
| `three-materials.ts`                                       | Shared material instances                                        |
| `up-axis.ts`                                               | Viewer orientation helpers                                       |
| `types.ts`                                                 | `ThreeInitializerOptions` and related types                      |

### `scene-setup/`

`init-three.ts` orchestrates one file per construction step — `create-scene`, `create-camera`,
`setup-renderer`, `setup-lighting` (plus the shadow-frustum fit), `setup-environment` (HDR/PMREM +
floor), `setup-controls`, `setup-events` (picking, selection, keyboard), `animation-loop`, `defaults`
(the option-precedence resolver), and `dispose` (teardown sweeps). Each takes the resolved config and
returns its object; the orchestrator owns only the wiring and the returned viewer handle.

Two more controllers live here and back part of the `ThreeViewer` API: `appearance.ts`
(`viewer.setLook`, `setFillLights`, `setEnvironmentIntensity`, `setToneMappingExposure`,
`setAoIntensity`) and `pipeline-controller.ts` (wraps `render-pipeline.ts`'s composer, backs
`viewer.setAmbientOcclusion`).

## Quick start

```typescript
import { initThree, updateScene } from '@selvajs/visualization/render';
import { getThreeObjectsFromComputeResponse } from '@selvajs/visualization/parse';

const { scene, camera, controls, applyEdges, dispose } = initThree(canvas, {
	look: 'technical',
	edges: { enabled: true },
	grid: { enabled: true }
});

const objects = await getThreeObjectsFromComputeResponse(response);
updateScene(scene, objects, camera, controls, false);
applyEdges(scene);

dispose(); // frees the GL context, not just its objects
```

## Common use

Show a compute response in the viewer:

```typescript
const objects = await getThreeObjectsFromComputeResponse(response);
updateScene(scene, objects, camera, controls, false);
```

Turn on a few view helpers:

```typescript
const viewer = initThree(canvas, {
	grid: { enabled: true },
	edges: { enabled: true },
	look: 'technical'
});
```

Change the look without rebuilding the scene:

```typescript
viewer.setLook('presentation');
viewer.setAmbientOcclusion(true);
```

Clear the scene when you want a reset:

```typescript
viewer.clearScene();
```

## Host apps

An app can still add its own content on top of the viewer. Common cases are:

- drawing reference geometry that should stay between solves
- adding custom click behavior
- placing labels or notes around the model

This package ships the viewer pieces, not your app-specific tools.

**[docs/contributing/viewer-apps.md](../../../../docs/contributing/viewer-apps.md) is the guide** — the seams, the traps, and a checklist.

## Extension points

These are the places to change when you want a different viewer feel.

- **A new look** — add a preset in `shared/`.
- **A new edge style** — change the code under `edges/`.
- **A different scene up direction** — set `environment.sceneUp`.
- **A custom render pass** — adjust `render-pipeline.ts`.

## The render↔parse seam

`render/` never imports `parse/`. One thing does cross that line, and it does not need host wiring:

**GPU capabilities (anisotropy).** `initThree` publishes the GPU limit at startup;
`parse/webdisplay/apply-texture.ts` subscribes via `observeMaxAnisotropy` at module load. The
subscriber fires immediately, so load order does not matter. The `onMaxAnisotropy` option on
`ThreeInitializerOptions` is only for hosts doing their own texture work.

## GPU ownership: ask, don't remember

Every GPU resource should have one owner. Scene content is cleaned up through
`shared/gpu-dispose.ts`'s `disposeObjectTree`. If you need a new teardown path, use that helper
instead of writing your own `traverse` + `.dispose()` loop.
