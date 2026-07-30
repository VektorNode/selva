# `@selvajs/solve`

One owner for the solve flow — **from an input change to a solve result, on both sides of the wire,
with no transport and no UI.**

Before this package the chain was scattered across four packages and owned by none of them, so both
apps hand-wrote a solve coordinator (and one of them paid for it with a poisoned-cache bug). See
[docs/plans/solve-package.md](../../docs/plans/solve-package.md).

## Layout

```
shared/   the vocabulary both halves speak — SolveResult, SolveFn, SolveInput, input keying
client/   form state machine, auto/manual decision, throttle, result memo, driver seam   (Phase 2)
server/   solve pipeline (tree build → solve → serialize → envelope), L2 cache, single-flight (Phase 3)
```

`client/` and `server/` both depend on `shared/`, and **never on each other**.

## What it must never know

- **No UI framework.** No Svelte, no runes, no DOM. `client/` is a state machine, not a component.
- **No renderer.** No `three`. `SolveResult<TMesh>` keeps meshes opaque — the app that parses a
  response into `THREE.Object3D[]` is the only place that knows the concrete type. This is what lets
  a headless CLI solve without dragging in a parse layer.
- **No authorization, orgs, projects, or share links.** App policy.
- **No HTTP.** `client/` stops at a `SolveFn`; `server/` stops at a `SolveOutcome`. Mapping either to
  a status code is the app's job.

## No root barrel — on purpose

`@selvajs/solve` exports `./shared`, and (once they land) `./client` and `./server`. There is
deliberately **no `.` export**: a root barrel re-exporting both halves would let a browser bundle
reach server code — and server credentials — through one innocent-looking import, defeating every
other guard. Adding one is a boundary change, not a convenience.

```ts
import type { SolveResult } from '@selvajs/solve/shared';
```

## Status

Phase 1 (scaffold + `shared/`) landed. `client/` and `server/` are Phases 2 and 3 of the plan.
