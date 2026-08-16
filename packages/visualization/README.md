# `@selvajs/visualization`

A headless, extensible viewer core: no Svelte, no runes, `three` as a peer dep. Consumers build
their own UI over it.

## Layers

Layers depend **downward only** — nothing imports upward, so where a file belongs follows from what
it depends on.

```
scene/     SceneOutliner: reads a live THREE.Scene → content list, layers, visibility, selection
render/    THREE scene setup + CAD viewer toolkit (camera, edges, grid, gizmo, measure…)
parse/     backend payload → THREE meshes + metadata (webdisplay, display-items)
   ↑ all three depend only on:
shared/    coordinate frame, look presets, errors, logging, geometry/color, GPU ownership  [internal]
```

The three upper layers are **siblings**, not a chain: `scene/` reads the scene graph but never
imports `render/`, and `render/` never imports `parse/`. A host composes them — see [the
render↔parse seam](./src/render/README.md#the-renderparse-seam) for the one place that needs care.

**The solve session lives in `@selvajs/solve/client`, not here.** What stays behind is the three.js
mesh ownership policy solve's result memo needs but deliberately doesn't know: `meshPolicy` in
[`parse/mesh-policy.ts`](./src/parse/mesh-policy.ts).

**Each layer's barrel (`index.ts`) is the only cross-layer import surface.** Files inside a layer
import siblings by relative path; other layers import the barrel.

## Sub-path exports

The three upper layers are published entrypoints, so consumers tree-shake:

```ts
import { getThreeMeshesFromComputeResponse, meshPolicy } from '@selvajs/visualization/parse';
import { initThree, LOOKS, type ThreeViewer } from '@selvajs/visualization/render';
import { createSceneOutliner } from '@selvajs/visualization/scene';
```

`shared/` is **internal** — it is the cross-layer import surface, not an entrypoint. The parts
consumers need (`VisualizationError`, the logger seam, the look vocabulary) are re-exported from
`/render`. The root `.` entrypoint re-exports nothing on purpose: importing from a layer keeps the
layering enforced by the import graph rather than merely documented.

### The API is deliberately minimal

A published symbol is a compatibility promise, so don't re-export one just because it exists. Three
consequences worth knowing before you go looking for a missing export:

- **`initThree` owns the render toolkit.** It builds the camera controller, grid, gizmo, measure
  tool, render pipeline and near-plane fitter, and returns the live instances on
  [`ThreeViewer`](./src/render/scene-setup/viewer.ts). Configure through `ThreeInitializerOptions`,
  reach through the viewer (`viewer.grid`, `viewer.measureTool`, `viewer.applyEdges`, …). The
  factories are internal; their handle _types_ are exported so hosts can annotate.
- **`createSceneOutliner` composes the scene layer.** Content filtering, layer grouping, visibility
  and selection are reachable via `outliner.visibility` / `.selection` / `.layerGroups()`.
- **The SLVA wire format is private.** Magics, version gates and flag bits are implementation
  details of `parseMeshBatch*` and change without a major bump.

`scene/` gets its reactivity with no seam at all: its state is three sets, so a host injects its own
(`SvelteSet` in a Svelte app) — see [`src/scene/README.md`](./src/scene/README.md).

## Examples (`pnpm example`)

```bash
pnpm example        # http://localhost:5173
```

A Vite playground, and the only place the GPU-dependent parts (edge overlays, the screen-space edge
pass, AO, the measure tool) can be checked at all — jsdom has no WebGL. Three demos: **Viewer**
(every `initThree` control), **Mesh File** (a `.slvm` through the same parse + `updateScene` calls
`Viewer.svelte` makes), **Display Items** (a GH compute response through
`getThreeMeshesFromComputeResponse`).

Demos import from the public barrels on purpose: a demo that needs an unexported symbol is a gap in
the published API, not a reason to deep-import. `pnpm type-check` covers them, so a rename that
breaks a demo fails the build instead of rotting.

## Dependencies

**Nothing from Selva** — only `fflate`, plus `three` as a peer dep. Errors
([`shared/errors.ts`](./src/shared/errors.ts)), logging
([`shared/logger.ts`](./src/shared/logger.ts)) and base64 decoding
([`shared/encoding.ts`](./src/shared/encoding.ts)) are owned here rather than imported from
`@selvajs/compute`, so the viewer works for a consumer with neither Selva nor Rhino.Compute.

Likewise the response shape `getThreeMeshesFromComputeResponse` accepts is declared structurally in
[`parse/webdisplay/response-envelope.ts`](./src/parse/webdisplay/response-envelope.ts) as only the
fields the parser reads. Compute's `GrasshopperComputeResponse` is a superset and stays assignable,
so neither package depends on the other.

**`three` (>=0.179.0) is a peer dep** — the host owns the single instance. A second copy breaks
`instanceof` across the boundary.

The package logs nothing by default. To share a sink with `@selvajs/compute`:

```ts
import { setLogger } from '@selvajs/visualization/render';
import { getLogger } from '@selvajs/compute/core';

setLogger(getLogger());
```
