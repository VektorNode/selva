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
a result is later _reported_ back to it. The reactive (`$state`-backed) wrapper lives
in `lib/compute/createSolveSession.svelte.ts`; the pure, framework-free transition
logic lives in `lib/compute/solve-session-core.ts` and is unit-tested directly.

> The split exists because this package's vitest runs in a node environment without
> the Svelte vite plugin (see `vitest.config.ts`), so `$state` runes can't execute in
> tests. Keep all decision logic in the pure core where it's testable; the rune wrapper
> stays a thin delegation shell. Don't write `.test.ts` files that import runes-using
> `.svelte.ts` modules — they fail at `$.state is not a function`.

## Solve Driver

The adapter that gives a Solve Session its transport. A driver knows how to _start_ a
solve for a set of values and how to _cancel_ an in-flight one, and reports its
`isSolving` state. It does not return outputs — outputs come back asynchronously via
the session's `report()` (see below), because some transports (WebSocket) push results
on their own schedule.

Two adapters define this seam:

- **Request/response driver** — wraps `createComputeThrottle` + a `SolveFn` (`onSolve`).
  Calls `session.report()` when the solve promise resolves. Ships today.
- **WebSocket driver** — sends values over the socket; reports when output frames
  arrive. Designed-for, built when `plugin-ui`'s `usePreviewState` is migrated.
  Transport quirks (value preparation, mesh-blob streaming, remote-update guards) stay
  inside this adapter — the session never learns them.

## report

How a completed solve re-enters the Solve Session. The driver (or its host) calls
`session.report(result)` with the outputs/errors/warnings/meshes. The session merges
the result into `values` and applies the post-solve lifecycle transitions (clear
pending, clear never-solved). Report-based (not return-based) so push transports fit
without contortion.
