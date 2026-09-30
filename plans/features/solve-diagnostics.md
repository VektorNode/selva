# Solve diagnostics: a Message component and a shared diagnostic channel

A Selva **Message** component that emits a remark, warning, or error from the canvas, where an
error aborts the useful result of the solve; plus the plumbing that carries those messages to the
web UI identically in local Grasshopper and in deployed (Rhino.Compute) Selva.

## Why this doesn't exist yet

The pieces are all present and none of them are joined.

Deployed Selva already renders solve diagnostics: Rhino.Compute returns `errors[]`/`warnings[]`,
the pipeline passes them through untouched, and they land in `session.computeErrors` /
`computeWarnings`, which `PageFooter` renders as a badge opening `ComputeMessagesDialog`.

Local Grasshopper renders none of it. `createWebSocketSolveDriver` reports a `SolveResult` with no
`errors`/`warnings` field, and `applySolveResult` unconditionally assigns
`state.computeErrors = result.errors ?? []` — so **every local solve resets the diagnostics to
empty**. Grasshopper runtime messages do reach the browser, but on a separate `runtimeMessage`
envelope that bypasses the session entirely and only raises a toast.

So the asymmetry is the opposite of what you'd guess: the deployed path has the richer UI, and the
local path — the one with a live WebSocket — is the one that drops the data.

Nothing anywhere in `Plugin/` reads `IGH_ActiveObject.RuntimeMessages`. Every one of the ~200
`GH_RuntimeMessageLevel` references is Selva writing its own message, never inspecting another
component's. A downstream component erroring mid-solve is invisible to the web UI today.

## Why a dedicated component rather than scanning for errors

Blocking on _any_ error-level runtime message anywhere in the document would break working
definitions. Selva's own `ValueApplicator` emits `Error`-level messages for routine input-coercion
problems, and `cacheerroredsolves` exists precisely because "some definitions throw GH errors by
design (a guarded Python component, a filtered branch) while still producing correct geometry".

An explicit component makes the blocking intent authored rather than inferred. It also gives the
message a place to live: a scan finds an error string, a component owns a message the author wrote.

Rejected alternatives:

- **Scan all components for error state.** Breaks existing definitions, as above.
- **Per-component "solve-critical" toggle** persisted in the schema. Adds per-component state to
  persist and sync, and has no equivalent on the Compute path, where there is no schema at solve
  time.

## "Stop the solve" means reject the result, not halt execution

Grasshopper has no mid-solution abort. There is no `RequestAbortSolution`, the `SolutionEnd`
handler already receives a `GH_SolutionEventArgs` it never inspects, and there is no inbound
`cancel` message on the WebSocket. `ComponentStateManager.MergePendingValues` is coalescing, not
cancelling — a running solve always completes.

So an error-level Message gates _output emission_, not computation. Everything downstream still
runs. This costs nothing in correctness but does not save solve time on an expensive downstream
branch; the only real lever for that is authoring the guard so its failing branch outputs nothing,
which makes downstream components solve trivially on empty data.

This is worth stating plainly in the component's own description, because "stop solving" is what
users will expect it to do.

## The three levels

| Level     | Outputs        | Rationale                                               |
| --------- | -------------- | ------------------------------------------------------- |
| `remark`  | flow normally  | informational; no gate                                  |
| `warning` | flow normally  | author wants attention, not a block                     |
| `error`   | **suppressed** | the result is not trustworthy; emit the message instead |

Only `error` needs gating logic. Remark and warning are pure passthrough on a channel that already
exists — which is why the level split costs almost nothing to add.

Grasshopper's `GH_RuntimeMessageLevel` is already exactly these three (`Remark`, `Warning`,
`Error`), so the component maps 1:1 onto `AddRuntimeMessage` and inherits canvas balloon rendering
for free. On Compute, an `Error` runtime message is what populates the response's `errors[]`, so
the deployed path needs no plugin-side gating at all — it already refuses to serve the result.

## Component shape

`Selva > Utilities`, a new GUID, no OBSOLETE procedure needed (nothing released to break).

```
Message
  in   Condition (bool, item)   — true = pass, false = raise
       Message   (string, item) — shown when raised
       Level     (int, item)    — 0 remark, 1 warning, 2 error; default 2
  out  Passed    (bool, item)   — mirrors Condition, so it can gate a stream
```

Inverting to a `Condition` that is _true when healthy_ reads better on canvas than a `Fail` input:
`Passed` can be wired straight into a `Stream Gate` or `Cull` so the failing branch produces no
geometry, which is the only way to actually save downstream solve time.

`SolveInstance` calls `AddRuntimeMessage(level, message)` when the condition is false. That single
call is what both transports key off — no separate registry, no static state, and it keeps working
if someone uses the component outside a Selva bridge.

Open question: `Level` as an int input versus a component menu dropdown. An input lets the level be
computed (escalate to error past a threshold); a dropdown is cleaner on canvas. Leaning input,
since the dropdown can be added later as a value-list companion without changing the param list —
and changing the param list after release is the expensive move.

## Carrying the messages

### Local Grasshopper

Collect in `GH_UIBuilderComponent._onSolutionEnded`, inside the existing `wasActuallySolving`
block, next to `CollectAndBroadcastOutputs`. That handler already holds the document and runs after
every solve.

The scan must walk `document.Objects` in full and cannot be limited to Message components: an
author will reasonably expect a Python component's error to show up too. The distinction that
matters is **which errors gate the outputs**, not which are reported. So: report every runtime
message found, gate only on those from a Message component. That keeps the reporting generous and
the blocking precise, and it means the noisy `ValueApplicator` errors surface as messages without
silently killing a solve.

`FindContextBakes` is the model for the walk, and the display-collection rule applies here for the
same reason: full-scan the document, never trust an incremental cache, or undo/paste desyncs it.

### Deployed (Rhino.Compute)

Nothing to build. `AddRuntimeMessage(Error, ...)` already populates the response `errors[]`, which
already reaches `session.computeErrors`. The Message component works there the moment it exists.

### Joining the two

The convergence point is `createWebSocketSolveDriver`: have it populate `errors`/`warnings` on the
`SolveResult` it reports, and local GH inherits the footer badge and dialog that deployed Selva
already has. This is the single highest-value change in the whole sketch — it is small, and it
retires the "local drops diagnostics" asymmetry regardless of whether the Message component ships.

The natural carrier is the existing `outputs` envelope rather than a second channel, so messages
and the outputs they describe arrive together and cannot interleave wrongly. `runtimeMessage` stays
as-is for transient bridge-internal notices (connection problems, sync failures) — things that are
not _about_ a solve and correctly belong in a toast rather than the solve's diagnostic list.

An error-gated solve still sends an `outputs` envelope, carrying the diagnostics and no outputs.
Sending nothing would leave the UI unable to distinguish "blocked" from "still solving".

## Where the levels already work

`runtimeMessage.level` is `z.string()`, not a union, and the toast handler in
`plugin-ui/src/routes/+layout.svelte` already switches on `error` / `warning` / `info` / `remark`
with a default fallback. So the three-level vocabulary needs no TypeScript schema change. The one
mismatch is C#-side: `BridgeOrchestrator.ConvertMessageLevel` maps `Remark` to `"info"`, which
should become `"remark"` so the vocabulary is the same word on both sides of the wire.

## Solve state, and why it is a separate concern

Worth separating two things that sound alike:

- **Solve state** — is a solve running? Already handled: `solvingState` on the WebSocket,
  `session.isSolving` on both paths. Not broken, not part of this.
- **Solve outcome** — did it produce a trustworthy result? This is what's missing, and adding a
  `blocked` outcome is what lets the UI say "this solve was refused" rather than showing stale
  geometry beside an error badge.

The existing state is a boolean `isSolving`. The outcome wants a third value alongside "succeeded"
and "transport failed", and `SolveSession` already has two non-interacting error channels —
`error` (transport, a single string, full-page takeover) and `computeErrors` (solve, an array,
footer dialog). A blocked solve is semantically the second, so it needs no new channel; it needs
the UI to distinguish "solved with errors" from "refused to solve", which is one boolean.

## The structured-diagnostic question

Everything above moves flat `string[]`s, matching what Rhino.Compute gives us and what the dialog
renders. That is deliberate: it is the shape that works on both paths today with no widening.

But the strings carry no attribution. `runtimeMessage` has no component identity, and Compute's
`errors[]` is flat strings with no GUID or param id. So the UI can say _what_ went wrong but never
_where_, and "which component failed" is the obvious next question a user asks.

`ui-schema.json` already defines `ValidationIssueMessage` — `paramId`, `severity: warning|error`,
`message`, `details.expected/actual` — which is close to the right shape. It is orphaned from
`UISchema` and used only by preset import/export. Widening `severity` to three levels and reusing
it would give structured diagnostics a type that already generates into both TypeScript and C#.

Not proposing that yet. The deployed path can't fill in attribution without a Compute-side change,
so doing it now would build a structured channel that only ever carries structure on one of the two
paths. Flat strings first; revisit if "which component" turns out to be the real ask.

Related: `SolveReporter.reportError(message: string)` takes one string and cannot express severity,
a param id, or multiplicity. Any structured future goes through widening that signature.

## Contracts to respect

- **Wire fixtures.** `WireFixtureContractTests` reflects over `OutboundEnvelopes`'s public static
  methods and fails if any lacks a committed fixture in `packages/schemas/fixtures/wire/`.
  Changing the `outputs` envelope means updating its fixture; regenerate with
  `UPDATE_WIRE_FIXTURES=1 dotnet test --filter WireFixtureContractTests`.
- **Unknown message types pass through unvalidated** by design, so adding a type is non-breaking —
  but extending an existing envelope is not, and `outputs` is the one being extended.
- **Three inconsistent error contracts** exist for the same condition: `GrasshopperClient.solve()`
  throws `COMPUTATION_ERROR`, `SolveScheduler.solve()` resolves with errors intact, and
  `handleResponse` treats an HTTP 500 carrying `values` as success. The server pipeline uses the
  scheduler, so the throw is not what deployed Selva hits. Adding a fourth caller without picking
  one of these is how the next silent divergence starts.

## Decisions still open

1. `Level` as an input versus a menu dropdown (leaning input, see above).
2. Whether a blocked solve clears the viewer or leaves the last good scene standing. Clearing is
   honest; retaining is better for live editing. Retaining needs client-side "last good result"
   state, which the session does not have today.
3. Whether non-Message error messages should be reportable-but-not-blocking (proposed above) or
   suppressed entirely to keep the dialog quiet.
