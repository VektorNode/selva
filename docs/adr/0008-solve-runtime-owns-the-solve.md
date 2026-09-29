# ADR 0008: A Per-Document Solve Runtime Owns the Solve, Not the UI Builder

> **Status: Accepted (2026-09-29).** Tracked in the plan
> [solve-events-structure.md](../../plans/features/solve-events-structure.md). Builds on
> [ADR 0002](./0002-grasshopper-bridge-seam.md): the solve runtime described here sits below the
> bridge that ADR splits.

## Problem

Everything that happens _during_ a solve lives inside the UI Builder feature:

- the solve id and its start/end;
- live events;
- the blocked/aborted verdict;
- abort handling.

Those concerns are spread over `DocumentEventManager`, `ServerLifecycleManager`,
`BridgeOrchestrator` and the component itself.

Three things go wrong because of that:

- **Most of it is only needed locally.** The UI Builder's jobs are the schema designer, document
  sync and the local WebSocket bridge. On Compute it does almost nothing except output the
  embedded schema. The solve lifecycle is the one part that matters in both environments, and it
  is fused to the part that doesn't.
- **The Compute hook depends on canvas order.** The callback session starts from the UI Builder's
  `SolveInstance`, and Grasshopper solves in document order, not dependency order. When the
  component is late in the object list, the heartbeat and abort polling start late.
- **Other components already need it.** `GH_Message` (ComputeIO) emits events today, and progress,
  value lists and file exports will too. Each one would reach into UI Builder internals.

## Decision

Keep one component on the canvas. Split the code under it into three layers, with dependencies
pointing down only:

```
UI Builder component   schema carrier + designer. Calls SolveRuntimes.For(doc) like any component.
        │
Local bridge           WS/HTTP server, value apply, sync, broadcasts. ADR 0002's split applies here.
        │ registers as a transport
Solve runtime          one per GH_Document, works on both local and Compute:
                       solve id + start/end, event sink, SolveOutcome, abort, per-solve context.
                       Transports: local (from the bridge) | Compute callback | none.
```

- **The solve runtime is not a component.** It is created lazily by the first Selva component
  that solves in a document. It subscribes to that document's `SolutionStart`/`SolutionEnd`
  itself, so no author places it, wires it, or can forget it. It lives in
  `Features/SolveRuntime/Services/`; the bridge also creates it when it registers on a
  document, so local events carry the first solution's id.
- **Its decisions are Rhino-free and linked into `Selva.Tests`.** That covers the callback session
  state machine, the event queue and building `SolveOutcome`. The Grasshopper-facing shell only
  subscribes to events and calls `RequestAbortSolution`.
- **The bridge decides nothing about a solve.** It sends what the runtime decided. The
  blocked-vs-outputs branch leaves `DocumentEventManager`.
- **The UI Builder component keeps its inputs and outputs.** Nothing on the canvas changes, so
  there is no OBSOLETE/upgrader step.

## Consequences

- **Adding a solve feature (progress, probe mode, per-solve context) is a runtime change** plus
  an emitter. The bridge and the UI Builder don't change.
- **A canvas component exists only for something an author does.** A "Report Progress"
  component, for example, is an emitter like `GH_Message`, with no wire to the UI Builder.
- **Lazy creation still depends on the first Selva component to solve.** On Compute the runtime
  reads the per-request constants whenever it starts, so a late start costs heartbeat time, not
  correctness. The fork could make the start order-independent by invoking a plugin hook before
  `NewSolution`, the same reflection seam `ISelvaSerializableGoo` uses. We have not taken that
  step yet.

## Rejected

- **A dedicated "Selva Runtime" canvas component.** A definition without one would silently lose
  events and abort, and authors would have to learn to place it.
- **Leaving it in the UI Builder and splitting files only.** The ownership problem stays, and
  every emitter keeps depending on UI Builder internals.
