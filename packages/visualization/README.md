# `@selvajs/visualization`

A headless, extensible viewer core. Owns **parse → scene → render → session** as one
framework-free package: no Svelte, no runes, `three` as a peer dep. Consumers build their own UI
over it.

## Layer boundaries & dependency direction

Layers depend **downward only**. A contributor can predict where code lives from what it depends on.

```
session/   pure state machine + drivers   ─depends→ (nothing below; transport-agnostic)
   │
scene/     SceneOutliner: reads a live THREE.Scene → content list, layers, visibility, selection
   │  ↓ depends on `three` only — it reads the scene graph, render/ owns its contents
render/    THREE scene setup + CAD viewer toolkit (camera, edges, grid, gizmo, measure…)
   │  ↓
parse/     backend payload → THREE meshes + metadata (webdisplay, display-items)
   │  ↓
shared/    coordinate frame, look presets, geometry/color utils, common types
```

`session/` is intentionally independent of `scene`/`render`/`parse` — it only knows `SolveResult`
(inputs→outputs+meshes). That's what lets one session drive both WebSocket (plugin) and
Rhino.Compute (cloud) transports, and lets a headless consumer solve without ever rendering.

**Each layer has its own barrel (`index.ts`) — the only cross-layer import surface.** Files inside a
layer import siblings by relative path; other layers import the barrel. That way a layer's internals
can be refactored freely without touching consumers.

## Current status

Migration in progress (see `docs/plans/visualization-package.md`). Landed so far:

| Layer      | Status                                                             |
| ---------- | ------------------------------------------------------------------ |
| `shared/`  | ✅ coordinate frame, looks, geometry/color utils, types            |
| `parse/`   | ✅ webdisplay + display-items                                      |
| `render/`  | ✅ scene setup, edges, camera, grid, gizmo, labels, measure        |
| `scene/`   | ✅ outliner: content filter, layer grouping, visibility, selection |
| `session/` | ✅ solve session, drivers, throttle, memo, external inputs         |

All five layers have landed. `@selvajs/compute` no longer depends on `three` at all — it is pure
solve/data — and `@selvajs/ui` keeps only the Svelte shells (`Viewer.svelte`, `SceneManager.svelte`,
`useSolveSession.svelte.ts`) plus the design system.

## Sub-path exports

Mirror the layers so consumers tree-shake:

```ts
import { parseComputeResponse } from '@selvajs/visualization/parse';
import { initThree, addEdges } from '@selvajs/visualization/render';
import { LOOKS, parseColor } from '@selvajs/visualization/shared';
import { createSceneOutliner } from '@selvajs/visualization/scene';
import { createSolveSession, createRequestResponseDriver } from '@selvajs/visualization/session';
```

`session/` is framework-free: its state reads through plain getters plus a `subscribe()`
seam. In a Svelte app use `useSolveSession` from `@selvajs/ui`, which republishes those
notifications as rune state — see [`src/session/README.md`](./src/session/README.md).

`scene/` is framework-free too, but takes the simpler route: its state is three sets, so a host
injects its own (`SvelteSet` in a Svelte app) and gets reactivity with no seam at all — see
[`src/scene/README.md`](./src/scene/README.md).

Or take everything from the top barrel: `@selvajs/visualization`.

## Dependencies

`shared/`, `parse/`, `render/` and `scene/` depend on **nothing from Selva** — only `three`,
`rhino3dm` and `fflate`. Mesh conversion and the viewer work for a consumer who has neither Selva
nor Rhino.Compute. Concretely, this package owns its own errors
([`shared/errors.ts`](./src/shared/errors.ts)), logging ([`shared/logger.ts`](./src/shared/logger.ts))
and base64 decoding ([`shared/encoding.ts`](./src/shared/encoding.ts)) rather than importing them
from `@selvajs/compute`.

The Grasshopper response envelope `getThreeMeshesFromComputeResponse` accepts is declared
structurally in [`parse/webdisplay/response-envelope.ts`](./src/parse/webdisplay/response-envelope.ts)
— only the fields the parser reads. Compute's `GrasshopperComputeResponse` is a superset and stays
assignable to it, so passing one in is unchanged.

**`session/` is the one exception**: it depends on `@selvajs/schemas`, because projecting a Selva UI
schema into solve inputs is what it does. It is slated to move out to `@selvajs/solve/client` — see
[`docs/plans/solve-package.md`](../../docs/plans/solve-package.md). Until then, importing
`@selvajs/visualization/session` (or the root barrel) pulls in `@selvajs/schemas`; the four sub-paths
above do not.

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
