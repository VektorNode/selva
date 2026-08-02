# `@selvajs/solve`

One owner for the solve flow — **from an input change to a solve result, on both sides of the wire,
with no transport and no UI.**

Before this package the solve flow was scattered across four packages and owned by none of them, so
both apps hand-wrote a solve coordinator — one of them paid for it with a poisoned-cache bug.

## Layout

```
shared/   the vocabulary both halves speak — SolveResult, SolveFn, SolveInput, input keying
client/   form state machine, auto/manual decision, throttle, result memo, driver seam
server/   solve pipeline (tree build → solve → serialize → envelope), caches, single-flight
```

`client/` and `server/` both depend on `shared/`, and **never on each other**. See
[`src/server/README.md`](./src/server/README.md#node-only-and-that-is-load-bearing) for how that's
enforced.

See [`src/client/README.md`](./src/client/README.md) for the session, the driver seam, and how to
write a transport; [`src/server/README.md`](./src/server/README.md) for the pipeline and the cache
tiers.

## What it must never know

- **No UI framework.** No Svelte, no runes, no DOM. `client/` is a state machine, not a component.
- **No renderer.** No `three`. `SolveResult<TMesh>` keeps meshes opaque — the app that parses a
  response into `THREE.Object3D[]` is the only place that knows the concrete type. This is what lets
  a headless CLI solve without dragging in a parse layer. See
  [`src/client/README.md`](./src/client/README.md#mesh-ownership-is-injected-not-known-here) for how
  the result memo handles mesh ownership without knowing what a mesh is.
- **No authorization, orgs, projects, or share links.** App policy.
- **No HTTP.** `client/` stops at a `SolveFn`; `server/` stops at a `SolveOutcome`. Mapping either to
  a status code is the app's job.

## No root barrel — on purpose

`@selvajs/solve` exports `./shared`, `./client` and `./server`. There is deliberately no `.` export:
a root barrel re-exporting both halves would let a browser bundle reach server code — and server
credentials — through one innocent-looking import, defeating every other guard. Adding one is a
boundary change, not a convenience.

```ts
import type { SolveResult } from '@selvajs/solve/shared';
```

```ts
import { createSolveSession, createRequestResponseDriver } from '@selvajs/solve/client';
import { runSolvePipeline } from '@selvajs/solve/server';
```

`@selvajs/server/compute` keeps only the HTTP request policy it owns (limits, rate limiting, the
SSRF guard, remote-definition fetch) and does not re-export any of this — the two packages are
independent.
