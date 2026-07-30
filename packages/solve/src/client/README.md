# `client/` — inputs → solve → outputs

The value and lifecycle state machine that sits between a schema-driven UI and a solver.
It owns the input/output `values` map, the solve-gating rules (`instanceSolve`), the
pending-changes / never-solved flags, the compute errors/warnings, the display meshes, and
how all of these reset when the active definition changes.

**It knows only `SolveResult` from `shared/`** — inputs go out, outputs and meshes come back.
That is what lets the same session drive a WebSocket (the Grasshopper plugin) or a
Rhino.Compute HTTP call (the cloud app), and what lets a headless consumer solve without ever
rendering. It must never import `../server/*`.

## Contents

| File                          | Owns                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `solve-session.ts`            | `createSolveSession` — state ownership + the subscriber set      |
| `solve-session-core.ts`       | the pure transition logic every decision goes through            |
| `drivers/driver.ts`           | `SolveDriver` + `SolveReporter` — the transport seam             |
| `drivers/request-response.ts` | `createRequestResponseDriver` (memo + throttle over a `SolveFn`) |
| `async-throttle.ts`           | single-in-flight, latest-wins dispatch pacing                    |
| `solve-memo.ts`               | client-side LRU result cache (delegates mesh ownership)          |
| `external-storage.ts`         | client-sourced input transit storage                             |

## Reactivity: the `subscribe()` seam

The session is **framework-free**. State is exposed as plain getters, and every mutation
fires `subscribe()` listeners. Reading a getter without subscribing gives a correct value
but nothing re-renders.

A reactive host subscribes once and republishes into its own framework:

```ts
let version = $state(0);
$effect(() => session.subscribe(() => (version += 1)));
// then read `version` inside any getter that exposes session state
```

`@selvajs/ui` ships exactly that as `useSolveSession` — use it instead of hand-rolling one
in a Svelte app.

**`isSolving` is the exception.** It forwards to the driver, which the session cannot
observe. A driver that owns its own in-flight flag must call `session.notify()` on every
transition, or the spinner never moves:

```ts
const driver = createRequestResponseDriver(onSolve, () => session, {
	onChange: () => session.notify()
});
```

## Extension point: writing a driver

A driver gives the session its transport. It knows how to _start_ and _cancel_ a solve and
reports `isSolving`. It does **not** return outputs — results come back asynchronously via
the reporter, which is what lets a push transport satisfy the same interface as a
request/response call.

```ts
const myDriver: SolveDriver = {
	solve(values) {
		/* send them */
	},
	cancel() {
		/* abort in-flight */
	},
	get isSolving() {
		return inFlight;
	},
	clearCache() {} // optional: only if you memoize
};
```

Then feed results back with `getReporter().report({ outputs, meshes, errors, warnings })`,
or `reportError(message)` on a transport failure.

Transport quirks — value preparation, mesh-blob streaming, remote-update guards — stay
inside the driver. The session never learns them. `plugin-ui`'s WebSocket driver lives in
that package rather than here for exactly this reason: it is transport-specific, but it
satisfies this interface.

Reach for `createAsyncThrottle` if your transport needs single-in-flight latest-wins
semantics, and `createSolveMemo` if repeated inputs should skip the round-trip. Both are
exported so a custom driver doesn't re-derive them.

## Mesh ownership is injected, not known here

A `SolveResult` can carry live renderer objects, and a viewer takes ownership of every mesh
array it renders — disposing the previous content on the next scene update. So a memo that
stored those objects by reference would serve an already-disposed mesh on the next hit, and
would leak GPU buffers on eviction (audit C1).

`solve-memo.ts` handles that **without knowing what a mesh is**: `TMesh` is opaque and the
clone/release policy is a `MeshPolicy<TMesh>` the host passes in. The three.js implementation
lives in `@selvajs/visualization/parse` (`meshPolicy`), beside the viewer whose disposal rule
creates the requirement. This is what keeps `three` out of this package entirely.

```ts
import { meshPolicy } from '@selvajs/visualization/parse';
const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
```

Omit it and the memo stores meshes by reference — correct only when nothing disposes what it
hands out.
