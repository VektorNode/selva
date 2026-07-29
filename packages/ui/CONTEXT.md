# @selvajs/ui — domain language

Terms used across this package's architecture. Use these names exactly; don't drift
into "service", "controller", or "store" for the concepts below.

## Solve Session

The value- and lifecycle state machine that sits between a schema-driven UI and a
solver. It owns the input/output `values` map, the solve-gating rules
(`instanceSolve`), the pending-changes / never-solved flags, the compute
errors/warnings, the display meshes, and how all of these reset when the active
definition changes.

A Solve Session is **transport-agnostic**: it does not know whether a solve runs over
HTTP (Rhino.Compute) or a WebSocket. It only knows that a solve is _started_ and that
a result is later _reported_ back to it.

> **The session itself no longer lives in this package.** It moved to
> `@selvajs/visualization/session`, where it is framework-free: state reads through plain
> getters and every mutation fires `subscribe()` listeners. What stays here is
> `lib/compute/useSolveSession.svelte.ts` — the Svelte binding, which subscribes once and
> bumps a `$state` counter that each getter reads, so session state stays reactive inside
> markup. **Use `useSolveSession`, not `createSolveSession`, in a component.** Calling the
> raw factory compiles and returns correct values, but nothing re-renders.
>
> `isSolving` needs one extra wire: it forwards to the driver, which the session can't
> observe. A driver owning its own in-flight flag must be constructed with
> `onChange: () => session.notify()`.

## Solve Driver

The adapter that gives a Solve Session its transport. A driver knows how to _start_ a
solve for a set of values and how to _cancel_ an in-flight one, and reports its
`isSolving` state. It does not return outputs — outputs come back asynchronously via
the session's `report()` (see below), because some transports (WebSocket) push results
on their own schedule.

Two adapters define this seam:

- **Request/response driver** — wraps `createComputeThrottle` + a `SolveFn` (`onSolve`).
  Calls `session.report()` when the solve promise resolves. Lives beside the session in
  `@selvajs/visualization/session`; used by `ComputeApp`.
- **WebSocket driver** — sends values over the socket; reports when output frames
  arrive. Lives in `plugin-ui` (`lib/schema-source/websocket-solve-driver.ts`) because it
  is transport-specific. Transport quirks (value preparation, mesh-blob streaming,
  remote-update guards) stay inside this adapter — the session never learns them.

## report

How a completed solve re-enters the Solve Session. The driver (or its host) calls
`session.report(result)` with the outputs/errors/warnings/meshes. The session merges
the result into `values` and applies the post-solve lifecycle transitions (clear
pending, clear never-solved). Report-based (not return-based) so push transports fit
without contortion.
