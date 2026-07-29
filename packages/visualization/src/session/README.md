# `session/` — inputs → solve → outputs

The value and lifecycle state machine that sits between a schema-driven UI and a solver.
It owns the input/output `values` map, the solve-gating rules (`instanceSolve`), the
pending-changes / never-solved flags, the compute errors/warnings, the display meshes, and
how all of these reset when the active definition changes.

**This layer is independent of `scene/`, `render/` and `parse/`.** A session only knows
`SolveResult` — inputs go out, outputs and meshes come back. That is what lets the same
session drive a WebSocket (the Grasshopper plugin) or a Rhino.Compute HTTP call (the cloud
app), and what lets a headless consumer solve without ever rendering.

## Contents

| File                          | Owns                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `solve-session.ts`            | `createSolveSession` — state ownership + the subscriber set      |
| `solve-session-core.ts`       | the pure transition logic every decision goes through            |
| `drivers/driver.ts`           | `SolveDriver` + `SolveReporter` — the transport seam             |
| `drivers/request-response.ts` | `createRequestResponseDriver` (memo + throttle over a `SolveFn`) |
| `compute-throttle.ts`         | single-in-flight, latest-wins dispatch pacing                    |
| `solve-memo.ts`               | client-side LRU result cache (owns mesh GPU lifetime)            |
| `external-storage.ts`         | client-sourced input transit storage                             |
| `solve-fn.ts`                 | `SolveFn` / `SolveResult`                                        |

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

Reach for `createComputeThrottle` if your transport needs single-in-flight latest-wins
semantics, and `createSolveMemo` if repeated inputs should skip the round-trip. Both are
exported so a custom driver doesn't re-derive them.

## Note on `three`

`solve-memo.ts` imports `three`. A `SolveResult` carries live scene objects and the viewer
disposes what it renders, so the memo must clone on the way in and out and dispose on
eviction or it leaks GPU buffers (audit C1). This is the one place `session/` touches the
renderer — `three` is already a peer dependency of the package, and keeping the ownership
rule next to the cache that breaks it is worth more than a hook that pushes the same three
lines onto every host.
