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

**The solve session used to be a fourth layer on top.** It is a schema-driven form state machine
that types meshes as `unknown` and never inspects them, so it moved to `@selvajs/solve/client` —
leaving this package as exactly mesh conversion + viewer. What stayed behind is the three.js mesh
ownership policy solve's result memo needs but deliberately doesn't know: `meshPolicy` in
[`parse/mesh-policy.ts`](./src/parse/mesh-policy.ts).

**Each layer has its own barrel (`index.ts`) — the only cross-layer import surface.** Files inside a
layer import siblings by relative path; other layers import the barrel. That way a layer's internals
can be refactored freely without touching consumers.

## Current status

All four layers have landed (see `docs/plans/archive/visualization-package.md`):

| Layer     | Contents                                                        | Published     |
| --------- | --------------------------------------------------------------- | ------------- |
| `shared/` | coordinate frame, looks, errors, logging, geometry/color utils  | no — internal |
| `parse/`  | webdisplay + display-items                                      | `/parse`      |
| `render/` | scene setup, edges, camera, grid, gizmo, labels, measure        | `/render`     |
| `scene/`  | outliner: content filter, layer grouping, visibility, selection | `/scene`      |

`session/` has since moved out to `@selvajs/solve/client`.
`@selvajs/compute` no longer depends on `three` at all — it is pure solve/data — and `@selvajs/ui`
keeps only the Svelte shells (`Viewer.svelte`, `SceneManager.svelte`, `useSolveSession.svelte.ts`)
plus the design system.

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
  binary parser are implementation details of `parseMeshBatch*` and change without a major bump.

When adding a feature, resist re-exporting a symbol just because it exists — a published surface is
a compatibility promise.

`scene/` is framework-free too, but takes the simpler route: its state is three sets, so a host
injects its own (`SvelteSet` in a Svelte app) and gets reactivity with no seam at all — see
[`src/scene/README.md`](./src/scene/README.md).

## Dependencies

This package depends on **nothing from Selva** — only `three`, `rhino3dm` and `fflate`. Mesh
conversion and the viewer work for a consumer who has neither Selva nor Rhino.Compute. Concretely,
this package owns its own errors
([`shared/errors.ts`](./src/shared/errors.ts)), logging ([`shared/logger.ts`](./src/shared/logger.ts))
and base64 decoding ([`shared/encoding.ts`](./src/shared/encoding.ts)) rather than importing them
from `@selvajs/compute`.

The Grasshopper response envelope `getThreeMeshesFromComputeResponse` accepts is declared
structurally in [`parse/webdisplay/response-envelope.ts`](./src/parse/webdisplay/response-envelope.ts)
— only the fields the parser reads. Compute's `GrasshopperComputeResponse` is a superset and stays
assignable to it, so passing one in is unchanged.

`@selvajs/schemas` used to be a dependency, needed only by `session/`. That layer is now
`@selvajs/solve/client` (see [`docs/plans/solve-package.md`](../../docs/plans/solve-package.md)), so
the dependency is gone and every sub-path is Selva-free.

### Unified logging

The package logs nothing by default. To route its output into a host's logger — including
`@selvajs/compute`'s, so both packages share a sink:

```ts
import { setLogger } from '@selvajs/visualization/render';
import { getLogger } from '@selvajs/compute';

setLogger(getLogger());
```

## Peer dependencies

`three` (>=0.179.0) is a peer dep — the host app owns the single `three` instance. Installing a
second copy breaks `instanceof` checks across the boundary.
