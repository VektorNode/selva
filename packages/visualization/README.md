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
shared/    coordinate frame, look presets, geometry/color utils, common types
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

Migration in progress (see `docs/plans/visualization-package.md`). Landed so far:

| Layer     | Status                                                             |
| --------- | ------------------------------------------------------------------ |
| `shared/` | ✅ coordinate frame, looks, geometry/color utils, types            |
| `parse/`  | ✅ webdisplay + display-items                                      |
| `render/` | ✅ scene setup, edges, camera, grid, gizmo, labels, measure        |
| `scene/`  | ✅ outliner: content filter, layer grouping, visibility, selection |

All layers have landed, and `session/` has since moved out to `@selvajs/solve/client`.
`@selvajs/compute` no longer depends on `three` at all — it is pure solve/data — and `@selvajs/ui`
keeps only the Svelte shells (`Viewer.svelte`, `SceneManager.svelte`, `useSolveSession.svelte.ts`)
plus the design system.

## Sub-path exports

Mirror the layers so consumers tree-shake:

```ts
import { parseComputeResponse } from '@selvajs/visualization/parse';
import { initThree, addEdges } from '@selvajs/visualization/render';
import { LOOKS, parseColor } from '@selvajs/visualization/shared';
import { createSceneOutliner } from '@selvajs/visualization/scene';
```

`scene/` is framework-free too, but takes the simpler route: its state is three sets, so a host
injects its own (`SvelteSet` in a Svelte app) and gets reactivity with no seam at all — see
[`src/scene/README.md`](./src/scene/README.md).

Or take everything from the top barrel: `@selvajs/visualization`.

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
import { setLogger } from '@selvajs/visualization/shared';
import { getLogger } from '@selvajs/compute';

setLogger(getLogger());
```

## Peer dependencies

`three` (>=0.179.0) is a peer dep — the host app owns the single `three` instance. Installing a
second copy breaks `instanceof` checks across the boundary.
