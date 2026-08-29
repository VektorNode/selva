# `render/` — the viewer

Everything you see on screen: camera, lights, orbit controls, grid, edges, labels, measurement, and
the render loop. It depends only on `shared/` — it doesn't know what a compute response is. That's
`parse/`.

## One call builds it

```ts
import { initThree } from '@selvajs/visualization/render';

const viewer = initThree(canvas, {
	look: 'technical',
	grid: { enabled: true },
	edges: { enabled: true }
});
```

`initThree` builds every piece and hands back the live instances on `viewer`. There are no separate
constructors to call — `viewer.grid`, `viewer.measureTool`, `viewer.cameraController` are already
there, configured from the options you passed.

## Show some geometry

```ts
import { updateScene } from '@selvajs/visualization/render';
import { getThreeObjectsFromComputeResponse } from '@selvajs/visualization/parse';

const objects = await getThreeObjectsFromComputeResponse(response);
updateScene(viewer.scene, objects, viewer.camera, viewer.controls, false);
viewer.applyEdges(viewer.scene);
```

`updateScene` clears the previous content, adds the new objects, fits the camera clip planes to the
model and frames it. The last argument is `initialPositionSet` — pass `false` the first time so the
camera frames the model, `true` afterwards to leave the user's view alone.

After replacing geometry, also call `viewer.updateShadowBounds()` and `viewer.updateGridScale()` if
you have sun shadows or the grid on.

## Changing how it looks

```ts
viewer.setLook('showcase'); // technical, studio, showcase, arctic, xray
viewer.setAmbientOcclusion(true);
viewer.setToneMappingExposure(1.2);
viewer.fitToView();
```

A look changes lighting and materials only — never the grid or edges, which are independent
overlays. Import `LOOKS` for the full list.

## Cleaning up

```ts
viewer.dispose();
```

Frees the WebGL context, not just the objects in it. Call it when the canvas is removed.

## Useful bits of `viewer`

| Property                                  | What it's for                                           |
| ----------------------------------------- | ------------------------------------------------------- |
| `scene`, `camera`, `controls`, `renderer` | the raw Three.js objects, if you need them              |
| `cameraController`                        | view presets, framing, perspective ↔ ortho              |
| `grid`, `gizmo`, `measureTool`            | overlays (`null` when not enabled)                      |
| `applyEdges` / `clearEdges`               | edge overlays on a subtree                              |
| `captureImage()`                          | PNG of the current view — use this, not `canvas.toBlob` |
| `invalidate()`                            | request a repaint after mutating the scene yourself     |
| `tools`                                   | pointer tools competing for clicks (see below)          |

## Adding your own content

Geometry you add with `scene.add()` gets wiped by the next `updateScene`. Use this instead when
reference geometry, annotations, or app-specific objects should survive a solve:

```ts
viewer.addUserGeometry(myHelperMesh, 'my-app');
viewer.clearUserGeometry('my-app');
```

## Reacting to clicks and keys

**For "tell me what the user clicked", use the event callbacks.** No tool registration needed:

```ts
const viewer = initThree(canvas, {
	events: {
		onObjectSelected: (object) => showPanelFor(object),
		onMeshDoubleClicked: (object) => zoomTo(object),
		onBackgroundClicked: () => closePanel(),
		// Built-in keys: F or Space fits the view, Escape clears the selection.
		enableKeyboardControls: true
	}
});
```

The canvas needs focus for keys to arrive, and the built-ins are the only three. **For your own
shortcuts, add a listener** — there is no key-binding API:

```ts
canvas.addEventListener('keydown', (event) => {
	if (event.key === 'm') viewer.measureTool?.setEnabled(true);
	if (event.key === 'g') viewer.grid?.setVisible(false);
});
```

**Register a pointer tool when a click must _not_ also select the object under it** — placing a
point, drawing a dimension, picking a face. That is the whole reason the registry exists: returning
`true` from `handleClick` consumes the event, so no other tool sees it and selection never runs.

```ts
import { pointerToNdc, pickThreshold } from '@selvajs/visualization/render';
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
// `pointerToNdc` returns a plain `{ x, y }`; `setFromCamera` wants a Vector2, so keep one around
// rather than allocating per click.
const pointer = new THREE.Vector2();
let enabled = false;

const unregister = viewer.tools.register({
	id: 'place-point',
	priority: 10, // above measure (0) and the nav gizmo (-100)
	tool: {
		setEnabled: (on) => (enabled = on),
		isEnabled: () => enabled,

		handleClick(event) {
			if (!enabled) return false; // let the click fall through to selection

			raycaster.setFromCamera(pointer.copy(pointerToNdc(event, canvas)), viewer.camera);
			const [hit] = raycaster.intersectObjects(viewer.scene.children, true);
			if (!hit) return false;

			dropMarkerAt(hit.point);
			return true; // consumed — the mesh under the cursor stays unselected
		},

		// Preview only. Never consumes, so orbit and pan keep working while you hover.
		handleMove(event) {
			if (enabled) moveGhostMarker(pointerToNdc(event, canvas));
		},

		clear: () => removeAllMarkers(),
		dispose: () => removeAllMarkers()
	}
});

viewer.tools.setActive('place-point'); // enables this one, disables every other tool
```

Three things worth knowing:

- **`setActive` is exclusive.** It enables one tool and calls `setEnabled(false)` on all the others,
  so turning yours on switches the measure tool off. Pass `null` to disable everything. A tool
  without `setEnabled` is always live and is not affected.
- **Higher `priority` runs first**; ties break by registration order. The built-ins sit at `0`
  (measure) and `-100` (gizmo).
- **`register` returns an unregister function**, which does not dispose the tool — you still own it.

Picking lines and points needs `pickThreshold(camera, target)` on `raycaster.params.Line.threshold`
and `.Points.threshold`; three's default is nearly unclickable, and this keeps the grab band constant
on screen as you zoom. `snapToVertex` snaps a hit to the nearest vertex within a pixel radius, so a
host tool feels like the built-in measure tool.

**[docs/contributing/viewer-apps.md](../../../../docs/contributing/viewer-apps.md) is the full
guide** — the seams, the traps, and a checklist.

## Where the code lives

| Path                                                       | What it does                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `scene-setup/`                                             | `initThree` and one file per construction step                |
| `camera-controller.ts`                                     | view presets, framing, perspective/ortho                      |
| `edges.ts`, `edges/`                                       | edge overlays: settings, extraction, line building            |
| `edge-detection-pass.ts`, `edge-extract.ts`                | screen-space edge detection (the fallback for skipped meshes) |
| `render-pipeline.ts`                                       | the post-processing chain                                     |
| `grid.ts`, `view-gizmo.ts`, `label-layer.ts`, `measure.ts` | overlays                                                      |
| `near-plane.ts`                                            | keeps the near clip plane sane when zoomed out                |
| `three-helpers.ts`                                         | `updateScene`, `clearScene`, bounds                           |
| `three-materials.ts`                                       | shared material instances                                     |
| `tool-registry.ts`, `scene-ownership.ts`                   | host-app pointer tools and geometry ownership tagging         |
| `types.ts`                                                 | `ThreeInitializerOptions` and friends                         |

Inside `scene-setup/`, `init-three.ts` only wires things up: `create-scene`, `create-camera`,
`setup-renderer`, `setup-lighting`, `setup-environment`, `setup-controls`, `setup-events`,
`animation-loop`, `defaults` (option precedence) and `dispose` each own one step. `appearance.ts` and
`pipeline-controller.ts` back the `setLook` / `setAmbientOcclusion` half of the viewer API.

## Extension points

- **A new look** — add a preset in `shared/looks.ts`.
- **A new edge style** — `edges/`.
- **A different up direction** — `environment.sceneUp`.
- **A custom render pass** — `render-pipeline.ts`.

## Two rules for contributors

**`render/` never imports `parse/`.** One value crosses that line and needs no wiring: `initThree`
publishes the GPU's max anisotropy at startup, and `parse/webdisplay/apply-texture.ts` subscribes at
module load. The subscriber fires immediately, so load order doesn't matter. The `onMaxAnisotropy`
option exists only for hosts doing their own texture work.

**Every GPU resource has one owner.** Free scene content through `disposeObjectTree` in
`shared/gpu-dispose.ts` — never a hand-rolled `traverse` + `.dispose()` loop.
