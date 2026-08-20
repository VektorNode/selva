# ADR 0002 — The Grasshopper Bridge Seam

> **Status: PR 1 shipped, PR 2 proposed (2026-06-03).** Splits the UIBuilder bridge into a
> Rhino-free orchestration policy and a thin Rhino-coupled adapter, so the orchestration logic —
> where the silent-freeze / wrong-message bugs live — becomes headless-testable without a live
> Grasshopper canvas. **PR 1 (wire extract + fixtures) is done:** `InboundMessageParser` (16 tests),
> `OutboundEnvelopes` (11 tests), and cross-stack fixtures under
> `packages/schemas/fixtures/wire/` loaded by both `dotnet test` and `vitest` — drift verified to
> bite. **PR 2 (orchestration split) is still proposed.** This extends the established cross-stack
> contract pattern (Rhino-free payload type, golden fixture, extract-decision-from-Rhino) to the
> wire layer and bridge.
>
> **Still accurate as of 2026-08.** `InboundMessageParser.cs` / `OutboundEnvelopes.cs` and the twelve
> fixtures under `packages/schemas/fixtures/wire/` are in place; PR 2 has not landed — there is no
> `Features/UIBuilder/Bridge/` folder and no `ConversationPolicy`, and `BridgeOrchestrator` still
> reaches into Rhino directly. The `wire-fixtures/` name used below is the shipped
> `packages/schemas/fixtures/wire/`.

## Problem

The seam between the Rhino/Grasshopper plugin and the plugin-ui is hard to test. Today the
only way to exercise it end-to-end is **manual testing against a live canvas**, and even then a
failure gives no clear signal — a malformed envelope or a wrong-shaped broadcast surfaces as a
silently frozen UI, not a stack trace or a red test.

The UI half of the wire is already well-factored:

- `SchemaSource` is a clean transport interface; `FakeSource` and the E2E `ws-stub` drive
  `/builder` and `/preview` with no Rhino at all
  ([schema-source.ts](../../packages/plugin-ui/src/lib/schema-source/schema-source.ts),
  [ws-stub.ts](../../packages/plugin-ui/e2e/ws-stub.ts)).
- Inbound messages have runtime guards born from real bugs
  ([messageSchemas.ts](../../packages/plugin-ui/src/lib/websocket/messageSchemas.ts)).

The **C# half has no such seam.** Two layers are fused to Rhino:

1. **Wire parse/serialize** lives inside
   [WebSocketTransport.HandleMessageReceived](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketTransport.cs#L505):
   inbound JSON is parsed and dispatched, outbound envelopes are built by `Broadcast*` methods.
   It is wired straight into `WebSocketServer` (sockets) and `RhinoApp.InvokeOnUiThread`
   (marshalling), so it can only run inside Rhino. The contract rules that prevent real bugs are
   encoded as **prose warnings to future devs** — e.g. the flat-vs-`data:`-wrapped envelope note
   at [WebSocketTransport.cs:194-218](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketTransport.cs#L194-L218).
   Prose drifts; tests don't.

2. **Orchestration** lives in
   [BridgeOrchestrator](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs):
   it takes concrete collaborators and reaches into Rhino directly — `_component.OnPingDocument()`,
   `_component.AddRuntimeMessage(...)`, `_component.Attributes?.DocObject?.RecordUndoEvent(...)`,
   `RhinoApp.InvokeOnUiThread(...)` across ~21 call sites. This is the layer that decides
   _"when solving, skip and warn"_, _"no ContextBake wired → this exact error"_, _"stale base
   hash → reject with the fresh canonical, in this order"_, _"which broadcast fires and in what
   sequence."_ Every one of those decisions is a bug magnet, and none of them is reachable from a
   test today.

### The drift problem

The wire contract is defined three times with nothing checking they agree:

| Where              | What                                                   |
| ------------------ | ------------------------------------------------------ |
| TS inbound guards  | `messageSchemas.ts` (Zod)                              |
| TS outbound types  | `WsInitialDataMessage` et al.                          |
| C# both directions | `HandleMessageReceived` parse + `Broadcast*` serialize |

When these drift — the two motivating bugs in `messageSchemas.ts` (a nested `DiscoveredParameters`
instead of a flat array; a `data:`-wrapped `parametersAdded` the UI read flat) — it surfaces only
as a silent UI freeze on a live canvas.

### Constraints

1. **Don't fake all of Rhino.** Geometry, the document model, and the solve loop are huge. A fake
   complete enough to stand in for them would have its own bugs, and the tests would prove the fake
   works, not the code. Geometry/solve stay on a **live canvas**.
2. **Net48 BCL limits.** The test host is net8; `Selva.GH` pulls in Grasshopper / Windows.Forms /
   RhinoCommon, which break the test host. Anything tested must be Rhino-free and linked in, per the
   existing `Selva.Tests` pattern ([Selva.Tests.csproj](../../Plugin/Selva.Tests/Selva.Tests.csproj)).
3. **Additive where possible.** The wire parse/serialize extraction is a pure extract-and-link. The
   orchestration split is a real refactor and must land behind passing tests, on its own branch.
4. **One boundary, not many.** The collaborators (`ValueApplicator`, `SchemaSynchronizer`,
   `ValueCollector`) already take the document as an _argument_ — the orchestrator is the only thing
   that _originates_ Rhino references. Keep it that way: a single, small port surface.

## Decision

Split the bridge into two layers along a small set of **ports** (interfaces the policy depends on,
implemented for real by a thin Rhino adapter, and faked in tests).

```
BridgeOrchestrator (today: fused)
        │  split into ▼
┌───────────────────────────┐        ┌────────────────────────────┐
│  ConversationPolicy        │ ports  │  GrasshopperBridge          │
│  (Rhino-FREE, testable)    │───────▶│  (Rhino-coupled, live-only) │
│                            │        │                             │
│  decides:                  │        │  implements ports:          │
│   • solving? valid? →      │        │   • OnPingDocument()        │
│     apply | reject-msg     │        │   • real ValueApplicator /  │
│   • save: conflict-hash    │        │     Synchronizer / Collector│
│     check, sanitize,       │        │   • RecordUndoEvent         │
│     broadcast order        │        │   • RhinoApp.InvokeOnUiThread│
│   • which AddRuntimeMessage│        │                             │
│     for each failure path  │        │                             │
└───────────────────────────┘        └────────────────────────────┘
   linked into Selva.Tests,               drives a LIVE canvas;
   tested headless with fakes             never unit-tested
```

### The ports

Small, Rhino-free, expressed in POCOs. The policy never sees a `GH_Document`, a `GH_Component`,
or a `RhinoDoc`.

```csharp
// What the policy needs from "the document" — no Rhino types cross this line.
public interface IDocumentPort
{
    bool TryGetDocument(out DocumentInfo info);   // DocumentInfo: POCO { id, projectFileName, isValid }
    bool HasWiredContextBake();
    void ApplyValues(IReadOnlyDictionary<string, object> values, IDiagnostics diag);
    SaveOutcome SaveSchema(UISchema validated, IDiagnostics diag);
    // ...the handful the policy actually calls — kept minimal
}

// Wraps GH_Component.AddRuntimeMessage. Recorded in tests.
public interface IDiagnostics { void Report(MessageLevel level, string text); }

// Wraps WebSocketTransport's Broadcast* methods — already nearly this shape.
public interface IBroadcaster { /* BroadcastInitialData, BroadcastSchemaSaved, ... */ }
```

`GrasshopperBridge` implements these against the real `GH_Component` and collaborators and lives in
`Selva.GH` — it is never unit-tested. `FakeDocumentPort` + recording `IDiagnostics` / `IBroadcaster`
live in `Selva.Tests`.

### What the wire layer gets

In parallel (and landable first, since it's a pure extract):

- `InboundMessageParser` — Rhino-free. Takes a raw JSON string + expected session id, returns a
  typed `InboundResult` (one of `ValueUpdate`, `RequestCurrentValues`, `RequestInitialData`,
  `SaveSchema`, `RequestSyncPreview`, `ApplySyncChanges`, `SessionMismatch`, `Unknown`, `Malformed`).
  No sockets, no `RhinoApp`. `WebSocketTransport` keeps the threading/marshalling shell and delegates
  the parse+classify.
- `OutboundEnvelopes` — pure static builders returning the envelope shapes. The flat-vs-wrapped
  rules at [WebSocketTransport.cs:194-218](../../Plugin/Selva.GH/Features/UIBuilder/Services/Communication/WebSocketTransport.cs#L194-L218)
  become **enforced by tests** instead of prose.

### Closing the drift loop: cross-language fixtures

A shared `wire-fixtures/` of canonical JSON, one file per message type. **Both** suites load the
same files:

- C# `OutboundEnvelopes` serializes → asserts equality with the fixture.
- TS `messageSchemas.test.ts` parses each fixture → asserts the Zod guard accepts it and fields land
  where handlers read them.

A C# shape change that doesn't update the fixture fails the C# test; a fixture change that breaks the
TS guard fails the TS test. **Drift fails a test, not a canvas.**

## Consequences

### Good

- The orchestration decisions — the actual bug surface — become deterministic, millisecond,
  Rhino-free tests: _"save with stale base hash → `BroadcastSchemaSaveRejected(fresh)` fired,
  `AddRuntimeMessage(Warning, "...changed in Grasshopper...")` fired, `_setSchema` NOT called."_
- The wire contract is pinned from both sides; the two motivating drift bugs become impossible to
  ship silently.
- The bridge gains a real swap point. A future non-Grasshopper host (or a richer in-memory test
  host) is "implement the ports," not "rewrite the orchestrator."
- One boundary, consistent with the existing rule that collaborators take the document as an
  argument.

### Costs / risks

- The orchestration split is a **real refactor**, not additive. Mitigation: land the wire
  extraction (additive) first; do the split on its own branch behind the new headless tests; no
  behavior change intended.
- A port surface that grows to mirror all of Rhino would re-create the "testing the fake" trap.
  Mitigation: the port has _only_ the methods the policy calls; geometry/solve never cross it.
- `IDocumentPort.TryGetDocument` must return a **POCO** (`DocumentInfo`), not a wrapped
  `GH_Document` — otherwise Rhino leaks back across the seam and the policy can't link into
  `Selva.Tests`. This is the single most important line to hold.

## Sequencing

**PR 1 — wire extract + fixtures (additive, no behavior change). DECIDED scope.**

1. **Wire extract:** `InboundMessageParser` + `OutboundEnvelopes`, linked into `Selva.Tests`.
   Headless parse/serialize tests (every inbound type → right result; malformed → `Malformed` not a
   throw; unknown → `Unknown`; `parametersAdded` flat; `BroadcastMessage` wrapped; `outputs` carries
   `binaryBatchCount`).
2. **Fixtures (drift loop):** `wire-fixtures/`, consumed by both the C# serialize tests and
   `messageSchemas.test.ts`.

**PR 2 — orchestration split (refactor, behind the new headless tests).**

3. **Split:** extract POCOs (`DocumentInfo`, `SaveOutcome`, `SyncOutcome`, `MessageLevel`) into
   `Selva.GH/Features/UIBuilder/Bridge/`; define `IDocumentPort` / `IDiagnostics` / `IBroadcaster`;
   move decision logic into `ConversationPolicy`; `GrasshopperBridge` keeps the Rhino calls and
   implements the ports; `BridgeOrchestrator` shrinks to a composition root.
4. **Headless flow tests:** link `ConversationPolicy` into `Selva.Tests`, add `Fake*` adapters,
   assert the value-update / save / client-connected / sync flows.

PR 1 ships first and is independently valuable. PR 2 is gated on PR 1 landing and on the remaining
open questions (`IBroadcaster` granularity, marshalling home) being closed at its start.

## Open questions / next decisions

- [x] **POCO home — DECIDED (2026-06-03).** A new `Selva.GH/Features/UIBuilder/Bridge/` folder
      holds the POCOs, ports, and `ConversationPolicy`, linked into `Selva.Tests` the same way
      `OutputPayloadBuilder.cs` is. `Selva.Schema` stays schema-only; bridge concerns stay in the
      bridge feature. `DocumentInfo` is a real (small) projection — it carries `DocumentID` and
      `ProjectFileName` (read by `HandleClientConnected` to stamp the schema), not just `isValid`.
- [x] **Sync flows — DECIDED (2026-06-03).** They are **policy**. `HandleSyncPreviewRequest` /
      `HandleApplySyncChanges` decisions (null doc → fail, null schema → fail, apply → set+broadcast,
      success ack + remark) live in `ConversationPolicy`. The raw canvas mechanics —
      `document.FindObject`, `RefreshObjectsOnCanvas`, `ScheduleComponentExpire` at
      [BridgeOrchestrator.cs:360-367](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs#L360-L367)
      — are swallowed by the port behind one opaque `ApplySyncChanges(changes) → SyncOutcome` call,
      same shape as `SaveSchema`.
- [x] **`BridgeOrchestrator` fate — DECIDED (2026-06-03).** It survives as a **thin composition
      root**: a constructor that wires policy + adapter + transport and owns the `Initialize()` /
      `Dispose()` event subscription, with no decision logic. Smaller diff, lower risk.
- [ ] **`IBroadcaster` granularity.** One fat interface mirroring every `Broadcast*` method, or a
      couple of role interfaces (schema vs. values vs. solving-state)? Start fat, split if a test only
      needs a slice.
- [ ] **Where `MarshalToMainThread` lands.** It's pure plumbing — does it stay in `GrasshopperBridge`
      (so the policy is synchronous and the adapter marshals), or does the policy stay marshalling-
      agnostic by construction? Prefer the former: policy is synchronous, adapter owns the thread hop.
- [x] **Fixture format + location — DECIDED + SHIPPED (2026-06-03).** Plain `.json` under
      `packages/schemas/fixtures/wire/`, matching the existing `dynamic-value-list-payload.json`
      convention. C# finds repo root via `pnpm-workspace.yaml` + `File.ReadAllText` (no csproj copy);
      Vitest reads via `new URL(..., import.meta.url)`. The metadata fixture carries both a `_source`
      (builder input) and the expected flat `changedParams` (the contract) so the C# test exercises
      the flattener end-to-end.

## TL;DR

- The Rhino↔UI seam is untestable because the **C# half** (wire parse/serialize + orchestration) is
  fused to sockets and `RhinoApp`. Bugs surface as a silent frozen UI, never a red test.
- Split the bridge: a Rhino-free **`ConversationPolicy`** (the decisions) talks to small **ports**
  (`IDocumentPort` / `IDiagnostics` / `IBroadcaster`) implemented by a thin Rhino-coupled
  **`GrasshopperBridge`**. Geometry/solve stay live; only the decision layer is faked.
- Extract the wire layer (`InboundMessageParser` / `OutboundEnvelopes`) and pin it from both
  languages with shared **`wire-fixtures/`** so contract drift fails a test.
- Ship additively: wire extract + fixtures first, orchestration split second, behind headless tests.
- Hold one line above all: **ports return POCOs, never Rhino types** — that's what keeps the policy
  linkable into `Selva.Tests`.
