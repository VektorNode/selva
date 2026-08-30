# `@selvajs/solve`

**User moves a slider → a Grasshopper definition runs → geometry comes back.**
This package owns everything between those two points. Nothing else.

```
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│    BROWSER    │          │  YOUR SERVER  │          │ RHINO.COMPUTE │
│               │          │               │          │               │
│  width:  12 ──┼── POST ──┼─► SolveEngine ┼─────────►│   wall.gh     │
│  height: 20   │          │    + caches   │          │     runs      │
│               │◄── JSON ─┼───────────────┼◄─────────┼──             │
│  meshes ✦     │          │               │          │               │
└───────────────┘          └───────────────┘          └───────────────┘
  solve/client               solve/server
```

| You are building…       | You import…             |
| ----------------------- | ----------------------- |
| A web page with sliders | `@selvajs/solve/client` |
| An API endpoint         | `@selvajs/solve/server` |
| Just need the types     | `@selvajs/solve/shared` |

There is no `.` export on purpose — see [Why no root export](#why-no-root-export).

---

## Quickstart: the browser half

Copy this. It is the whole client setup.

```ts
import {
	createComputeFetchSolveFn,
	createRequestResponseDriver,
	createSolveSession
} from '@selvajs/solve/client';

// 1. HOW to reach your server
const solveFn = createComputeFetchSolveFn({
	endpoint: '/api/v1/compute',
	definitionUrl: () => `local:${definitionGuid}`,
	inputs: () => schema.inputs,
	outputs: () => schema.outputs
});

// 2. WHEN to actually send (throttles drags, caches repeats)
const driver = createRequestResponseDriver(solveFn, () => session, {
	solveDeadlineMs: 30_000
});

// 3. WHAT the UI reads and writes
const session = createSolveSession({ schema, scopeKey: definitionGuid, driver });
```

After that, your UI only ever touches `session`:

```ts
session.setValue('width', 12); // writes the value AND triggers a solve
session.values; // → { width: 12, height: 20 }
session.isSolving; // → true while in flight (spinner)
session.meshes; // → geometry to render
session.computeErrors; // → what Grasshopper complained about
```

**You normally never call `solve()` yourself.** `setValue` does it for you. The exception is
manual mode:

| `schema.instanceSolve` | `setValue` does…                           | You call `solve()`…    |
| ---------------------- | ------------------------------------------ | ---------------------- |
| `true` (default)       | writes the value **and** solves            | never                  |
| `false`                | writes the value, sets `hasPendingChanges` | on your "Solve" button |

```svelte
<!-- manual mode: the definition is slow, so the user decides when to run it -->
<button onclick={() => session.solve()} disabled={!session.hasPendingChanges}> Solve </button>
```

### Why three objects and not one

```
   your UI
      │  setValue('width', 12)
      ▼
 ┌───────────┐   "solve these values"   ┌──────────┐
 │  SESSION  │ ──────────────────────►  │  DRIVER  │
 │           │                          │          │
 │ values    │                          │ throttle │ ← drops mid-drag values
 │ isSolving │                          │ memo     │ ← repeat inputs, no network
 │ meshes    │ ◄──────────────────────  │ abort    │ ← cancels superseded solves
 │ errors    │      report(result)      └────┬─────┘
 └───────────┘                               │ calls
                                             ▼
                                        ┌──────────┐
                                        │ SolveFn  │ → fetch → your server
                                        └──────────┘
```

Dragging a slider fires dozens of value changes a second. The **session** doesn't care — it just
records values. The **driver** is what stops you from sending dozens of requests.

Swap the `SolveFn` and the same session runs over a WebSocket, or against a stub in a test.

### In Svelte: one extra step

The session exposes plain getters — no runes. Read them directly in a component and you get
**correct values that never re-render**. Use the wrapper from `@selvajs/ui` instead:

```diff
- const session = createSolveSession({ schema, scopeKey, driver });
+ const session = useSolveSession({ schema, scopeKey, driver });   // from '@selvajs/ui'
```

Rendering geometry too? Two more lines on the driver:

```ts
import { meshPolicy } from '@selvajs/visualization/parse';

const driver = createRequestResponseDriver(onSolve, () => session, {
	solveDeadlineMs,
	meshPolicy, // without this, a cached hit serves an already-disposed mesh
	onChange: () => session.notify() // without this, the spinner never moves
});
```

Both fail silently if you skip them. They are the only two client-side gotchas.

---

## Quickstart: the server half

**One engine per app**, at module scope — it holds warm connections and caches that are worthless
if rebuilt per request.

```ts
// $lib/server/compute/engine.server.ts
import { SolveEngine } from '@selvajs/solve/server';

export const engine = new SolveEngine({ limits: computeLimits, logger });
```

```ts
// routes/api/v1/compute/+server.ts
const outcome = await engine.solve({
	server: serverConfig, // which Rhino.Compute
	definitionSource, // the .gh file (bytes, URL, or cached ref)
	inputs, // the definition's input params
	values, // what the browser sent
	signal: request.signal, // client disconnects → cancel upstream
	acceptEncoding: request.headers.get('accept-encoding') ?? ''
});

return engine.toWebResponse(outcome);
```

`solve()` doesn't throw for an expected failure. It returns one of these, so you can branch before
handing it to `toWebResponse`:

| `outcome.kind`    | What happened               | Becomes                  |
| ----------------- | --------------------------- | ------------------------ |
| `'ok'`            | Geometry is ready           | `200`                    |
| `'timeout'`       | Definition took too long    | `504`                    |
| `'client_abort'`  | User navigated away         | `499`                    |
| `'too_large'`     | Response over the size cap  | `413`                    |
| `'shed'`          | Queue full — retry later    | `503` + `Retry-After`    |
| `'compute_error'` | Rhino.Compute itself failed | rethrown to your handler |

```ts
if (outcome.kind === 'ok') recordMetric('ok', { durationMs: outcome.solveMs });
return engine.toWebResponse(outcome);
```

### What the engine does on your behalf

```
engine.solve()
   │
   ├─ 1. warm client cache ····· reuse the open Rhino.Compute connection
   ├─ 2. definition bytes ······ already uploaded? send a pointer, not the .gh
   ├─ 3. single-flight ········· 5 users, same inputs → 1 actual solve
   ├─ 4. build input tree ······ values → Grasshopper DataTree
   ├─ 5. SOLVE ················· the only slow step
   └─ 6. gzip + Server-Timing ·· ready-to-send envelope
```

Each layer is covered in [`src/server/README.md`](./src/server/README.md).

---

## The one type to know

Every solve, on either side of the wire, returns this:

```ts
interface SolveResult {
	outputs: Record<string, unknown>; // keyed by output id / nickname
	meshes?: unknown[]; // geometry — opaque here, see below
	errors?: string[];
	warnings?: string[];
	source?: unknown; // the raw compute payload, verbatim
	values?: unknown; // the inputs that produced it
}
```

**Why `meshes` is `unknown`:** typing it means importing `three`, and this package is useful
precisely because it has no renderer. A viewer app narrows it at its own seam:
`SolveResult<THREE.Object3D>`.

**Why `values` rides along:** a cached hit never calls your `SolveFn`, so the driver stamps the
inputs onto the result. The pair stays atomic — a "save what I see" button can't mismatch geometry
and inputs.

And the one function you supply:

```ts
type SolveFn = (values: Record<string, unknown>, signal: AbortSignal) => Promise<SolveResult>;
```

`values` is just `{ width: 10, height: 20 }`, keyed by schema input id. That is the entire state a
solve needs.

---

## Why no root export

`server/` uses `node:zlib`, `node:crypto`, and reads compute-server credentials. A `.` barrel
joining both halves would let a browser bundle pull all of that in by accident.

```
      shared/          the types both sides speak
       ╱    ╲
   client/  server/    never import each other
```

Enforced by `no-restricted-imports` and a bundle-boundary test, not by convention.

## Not in this package

| Concern                              | Lives in                       |
| ------------------------------------ | ------------------------------ |
| Svelte / React components            | `@selvajs/ui`                  |
| `three`, mesh parsing, the viewer    | `@selvajs/visualization`       |
| Auth, orgs, share links, rate limits | your route + `@selvajs/server` |
| HTTP status codes                    | `engine.toWebResponse`, opt-in |

## Going deeper

- [`src/client/README.md`](./src/client/README.md) — writing your own driver, the value map, mesh ownership
- [`src/server/README.md`](./src/server/README.md) — cache layers, coalescing, `runSolvePipeline`
