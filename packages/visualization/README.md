# `@selvajs/visualization`

Show Rhino/Grasshopper geometry in a browser, with Three.js.

No Svelte, no React, no DOM widgets: you get a viewer and a parser, and you build your own UI on
top. `three` is a peer dep, so your app owns the copy.

## Install

```bash
pnpm add @selvajs/visualization three
```

## The whole thing in one example

Two calls: build a viewer on a canvas, then put parsed geometry into it.

```ts
import { initThree, updateScene } from '@selvajs/visualization/render';
import { getThreeObjectsFromComputeResponse } from '@selvajs/visualization/parse';

const viewer = initThree(canvas, {
	look: 'technical',
	grid: { enabled: true },
	edges: { enabled: true }
});

// `response` is what Rhino.Compute returned for your definition.
const objects = await getThreeObjectsFromComputeResponse(response);
updateScene(viewer.scene, objects, viewer.camera, viewer.controls, false);
viewer.applyEdges(viewer.scene);

viewer.dispose(); // when the canvas goes away: frees the GL context, not just its objects
```

That is the full path: **compute response → THREE objects → scene**.

## The three parts

Each is its own import path, so a bundler can drop the ones you don't use.

| Import                          | What it gives you                                                    |
| ------------------------------- | -------------------------------------------------------------------- |
| `@selvajs/visualization/parse`  | backend payload → THREE meshes, curves, points                       |
| `@selvajs/visualization/render` | the viewer: camera, lights, grid, edges, gizmo, measure, render loop |
| `@selvajs/visualization/scene`  | an object list over a live scene: layers, visibility, selection      |

```ts
import { getThreeObjectsFromComputeResponse } from '@selvajs/visualization/parse';
import { initThree, type ThreeViewer } from '@selvajs/visualization/render';
import { createSceneOutliner } from '@selvajs/visualization/scene';
```

There is no root (`.`) export on purpose: always import from one of the three.

Each folder has its own README: [parse](./src/parse/README.md), [render](./src/render/README.md),
[scene](./src/scene/README.md).

## How the parts relate

```
scene/     reads a live scene    ─┐
render/    owns the scene         ├─ siblings: none imports another
parse/     builds the content    ─┘
                 ↓ all three use
shared/    errors, logging, looks, colour + GPU helpers   [internal, not published]
```

`render/` puts geometry in the scene; `parse/` makes that geometry; `scene/` only looks at what is
there. A host app wires them together, and that's the point.

`shared/` is internal. The bits you'd want from it (`VisualizationError`, `setLogger`, `LOOKS`) are
re-exported from `/render`.

## Run the demos

```bash
pnpm example        # http://localhost:5173
```

Five pages, ordered so you can work down them:

1. **Getting Started**: the smallest real app, with no harness around it. Its source is the example
   above, fleshed out; read it first.
2. **Display Items**: what actually comes out of a GH compute response.
3. **Outliner**: an object-list panel over a live scene: layers, search, hide/show, selection.
4. **Viewer — Full API**: every `initThree` control on one panel.
5. **Mesh File**: a `.slvm` through the exact calls the Selva app makes, for checking the look 1:1.

This is also the only place the GPU parts (edge overlays, ambient occlusion, the measure tool) can
be checked at all; the test suite runs in jsdom, which has no WebGL.

## Logging

Silent by default. To send its logs wherever your app's logs go:

```ts
import { setLogger } from '@selvajs/visualization/render';
import { getLogger } from '@selvajs/compute/core';

setLogger(getLogger());
```

## Notes for contributors

- **Layers depend downward only.** `parse/`, `render/` and `scene/` never import each other; all
  three may import `shared/`. Where a file belongs follows from what it depends on.
- **A layer's `index.ts` is its only cross-layer import surface.** Inside a layer, import siblings
  by relative path.
- **The API stays minimal.** A published symbol is a promise to keep it. `initThree` builds the
  toolkit and hands back live instances on `viewer` (`viewer.grid`, `viewer.measureTool`, …), so
  those factories stay unexported. The SLVA binary format is private to `parseMeshBatch*`.
- **No Selva dependencies.** Only `fflate`, plus `three` as a peer dep. Errors, logging and base64
  live in `shared/` rather than coming from `@selvajs/compute`, so the viewer works for someone with
  neither Selva nor Rhino.Compute. The compute response shape is declared structurally in
  [`parse/webdisplay/response-envelope.ts`](./src/parse/webdisplay/response-envelope.ts).
- **The solve session is not here**: it lives in `@selvajs/solve/client`. What stayed behind is the
  mesh-ownership policy that solve's result memo needs but doesn't want to know about:
  [`parse/mesh-policy.ts`](./src/parse/mesh-policy.ts).
