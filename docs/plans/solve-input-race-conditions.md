# Plan: Fix solve / input race conditions in the Grasshopper ↔ web bridge

**Status:** Proposed
**Scope decided:** Single active preview client. Fix the two concrete bugs server-side first; defer end-to-end request/response correlation to a follow-up.

This plan was adversarially reviewed against the source before writing. Several of the first-draft conclusions were **wrong** and are corrected here (see "What the review corrected").

---

## TL;DR

The slider→mesh path has two real, fixable defects and one larger latent issue:

- **Bug 1 — lost final value.** A value update sent in the ~1 RTT window before the client learns the server is solving is _dropped_ server-side and never re-sent. **Fix server-side: coalesce instead of drop.**
- **Bug 2 — double solve.** `ScheduleSolution` defers ~10ms; a second update in that gap schedules a second solve because `IsSolving` hasn't flipped yet. **Fix: a synchronous "solve pending" flag set at schedule time.**
- **Bug 3 — no request/response correlation.** Deferred. Correctness today rests on perfect ordering + the drop gate. Once Bugs 1&2 are fixed, this is latent, not active. A `seq` correlation scheme is the eventual fix but is single-client-only by nature and interacts with the mesh ring buffer — out of scope here.

Everything in the hot path runs on the **Rhino UI thread** (confirmed). So these are _ordering/deferral_ bugs, **not** data races. No locks are needed.

---

## What the review corrected (don't repeat these mistakes)

1. **There is no cross-thread race on `IsSolving`.** `HandleWebSocketValueUpdate` is marshalled to the UI thread via `MarshalToMainThread` → `RhinoApp.InvokeOnUiThread` ([WebSocketTransport.cs:451-453](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketTransport.cs#L451), [:525](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketTransport.cs#L525)). `SetSolving(true/false)` is called from GH's `SolutionStart`/`SolutionEnd` events ([GH_UIBuilderComponent.cs:206,210](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs#L206)) — also UI thread. Read and writes of `IsSolving` are serialized. **No lock. The fix is logic, not synchronization.**
2. **Applying a pending update _inside_ the `SolutionEnd` handler is unsafe.** `_onSolutionEnded` already does heavy synchronous work (collect+broadcast outputs, metadata diff, post-solve bake merge — [GH_UIBuilderComponent.cs:208-248](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs#L208)). Re-scheduling a solve from there is reentrant and, under a slider drag, becomes a non-draining solve loop. The pending apply must be **deferred to its own tick** and **latest-only**.
3. **The 50ms batch flush re-checks nothing.** `flushBatchedUpdates` sends without re-reading `isSolving` ([websocket.svelte.ts:361-373](../../packages/plugin-ui/src/lib/websocket/websocket.svelte.ts#L361)). Any client-side gate reasoning must account for the deferred flush, not just the synchronous `sendValueUpdate` entry.
4. **`seq` is single-client by construction.** Outputs broadcast to _all_ connected clients ([WebSocketServer.cs:282](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketServer.cs#L282), `MAX_CLIENTS=10`). A per-client counter can't be correlated against a broadcast-to-all envelope. Since we've scoped to single-client, this is fine — but it's _why_ full correlation is deferred, not dropped.

---

## Bug 1 — Lost final value (the one users actually hit)

### Mechanism (verified)

- Client gate: [websocket.svelte.ts:337-342](../../packages/plugin-ui/src/lib/websocket/websocket.svelte.ts#L337) — if `this.isSolving`, stash latest in `_pendingValueUpdate`, resend on `solvingState:false`.
- Server gate: [BridgeOrchestrator.cs:111-117](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L111) — if `IsSolving`, **drop + warn**, return.
- `client.isSolving` is a mirror set by the `solvingState` broadcast ([websocket.svelte.ts:145-150](../../packages/plugin-ui/src/lib/websocket/websocket.svelte.ts#L145)), lagging the server by ~1 RTT.
- An update sent (or batch-flushed) while the mirror is still `false` but the server is already solving passes the client gate, hits the server gate, gets **dropped**. The client thinks it sent successfully → never re-sends. **Final slider value silently lost.**

### Fix: server coalesces instead of dropping

Replace drop-and-warn in `HandleWebSocketValueUpdate` ([BridgeOrchestrator.cs:107](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L107)) with latest-wins coalescing:

- Add a single `private Dictionary<string,object> _pendingValues;` field (latest-wins; a new update overwrites it — matches the client's own `_pendingValueUpdate` semantics).
- If a solve is in progress when an update arrives: **merge** into `_pendingValues` and return (no drop, no warn).
- When a solve actually ends, drain `_pendingValues` on a **fresh UI-thread tick** (NOT inline in `SolutionEnd`):
  - In `_onSolutionEnded` ([GH_UIBuilderComponent.cs:208](../../Plugin/Selva.GH/Features/UIBuilder/Components/GH_UIBuilderComponent.cs#L208)), _after_ `CollectAndBroadcastOutputs`, if `_pendingValues != null`, post a one-shot `RhinoApp.InvokeOnUiThread(() => orchestrator.DrainPendingValues())`. The new tick calls the normal `ApplyValuesAndSchedule` path, so it goes through the standard schedule→solve flow rather than recursing inside the end handler.
- "In progress" must be detected with the same flag Bug 2 introduces (below), not the racy `IsSolving` read — so the two fixes share one source of truth.

### Why deferral, not inline

Draining inside `SolutionEnd` re-enters the hottest handler (review finding #2). Posting a fresh tick lets the current solve fully finish (outputs broadcast, bake merge, contextual clear) before the next schedule. Latest-only coalescing means a fast drag collapses to one trailing solve, never a backlog.

### Idempotency caveat

`file` and `dynamicValueList` deliberately skip dedup ([ValueApplicator.cs:101](../../Plugin/Selva.GH/Features/UIBuilder/Services/ValueApplicator.cs#L101)). Coalescing is latest-wins so they apply at most once per drain — fine. But ensure the drained `_pendingValues` is **cleared before** the drain solve runs, so a value changed _during_ the drain solve is captured for the next cycle, not lost or double-applied.

---

## Bug 2 — Double solve (the 10ms schedule gap)

### Mechanism (verified)

`HandleWebSocketValueUpdate` reads `IsSolving` ([:111](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L111)), then `ApplyValuesAndSchedule` calls `document.ScheduleSolution(ScheduleSolutionDelayMs≈10ms, …)` ([ValueApplicator.cs:156](../../Plugin/Selva.GH/Features/UIBuilder/Services/ValueApplicator.cs#L156)) which **defers**. `SolutionStart` (→ `SetSolving(true)`) doesn't fire for ~10ms. A second update in that gap sees `IsSolving==false` and schedules a **second** solve. The `_solveStartedSinceLastEnd` flag ([ComponentStateManager.cs:21](../../Plugin/Selva.GH/Features/UIBuilder/Services/ComponentStateManager.cs#L21)) is existing scar tissue from this same class of problem.

### Fix: a synchronous "solve pending" flag set at schedule time

- Add `bool _solveScheduled` to `ComponentStateManager` (or the orchestrator — same UI thread either way).
- Set it **synchronously** the moment `ApplyValuesAndSchedule` actually schedules a solution (return that fact up, or set it in the orchestrator right after the call).
- The "is a solve in progress" decision used by Bug 1's coalescing becomes: `IsSolving || _solveScheduled`. This closes the 10ms window — an update arriving after the schedule but before `SolutionStart` now correctly coalesces instead of double-scheduling.
- Clear `_solveScheduled` in `SetSolving(false)` / `SolutionEnd` (the solve it represented has completed).

### Why not a lock

All three touch points run on the UI thread (review finding #1). A plain bool set/read on one thread is sufficient and correct. A lock would add nothing.

---

## Bug 3 — No request/response correlation (DEFERRED)

Documented so it isn't forgotten, not implemented now.

- `valueUpdate` carries no id; `outputs` carries only `sessionId` ([OutboundEnvelopes.cs:116](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/OutboundEnvelopes.cs#L116)). The client's `outputsToken` ([websocket-solve-driver.ts:81](../../packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts#L81)) only orders _local parses_, not _which request produced a result_.
- After Bugs 1&2 are fixed there is exactly one solve in flight and updates coalesce, so out-of-order results can't occur in practice. Correlation becomes defense-in-depth, not a live bug.
- **When revisited:** a monotonic `seq` minted client-side, echoed on `outputs`, gating render. Constraints the follow-up MUST honor (all from the review):
  - Mint `seq` at **flush time** per coalesced frame, and **re-mint** on the `_pendingValueUpdate` resend — not in `sendValueUpdate`.
  - Apply the seq render-gate at the **report step** ([websocket-solve-driver.ts:202](../../packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts#L202)), never as an early return at the top of `handleOutputs` — an early return strands the trailing binary mesh frames in the ring buffer ([:111-131](../../packages/plugin-ui/src/lib/schema-source/websocket-solve-driver.ts#L111)) and corrupts the next solve's blob count.
  - Single-client only. Multi-tab needs per-connection seq + per-connection outputs routing (not broadcast-to-all) — a separate, larger decision.

---

## Wire format / schema generation

**No `pnpm generate:all` needed.** Confirmed: the WebSocket envelopes are hand-written in [OutboundEnvelopes.cs](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/OutboundEnvelopes.cs) (C#) and the `Ws*Message` interfaces in [websocket.svelte.ts](../../packages/plugin-ui/src/lib/websocket/websocket.svelte.ts). `ui-schema.json` defines the UISchema domain model only — it contains none of `valueUpdate`/`outputs`/`solvingState`/`binaryBatchCount`. **Bugs 1&2 require no wire change at all** (pure server logic).

---

## Tests

- **C# — coalesce (Bug 1):** a value update arriving while solving is applied after the solve, not dropped. Latest-wins: two updates during one solve → only the latest applies. Use the GH-unit-testing-via-linking pattern (link Rhino-free helpers into Selva.Tests) — see project memory.
- **C# — no double solve (Bug 2):** two updates inside the schedule gap result in one scheduled solve, not two. May need to extract the schedule-decision into a Rhino-free helper to test without a live document.
- **C# — drain ordering:** `_pendingValues` cleared before the drain solve runs, so a value changed during the drain is captured next cycle.
- No new TS tests for this scope (client unchanged). The `seq` follow-up adds the `websocket-solve-driver` ordering test.

---

## Sequencing

1. **PR1 — Bug 2 flag.** Add `_solveScheduled`; define "in progress" = `IsSolving || _solveScheduled`. Small, isolated, makes Bug 1's fix correct.
2. **PR2 — Bug 1 coalesce.** Replace drop-and-warn with `_pendingValues` merge + deferred drain on a fresh UI tick. Depends on PR1's flag.
3. **PR3 (later, optional) — `seq` correlation.** Per constraints above. Only if Bug 3 proves to matter after 1&2 ship.

Both PR1 and PR2 are **server-only, no wire change, no client change** — they can be verified live in Rhino against the existing UI.

---

## Open items to confirm during implementation

- [ ] Exact home for `_pendingValues` / `_solveScheduled` — `ComponentStateManager` (already owns solve state) vs `BridgeOrchestrator` (owns the value-update handler). Lean `ComponentStateManager` so all solve-lifecycle state lives together.
- [ ] Confirm `DrainPendingValues` can re-read the _current_ schema (it may have changed via a save mid-drag — [BridgeOrchestrator.cs:269](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L269) `SuppressSolvingCycles`). Drain should use `_getSchema()` fresh, not a captured ref.
- [ ] Decide whether to _also_ relax the client's drop-gate ([websocket.svelte.ts:338](../../packages/plugin-ui/src/lib/websocket/websocket.svelte.ts#L338)). With the server coalescing, the client gate becomes redundant but harmless (reduces wire traffic). Leave as-is for PR1/PR2; revisit with the `seq` work to avoid two competing pending buffers.
