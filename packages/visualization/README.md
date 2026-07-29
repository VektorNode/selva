# `@selvajs/visualization`

A headless, extensible viewer core. Owns **parse → scene → render → session** as one
framework-free package: no Svelte, no runes, `three` as a peer dep. Consumers build their own UI
over it.

## Layer boundaries & dependency direction

Layers depend **downward only**. A contributor can predict where code lives from what it depends on.

```
session/   pure state machine + drivers   ─depends→ (nothing below; transport-agnostic)
   │
scene/     SceneController: parse-output → live THREE.Scene, visibility/selection/layers
   │  ↓ consumes render/ for helpers, parse/ types
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

| Layer      | Status                                                  |
| ---------- | ------------------------------------------------------- |
| `shared/`  | ✅ coordinate frame, looks, geometry/color utils, types |
| `parse/`   | ✅ webdisplay + display-items                           |
| `render/`  | ⏳ still in `@selvajs/compute/visualization`            |
| `scene/`   | ⏳ still in `@selvajs/ui` (`SceneManager.svelte`)       |
| `session/` | ⏳ still in `@selvajs/ui` (`src/lib/compute`)           |

## Sub-path exports

Mirror the layers so consumers tree-shake:

```ts
import { parseComputeResponse } from '@selvajs/visualization/parse';
import { LOOKS, parseColor } from '@selvajs/visualization/shared';
```

Or take everything from the top barrel: `@selvajs/visualization`.

## Peer dependencies

`three` (>=0.179.0) is a peer dep — the host app owns the single `three` instance. Installing a
second copy breaks `instanceof` checks across the boundary.
