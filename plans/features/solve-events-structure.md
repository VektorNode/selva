# Solve events: defects, a home, and a catalog of kinds

**Unfiled.** Follows [live-solve-channel.md](./live-solve-channel.md), which describes the channel
as built on `felix/state-machine`. This plan covers three things. First, the defects a review of
that branch found. Second, where the event code should live. Third, what adding an event kind
(progress first) should cost.

## Status

Implemented on `felix/state-machine`, plus the fork change on
`compute.rhino3d@feat/8x/selva-live-events`. Verified live on 2026-09-29, locally through the
bridge and on Compute through `compute-e2e/`: blocked, warning, Notify=Log, incidental messages,
abort (reply and 410), recovery after abort, and a value burst mid-solve. A blocked Compute solve now
returns 527 bytes instead of the full display payload. The Selva server's bus, SSE and cancel
routes are covered by unit tests only.

A multi-second stall before the next solve, seen after the showcase's blocked solve, turned out to
be Rhino meshing 200+ sphere Breps for Grasshopper's shaded viewport preview on the UI thread, not
the bridge. The showcase now has every preview turned off.

Where the build differs from the text below:

- **Wire types live in `wire-schema.json`**, not `ui-schema.json`. Only definitions a saved
  `UISchema` reaches are versioned now, so the 2.15.0 bump is gone.
- **No `SolveOutcomeBuilder.cs`.** `SolveDiagnostics.ToOutcome()` and `EndedKind` do the job;
  `DocumentSolveRuntime.Verdict()` collects once per solution and caches it, so `solveEnded`,
  the outputs envelope and `SelvaOutcome` agree.
- **Fixtures sit in `packages/schemas/fixtures/solve/`**, not `fixtures/wire/`: the wire folder
  holds one fixture per WebSocket envelope and its tests enforce that.
- **`finalizeResult` takes no schema.** It drops a rejected solve's outputs; the session still
  nulls the previous solve's output ids in `values`, which only it can name.
- **The library page builds its stream only for a signed-in viewer**, since an eagerly opened
  stream would otherwise retry a 401.
- **The showcase's slow stages report progress** by reaching `EmitProgress` through reflection,
  and check `AbortRequested` between ticks, so an abort lands mid-stage.
- **An aborted verdict keeps only authored messages.** Components the abort skipped each warn
  that their inputs failed to collect data; that is noise from the abort, not the definition.

## Why

Adding one event kind today touches six places. Each one matches the kind by string literal, and
nothing typechecks the payload:

| Where                                          | What it hardcodes                                       |
| ---------------------------------------------- | ------------------------------------------------------- |
| `SolveEventSink.Emit(doc, "diagnostic", dict)` | kind string, untyped `Dictionary<string, object>`       |
| `SolveEventCallbackSender.Emit` queue overflow | `e.Type != "diagnostic"` decides what may drop          |
| `bus.server.ts` `publish`                      | `event.type !== 'diagnostic'` decides the same, again   |
| `SolveMessages.svelte`                         | filters `type === 'diagnostic'`, re-coerces the payload |
| `solve-event-stream.ts`                        | `solveStarted` / `solveEnded` string checks             |
| `ui-schema.json` `SolveEvent.payload`          | `additionalProperties: {}`: no shape per kind           |

The code is scattered too:

- The C# sink and sender sit in `UIBuilder/Services/`, although `ComputeIO`'s `GH_Message`
  already emits through them, and progress will emit from anywhere.
- `runSolve` carries about 30 inline lines of live-channel wiring.
- The callback route parses and normalizes its body itself, which the route-handler rule in
  `CLAUDE.md` forbids.

## Defects

Found reviewing `main...felix/state-machine`. The restructure below fixes the first three by
construction; they are listed so each gets a regression test.

1. **Cloud cancel doesn't stop the Compute solve.** `requestResponseDriver.cancel()` aborts the
   fetch first. The server's `request.signal` fires, and `runSolve`'s `finally` closes the solve
   on the bus. The `cancelCurrent()` POST that follows hits a closed solve and gets a 404, so
   `abortRequested` is never set. The plugin's next post gets a 410, and the sender only ends its
   session. Grasshopper keeps solving for nobody.
2. **Overlapping timer callbacks reorder batches.** `System.Threading.Timer` fires every 50 ms
   whether or not the last `Post` has finished, and a post can block for up to 5 s. Batches race,
   and the bus re-stamps `seq` in arrival order, so the reordering becomes permanent.
3. **An ended session gets recreated.** `EnsureSessionLocked` only reuses a session that has not
   ended. After a 410 or an abort, the next `Emit` with the same `solveId` builds a new session
   and timer, posts, gets a 410, and repeats.
4. **Not a defect: old constants on a reused document.** The fork defines all three constants as
   empty on every request (`ResthopperEndpoints.cs`), so a reused document can't carry old
   values. Fix 3 would cover it plugin-side anyway.
5. **The session's event listener is never removed.** `createSolveSession` subscribes to
   `driver.onEvent` and has no `dispose`. In cloud mode the tab owns the stream, so a session
   discarded after a definition switch keeps receiving events.
6. **A stream can be taken over by id.** `openStream` replaces an entry without checking its
   owner, and `publish` writes without checking either. The 128-bit id makes this defence in
   depth, not an open hole.
7. **The first solve usually has no live channel.** The EventSource opens lazily on first
   subscribe, so it is rarely connected when the first solve runs its `ownsStream` check.
8. **The final flush comment is wrong.** The comment on `Post` says "never the solver", but
   `OnSolutionEnd` posts synchronously on the solver thread. The code is acceptable (see Delivery
   below); the comment is not.

Found by driving the showcase live (see [Testing it live](#testing-it-live)):

9. **Local results arrive one update late.** `ComponentStateManager` debounces a `SolutionStart`
   that lands within 100 ms of the previous end, and the debounce also left `IsSolving` false.
   The dynamic value list reconcile starts exactly such a solve right after each real one. An
   update arriving during it is applied mid-solve instead of coalesced, and its scheduled solution
   only runs when the next message arrives. `IsBusy` has to count any started solve. This bug
   predates the live channel.
10. **Compute can't report an aborted solve.** An aborted Compute solve returns 200 with empty
    outputs and incidental "Input parameter … failed to collect data" warnings. Nothing marks it
    aborted, so the client shows a strange empty result. `SolveOutcome.aborted` below closes this.
11. **A blocked Compute solve still ships its outputs.** 210 spheres returned the full 6.8 MB
    display payload for a result the client discards. See the fork change under `SolveOutcome`.
12. **A queued Compute solve is silent.** Two solves sent at once serialize on the solve lock,
    and the second gets no events at all while it waits. See Open.

## Target structure

### One catalog of event kinds

Each known kind gets a payload definition in `wire-schema.json`: `SolveStartedPayload`,
`SolveEndedPayload`, `DiagnosticPayload`, `ProgressPayload`. `SolveEvent.type` stays an open
string. An unknown kind passes through every hop untouched, so an old client never breaks on a new
plugin.

Each kind also has a **delivery class**, which is the only per-kind rule the transports need:

| Class        | Meaning                                                 | Kinds                                      |
| ------------ | ------------------------------------------------------- | ------------------------------------------ |
| `critical`   | never dropped, never coalesced                          | `solveStarted`, `solveEnded`, `diagnostic` |
| `latest`     | coalesced by `(type, key)`, newest wins, may drop       | `progress` (key = source)                  |
| `bestEffort` | dropped first under pressure. Default for unknown kinds | —                                          |

The codegen does not carry custom schema keywords. So the class table is hand-written once per
stack, and a shared golden fixture that both test suites load keeps the two in step:

- `@selvajs/schemas/src/solve-event-kinds.ts`
- `Selva.Schema/Constants/SolveEventKinds.cs`
- `packages/schemas/fixtures/wire/solve-event-kinds.json`

This is the same cross-stack contract pattern `WireFixtureContractTests` already uses.

### Plugin: `Selva.GH/Features/SolveRuntime/`

A feature folder of its own, because no single feature owns events. Ownership is decided in
[ADR 0008](../../docs/adr/0008-solve-runtime-owns-the-solve.md).

```
Features/SolveRuntime/Services/        flat, per STRUCTURE.md's feature layout
  SolveRuntimes.cs                  SolveRuntimes.For(doc); the process-wide local transport
  DocumentSolveRuntime.cs           per document: solve id, Emit/EmitDiagnostic routing, abort, verdict
  CallbackSession.cs                Rhino-free: queue + reply state machine, below
  ComputeCallbackTransport.cs       timer, HTTP, locking; no decisions
  SolveDiagnostics.cs               Rhino-free verdict model (MarkAborted)
  SolveDiagnosticsCollector.cs      document walk at SolutionEnd
```

Components call typed emitters on `DocumentSolveRuntime` (`EmitDiagnostic` today, `EmitProgress`
next), never `Emit(type, dict)`, so each kind's string and payload shape live in one place.
`CallbackSession` holds every delivery decision, depends on no Rhino type, and is linked into
`Selva.Tests` like `OutputPayloadBuilder`. Class-aware coalescing for `progress` goes in
`CallbackSession.Enqueue`.

**`CallbackSession`.** One session per `solveId`. An ended session is final for its id, so that id
never restarts (fixes 3).

| From   | On                             | Do                                   | To     |
| ------ | ------------------------------ | ------------------------------------ | ------ |
| —      | first emit/hook, new `solveId` | arm timer                            | Active |
| Active | reply 2xx, no abort            | —                                    | Active |
| Active | reply `{abort:true}`           | `RequestAbortSolution`               | Ended  |
| Active | reply 410 before `SolutionEnd` | `RequestAbortSolution` (fixes 1)     | Ended  |
| Active | 401, other non-2xx, exception  | —                                    | Ended  |
| Active | `SolutionEnd`                  | wait for in-flight post, final flush | Ended  |
| Ended  | emit with same `solveId`       | drop                                 | Ended  |

A 410 before `SolutionEnd` means the requester has gone. Aborting is right, and it closes defect 1
without a server-side grace period.

**Delivery.**

- **Single flight.** A one-shot timer, re-armed after each post finishes, so at most one post is
  in flight and batches arrive in order (fixes 2).
- **Final flush stays synchronous** on the solver thread. It runs only when something is queued,
  costs one intra-VPC round trip, and is the only way to guarantee the last batch arrives before
  the server publishes `solveEnded`. Handing it to the timer thread would race `closeSolve`.

### Server: `$lib/server/solveEvents/`

```
bus.server.ts         routing + ownership. Drop rule read from the kinds table
ingest.server.ts      parse/validate the callback body (out of the route)
liveSolve.server.ts   bindLiveSolve(access, streamId, request) → { selvaEvents, end(kind) }
sse.server.ts         SSE framing, heartbeat, Last-Event-ID
token.server.ts
```

- **Routes and `runSolve` delegate.** `runSolve` calls `bindLiveSolve` and `end`. The callback
  route becomes guard + `ingest` + `bus.publish`.
- **Ownership.** `openStream` refuses an existing id held by another owner, and `publish` checks
  the solve's owner against the stream's (fixes 6).
- **Owner key.** The stream and the solve derive it from the same function over the request's
  access. Today the SSE route builds `user:<id>` by hand while the solve uses `rateLimitKey`. The
  two agree only by coincidence, and never on a share link.

### Client: `@selvajs/solve/client`

```
client/
  session/   solve-session.ts, solve-session-core.ts
  events/    solve-event-stream.ts, live-solve.ts
  drivers/
```

- **`live-solve.ts` is a reducer.** It is `reduceLiveSolve(state, event)`, with one case per known
  kind. It produces:

  ```ts
  LiveSolveState {
    solveId: string | null;
    running: boolean;
    diagnostics: SolveDiagnostic[];
    progress: Map<string, ProgressPayload>;   // by source
    ended: { kind: string } | null;
    other: SolveEvent[];                       // unknown kinds, for hosts that want them
  }
  ```

  The session exposes `live: LiveSolveState` instead of raw `liveEvents`. `SolveMessages` reads
  `live.diagnostics` and stops re-parsing payloads. `liveEvents` hasn't been released (it only
  appears in the pending changeset), so the rename is free.

- **Explicit phase.** The session gains
  `phase: 'idle' | 'solving' | 'review' | 'blocked'`, derived in `solve-session-core`.
  `SolveMessages` currently rebuilds it from four booleans, and any other host would have to do
  the same.
- **`dispose()`.** The session gets one and unsubscribes from `onEvent` in it.
  `useSolveSession` calls it on destroy (fixes 5).
- **Open the stream eagerly.** Open it when the host creates it, not on first subscribe (fixes 7).

`index.ts` keeps the same public names. Only the file paths behind them move.

## One conversion layer for local and Compute

Today each environment converts its own wire into `SolveResult`, in its own package, by its own
rules:

| Fact                                        | Local (WS)                                 | Compute (HTTP)                                             |
| ------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Diagnostics                                 | structured `diagnostics[]` on the envelope | flat strings, rebuilt by regex in `compute-diagnostics.ts` |
| Remarks                                     | sent                                       | lost: `LogRuntimeMessages` drops them                      |
| `isGate` / Notify = Log                     | fields                                     | recovered from `[Selva:msg]` / `[Selva:log]` in the text   |
| Blocked                                     | `blocked` flag                             | `[Selva:blocked]` substring                                |
| Aborted                                     | plugin adds a "Solve aborted" gate error   | nothing: the server sees a cancelled request               |
| `solveStarted`/`Ended`                      | never emitted                              | emitted by the Selva server                                |
| Level narrowing, errors/warnings derivation | `websocket-solve-driver.ts`                | `compute-fetch-solve-fn.ts`, written separately            |
| Blanking a blocked result                   | `SolveSession.report`                      | `compute-fetch-solve-fn.ts` too (skips mesh extraction)    |

So each fact about a solve is decided twice, and the Compute copy is lossy. The layer below makes
the plugin decide each fact once and both transports carry that decision. The client then decodes
it in one module.

### `SolveOutcome`: the plugin's verdict

This is a new `wire-schema.json` type, generated into C# and TS:

```
SolveOutcome { diagnostics: SolveDiagnostic[]; blocked: boolean; aborted: boolean }
```

`SolveDiagnostic` moves into the schema with it. It already has the same shape on both sides, but
is hand-written twice.

The plugin builds the outcome once, at `SolutionEnd`, in one Rhino-free function. Today that logic
is split between `DocumentEventManager` and `SolveDiagnosticsCollector`. The function goes to
`Features/SolveRuntime/Services/SolveOutcomeBuilder.cs`. After that, each environment only
**encodes** the outcome:

- **Local:** the `outputs` envelope carries `outcome: SolveOutcome`, replacing its loose
  `diagnostics` and `blocked` fields.
- **Compute:** the plugin writes the outcome as JSON to a document constant, `SelvaOutcome`. The
  fork reads it after the solve and returns it as a top-level `selva: { outcome }` block. The fork
  change is about ten lines beside the existing `SelvaEventUrl` block, and it uses the same
  "constants are the seam" contract. The fork already resets `SelvaEventUrl` on every request, and
  must reset `SelvaOutcome` the same way.
- **Stock Compute, and definitions solved by an older plugin:** no `selva` block arrives. The
  client falls back to `parseComputeDiagnostics`, which becomes the legacy decoder, nothing more.
  The markers stay, because definitions already published depend on them (see
  `SOLVE_BLOCKED_MARKER`).

With the outcome carried structurally, remarks and `aborted` reach the cloud UI, and the regex
path stops being load-bearing.

**Withhold outputs the outcome rejects.** When `SelvaOutcome` says `blocked` or `aborted`, the
fork returns the `selva` block and an empty `values` list instead of serializing the ContextBakes
(defect 11). The client discards them anyway. The decision stays the plugin's: the fork only reads
the flag, it does not judge the solve.

### Client: `@selvajs/solve/shared/outcome.ts`

This is the one decoder, and it is framework- and transport-free:

```ts
decodeOutcome(wire: SolveOutcome): SolveOutcome            // narrows levels, trims, dedupes
outcomeFromComputeMessages(errors, warnings): SolveOutcome // legacy, wraps parseComputeDiagnostics
finalizeResult(partial: { outputs, meshes?, source? }, outcome, schema): SolveResult
```

- **`finalizeResult`** is the only place that derives `errors`/`warnings` from diagnostics and
  blanks outputs and meshes for a blocked or aborted outcome. That rule moves out of
  `SolveSession.report` and `compute-fetch-solve-fn.ts`.
- **The Compute path** calls it with the decoded outcome, and decides whether to extract meshes
  from `outcome.blocked` _before_ parsing.
- **The WS driver** calls it with the envelope's outcome. The driver keeps what really differs per
  transport: binary frames, the ring buffer, and the parse token.

Outputs and meshes stay per transport, because their wire formats really are different. Only the
verdict is shared.

### Same event sequence on both sides

Every solve emits `solveStarted → (diagnostic | progress | …)* → solveEnded { kind }`:

- **Locally**, `DocumentEventManager` emits start and end through the sink at `SolutionStart` and
  `SolutionEnd`. It already calls `BeginLocalSolve` there.
- **On Compute**, the Selva server keeps emitting them.

`solveEnded.kind` uses one vocabulary on both sides: `ok | blocked | aborted | error`. The session
can then treat "a solve is running" identically, instead of treating local as "a solve is always
maybe running".

### Cross-stack check

Put one golden fixture pair in `packages/schemas/fixtures/wire/`:

- `outcome.json`: an envelope with outcome.
- `compute-response-selva.json`: a Compute response with a `selva` block.
- `compute-response-legacy.json`: the same solve through markers only.

C# encodes and asserts equality with the fixtures. TS decodes all three and asserts they yield the
same `SolveOutcome`. Remarks and `aborted` are the one expected difference, because the legacy
path can't carry them. This is the same pattern as `WireFixtureContractTests`.

## Adding a kind, after this

Progress is the first one:

1. Add `ProgressPayload` to `wire-schema.json`, then run `pnpm generate`.
2. Add one row to each kinds table, plus the fixture: `progress → latest, key = source`.
3. Add the C# emitter: `SolveEvents.Progress(doc, source, fraction, label)`.
4. Add the reducer case: `progress` → `state.progress.set(source, payload)`.
5. Render it in the UI.

Nothing in either transport, the bus, the queue or the routes changes.

**Progress payload.** `{ source?: string, fraction: number | null, done?: number, total?: number,
label?: string }`. A null `fraction` means indeterminate.

**Progress sources.** There are two:

- **Component-authored**, through the emitter above.
- **Document-level**, which the sender samples from `SolutionProgress` on the heartbeat, so its
  rate is fixed whatever the graph does. It is blocked on the unverified question in the
  live-channel plan: can the timer thread read `SolutionProgress` while the solver mutates the
  document?

## Rejected

- **A closed enum for `type`.** It breaks pass-through: every new kind would become a breaking
  wire change for an older client or plugin.
- **A WS frame type or SSE event name per kind.** One envelope already carries all of them, and
  per-kind frames would double the places a kind is registered.
- **Carrying the delivery class through codegen** as a custom `x-` keyword. The generators drop
  it, and a hand table with a shared fixture is the pattern the repo already trusts.
- **Carrying `SolveOutcome` as a hidden output param** through `ISelvaSerializableGoo`. It would
  need a component on every canvas, and a definition without one would silently lose its
  diagnostics. A document constant needs nothing from the author.
- **Normalizing Compute's strings on the Selva server** instead of in the plugin. It moves the
  regex, but it still guesses from text the plugin could have stated outright.
- **Moving the final flush off the solver thread.** It would race `closeSolve` and need a
  server-side grace period, all to save one round trip that is only paid when something was
  emitted.

## Testing it live

Both halves run against the showcase fixture,
[`live_solve_showcase.ghx`](../../fixtures/grasshopper/live_solve_showcase.ghx). Its **Solve
behaviour** group adds four slow stages (abort lands between them; progress will hook in there) and
an incidental-message switch next to the existing remark, warning, blocking and Notify=Log cases.

- **Local:** record the UI Bridge's WebSocket from inside Rhino with the MCP ("Record the bridge's
  WebSocket traffic" in the rhino-mcp skill's `reference.csx`). Send value updates and a
  `cancelSolve` from a background task; never wait on the UI thread, which the solve needs.
- **Compute:** [`compute-e2e/`](../../.claude/skills/rhino-mcp/compute-e2e/) next to the skill.
  `sink.mjs` stands in for the Selva callback route and can answer `abort` or `410` on cue;
  `solve.mjs` posts the showcase to compute.geometry with a `selvaevents` block. This covers
  plugin → fork → callback, not the Selva server's bus, SSE or cancel route.

## Open

- **Queue position for a waiting Compute solve** (defect 12). The Selva server knows its own
  FIFO depth and can emit it on `solveStarted`. Time spent waiting on the child's solve lock is
  invisible to both.
- Should share-link viewers get a stream? It needs the SSE and cancel routes to resolve a share
  token. With the owner key derived from access (above), that is a route change, not a design
  one.
