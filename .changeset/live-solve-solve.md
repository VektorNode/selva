---
'@selvajs/solve': minor
---

Live solve events and a single solve verdict.

- `SolveResult` gains `diagnostics` (level, source, `isGate` per message) and `aborted`. Both drivers decode the plugin's `SolveOutcome` through `decodeOutcome`/`finalizeResult`; on Rhino.Compute without the fork's `selva` block, the outcome is recovered from the message markers and the `: component "X" (guid)` suffix is stripped.
- A blocked or aborted solve returns no outputs or meshes and is applied at once. `awaitingAck`/`acknowledge()`/`discard()` hold back only a result with warnings.
- The session exposes `live` (`LiveSolveState`: diagnostics, progress per source, how the solve ended), `phase` (`idle`, `solving`, `review`, `blocked`), `abort()` and `dispose()`.
- `createSolveEventStream` opens the cloud SSE stream; pass it to the request/response driver as a `SolveEventSource` and its `streamId` to `createComputeFetchSolveFn`.
- `SolveEngine`/`runSolvePipeline` accept `selvaEvents` and forward it to Compute.
