# `@selvajs/visualization`

A headless, extensible viewer core. Owns **parse → render → scene** as one framework-free package:
no Svelte, no runes, `three` as a peer dep. Consumers build their own UI over it.

## Layer boundaries & dependency direction

Layers depend **downward only**. A contributor can predict where code lives from what it depends on.

```
scene/     SceneOutliner: reads a live THREE.Scene → content list, layers, visibility, selection
   │  ↓ depends on `three` only — it reads the scene graph, render/ owns its contents
render/    THREE scene setup + CAD viewer toolkit (camera, edges, grid, gizmo, measure…)
   │  ↓
parse/     backend payload → THREE meshes + metadata (webdisplay, display-items)
   │  ↓
shared/    coordinate frame, look presets, errors, logging, geometry/color utils  [internal]
```

**The solve session used to be a fourth layer on top; it moved to `@selvajs/solve/client`.** What
stayed behind is the three.js mesh ownership policy solve's result memo needs but deliberately
doesn't know: `meshPolicy` in [`parse/mesh-policy.ts`](./src/parse/mesh-policy.ts).

**Each layer has its own barrel (`index.ts`) — the only cross-layer import surface.** Files inside a
layer import siblings by relative path; other layers import the barrel. That way a layer's internals
can be refactored freely without touching consumers.

## Sub-path exports

Three of the four layers are published entrypoints, so consumers tree-shake:

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

Only what a consumer genuinely needs is exported. In particular:

- **`initThree` owns the render toolkit.** It builds the camera controller, grid, gizmo, measure
  tool, render pipeline and near-plane fitter, and returns the live instances on
  [`ThreeViewer`](./src/render/scene-setup/viewer.ts). Configure them through
  `ThreeInitializerOptions`, reach them through the viewer (`viewer.grid`, `viewer.measureTool`,
  `viewer.applyEdges`, …). The factories themselves are internal — their handle _types_ are exported
  so hosts can annotate what they hold.
- **`createSceneOutliner` composes the scene layer.** Content filtering, layer grouping, visibility
  and selection state are reachable via `outliner.visibility` / `.selection` / `.layerGroups()`.
- **The SLVA binary wire format is private.** Magics, version gates, flag bits and the low-level
  binary parser are implementation details of `parseBinaryMeshBatch*` and change without a major bump.

When adding a feature, resist re-exporting a symbol just because it exists — a published surface is
a compatibility promise.

`scene/` is framework-free too, but takes the simpler route: its state is three sets, so a host
injects its own (`SvelteSet` in a Svelte app) and gets reactivity with no seam at all — see
[`src/scene/README.md`](./src/scene/README.md).

## Examples (`pnpm example`)

`examples/` is a Vite playground for the render pipeline — the only place the GPU-dependent parts
(edge overlays, the screen-space edge pass, AO, the measure tool) can actually be checked, since
jsdom has no WebGL.

```bash
pnpm example        # http://localhost:5173
```

Three demos: **Viewer — Full API** (every `initThree` control), **DMF — Selva Pipeline** (loads a
`.dmf` through the same parse + `updateScene` calls `Viewer.svelte` makes), and **Display Items**
(a GH compute response through `getThreeMeshesFromComputeResponse`).

They live here rather than in `@selvajs/compute` because that package must not depend on `three`.
Demos import from the public barrels (`@/render`, `@/parse`) on purpose: if a demo needs a symbol
the barrel doesn't export, that's a gap in the published API, not a reason to deep-import. They are
covered by `pnpm type-check`, so a rename that breaks a demo fails the build instead of rotting.

## Dependencies

This package depends on **nothing from Selva** — only `fflate`, and `three` as a peer
dependency. It owns its
own errors ([`shared/errors.ts`](./src/shared/errors.ts)), logging
([`shared/logger.ts`](./src/shared/logger.ts)) and base64 decoding
([`shared/encoding.ts`](./src/shared/encoding.ts)) rather than importing them from
`@selvajs/compute`, so mesh conversion and the viewer work for a consumer with neither Selva nor
Rhino.Compute.

The Grasshopper response envelope `getThreeMeshesFromComputeResponse` accepts is declared
structurally in [`parse/webdisplay/response-envelope.ts`](./src/parse/webdisplay/response-envelope.ts)
— only the fields the parser reads. Compute's `GrasshopperComputeResponse` is a superset and stays
assignable to it.

### Unified logging

The package logs nothing by default. To route its output into a host's logger — including
`@selvajs/compute`'s, so both packages share a sink:

```ts
import { setLogger } from '@selvajs/visualization/render';
import { getLogger } from '@selvajs/compute/core';

setLogger(getLogger());
```

## Peer dependencies

`three` (>=0.179.0) is a peer dep — the host app owns the single `three` instance. Installing a
second copy breaks `instanceof` checks across the boundary.
