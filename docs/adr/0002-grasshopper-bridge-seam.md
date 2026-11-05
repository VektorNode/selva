# ADR 0002: The Grasshopper Bridge Seam

> **Status: PR 1 shipped, PR 2 proposed.** Splits the UIBuilder bridge into a Rhino-free
> orchestration policy and a thin Rhino-coupled adapter, so the orchestration logic (where the
> silent-freeze and wrong-message bugs live) is testable without a live Grasshopper canvas.
>
> - **PR 1, wire extract + fixtures:** `InboundMessageParser` and `OutboundEnvelopes` are Rhino-free
>   and linked into `Selva.Tests`. Fixtures under `packages/schemas/fixtures/wire/` are checked by
>   both `dotnet test` and `vitest`.
> - **PR 2, orchestration split:** not started. There is no `Features/UIBuilder/Bridge/` folder or
>   `ConversationPolicy`, and `BridgeOrchestrator` still calls Rhino directly.

## Problem

The seam between the Rhino plugin and plugin-ui is hard to test. The only end-to-end check is manual
testing against a live canvas, and a failure gives no clear signal: a malformed envelope or a
wrong-shaped broadcast shows up as a silently frozen UI, not a stack trace or a red test.

The UI half is already well-factored. `SchemaSource` is a transport interface, and `FakeSource` and
the E2E `ws-stub` drive `/builder` and `/preview` with no Rhino
([schema-source.ts](../../packages/plugin-ui/src/lib/schema-source/schema-source.ts),
[ws-stub.ts](../../packages/plugin-ui/e2e/ws-stub.ts)). Inbound messages have runtime guards born
from real bugs ([messageSchemas.ts](../../packages/plugin-ui/src/lib/websocket/messageSchemas.ts)).

The C# half had no such seam. Two layers are fused to Rhino:

1. **Wire parse/serialize** sat inside `WebSocketTransport`, wired straight into `WebSocketServer`
   (sockets) and `RhinoApp.InvokeOnUiThread` (marshalling), so it could only run inside Rhino.
   Contract rules that prevent real bugs lived as prose warnings, such as the flat-vs-`data:`-wrapped
   envelope note on `WebSocketTransport.BroadcastMessage`. Prose drifts; tests don't. PR 1 moved
   this layer out.

2. **Orchestration** lives in
   [BridgeOrchestrator](../../Plugin/Selva.GH/Features/UIBuilder/Services/BridgeOrchestrator.cs).
   It takes concrete collaborators and reaches into Rhino directly (`_component.OnPingDocument()`,
   `_component.AddRuntimeMessage(...)`, `RecordUndoEvent(...)`, `RhinoApp.InvokeOnUiThread(...)`).
   It decides _"when solving, skip and warn"_, _"no ContextBake wired, this exact error"_, _"stale
   base hash, reject with the fresh canonical, in this order"_ and which broadcast fires in what
   sequence. Each of those is a bug magnet, and none is reachable from a test.

### The drift problem

The wire contract is defined three times, and without the fixtures below nothing checks that the
copies agree:

| Where              | What                                                        |
| ------------------ | ----------------------------------------------------------- |
| TS inbound guards  | `messageSchemas.ts` (Zod)                                   |
| TS outbound types  | `WsInitialDataMessage` et al.                               |
| C# both directions | `InboundMessageParser` parse, `OutboundEnvelopes` serialize |

The two motivating bugs in `messageSchemas.ts` (a nested `DiscoveredParameters` instead of a flat
array; a `data:`-wrapped `parametersAdded` the UI read flat) surfaced only as a silent UI freeze on
a live canvas.

### Constraints

1. **Don't fake all of Rhino.** Geometry, the document model and the solve loop are huge. A fake
   complete enough to stand in for them would have its own bugs, and the tests would prove the fake
   works, not the code. Geometry and solve stay on a live canvas.
2. **The test host can't load Rhino.** `Selva.GH` pulls in Grasshopper, Windows.Forms and
   RhinoCommon, which break the test host. Anything tested must be Rhino-free and linked in, per the
   existing [Selva.Tests](../../Plugin/Selva.Tests/Selva.Tests.csproj) pattern.
3. **Additive where possible.** The wire extraction is a pure extract-and-link. The orchestration
   split is a real refactor and must land behind passing tests, on its own branch.
4. **One boundary, not many.** The collaborators (`ValueApplicator`, `SchemaSynchronizer`,
   `ValueCollector`) already take the document as an _argument_, so the orchestrator is the only
   thing that _originates_ Rhino references. Keep it that way: one small port surface.

## Decision

Split the bridge into two layers along a small set of **ports**: interfaces the policy depends on,
implemented for real by a thin Rhino adapter and faked in tests.

- `ConversationPolicy` (Rhino-free, linked into `Selva.Tests`) decides: solving or invalid, so
  reject; save conflict-hash check, sanitize and broadcast order; which `AddRuntimeMessage` each
  failure path raises.
- `GrasshopperBridge` (Rhino-coupled, never unit-tested) implements the ports against the real
  `GH_Component` and collaborators, including `RecordUndoEvent` and the UI-thread hop.

### The ports

Small, Rhino-free, expressed in POCOs. The policy never sees a `GH_Document`, a `GH_Component` or a
`RhinoDoc`.

```csharp
public interface IDocumentPort
{
    bool TryGetDocument(out DocumentInfo info);   // POCO, not a wrapped GH_Document
    bool HasWiredContextBake();
    void ApplyValues(IReadOnlyDictionary<string, object> values, IDiagnostics diag);
    SaveOutcome SaveSchema(UISchema validated, IDiagnostics diag);
    // only what the policy actually calls
}

public interface IDiagnostics { void Report(MessageLevel level, string text); }  // wraps AddRuntimeMessage
public interface IBroadcaster { /* BroadcastInitialData, BroadcastSchemaSaved, ... */ }
```

`FakeDocumentPort` and recording `IDiagnostics` / `IBroadcaster` live in `Selva.Tests`.

### The wire layer (shipped)

- `InboundMessageParser` takes a raw JSON string and the expected session id and returns an
  `InboundMessage` whose `InboundKind` names the outcome. Bad input never throws: malformed JSON, a
  missing `type`, a session mismatch and a missing required field each map to their own kind.
  `WebSocketTransport` keeps the sockets and threading and delegates parse and classify.
- `OutboundEnvelopes` holds pure static builders for the envelope shapes, so the flat-vs-wrapped
  rules are enforced by tests instead of prose.

### Closing the drift loop: cross-language fixtures

`packages/schemas/fixtures/wire/` holds one canonical JSON file per outbound message. Both suites
read the same files:

- C# `WireFixtureContractTests` serializes every `OutboundEnvelopes` factory and compares it with
  the fixture byte-for-byte. A reflection test fails if a factory has no fixture. After an
  intentional shape change, regenerate with `UPDATE_WIRE_FIXTURES=1 dotnet test --filter
WireFixtureContractTests`.
- TS `wire-fixtures.test.ts` checks that every fixture passes the Zod guard the dispatcher runs on
  live messages, and that every validated message type has a fixture.

Drift fails a test, not a canvas. The fixtures are plain `.json`; C# finds the repo root by
`pnpm-workspace.yaml`, Vitest reads them through `import.meta.url`.

## Consequences

### Good

- The orchestration decisions become deterministic, millisecond, Rhino-free tests: _"save with stale
  base hash: `BroadcastSchemaSaveRejected(fresh)` fired, `AddRuntimeMessage(Warning, ...)` fired,
  `_setSchema` NOT called."_
- The wire contract is pinned from both sides.
- The bridge gains a swap point. A non-Grasshopper host or a richer in-memory test host means
  implementing the ports, not rewriting the orchestrator.

### Costs / risks

- The orchestration split is a real refactor, not additive. Mitigation: the wire extraction landed
  first; the split goes on its own branch behind the new headless tests, with no intended behavior
  change.
- A port surface that grows to mirror Rhino re-creates the "testing the fake" trap. Mitigation: the
  port has only the methods the policy calls; geometry and solve never cross it.
- `IDocumentPort.TryGetDocument` must return a **POCO** (`DocumentInfo`), not a wrapped
  `GH_Document`. Otherwise Rhino leaks back across the seam and the policy can't link into
  `Selva.Tests`. This is the single most important line to hold.

## PR 2: orchestration split

1. **Split.** Extract the POCOs (`DocumentInfo`, `SaveOutcome`, `SyncOutcome`, `MessageLevel`) into
   `Selva.GH/Features/UIBuilder/Bridge/`, define the ports, move decision logic into
   `ConversationPolicy`, leave the Rhino calls in `GrasshopperBridge`, and shrink
   `BridgeOrchestrator` to a composition root.
2. **Headless flow tests.** Link `ConversationPolicy` into `Selva.Tests`, add `Fake*` adapters and
   assert the value-update, save, client-connected and sync flows.

## Decisions and open questions

- **POCO home.** A new `Selva.GH/Features/UIBuilder/Bridge/` folder holds the POCOs, ports and
  `ConversationPolicy`, linked into `Selva.Tests` the way `OutputPayloadBuilder.cs` is. `Selva.Schema`
  stays schema-only. `DocumentInfo` is a real projection: it carries `DocumentID` and
  `ProjectFileName`, which the orchestrator stamps onto the schema on save and on the default
  schema, not just `isValid`.
- **Sync flows are policy.** The decisions in `HandleSyncPreviewRequest` / `HandleApplySyncChanges`
  (null doc or schema fails, apply sets and broadcasts, success ack and remark) move into
  `ConversationPolicy`. The canvas mechanics (`FindObject`, `RefreshObjectsOnCanvas`,
  `ScheduleComponentExpire`) sit behind one opaque `ApplySyncChanges(changes) -> SyncOutcome` port
  call, the same shape as `SaveSchema`.
- **`BridgeOrchestrator` survives as a thin composition root.** It wires policy, adapter and
  transport and owns the `Initialize()` / `Dispose()` event subscription, with no decision logic.
  Smaller diff, lower risk.
- **Open: `IBroadcaster` granularity.** One fat interface mirroring every `Broadcast*` method, or
  role interfaces (schema, values, solving state)? Start fat; split if a test needs only a slice.
- **Open: where `MarshalToMainThread` lands.** Prefer the adapter: the policy stays synchronous and
  the adapter owns the thread hop.
