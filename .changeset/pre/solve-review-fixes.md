---
'@selvajs/solve': major
'@selvajs/compute': patch
'@selvajs/server': minor
'@selvajs/selva': minor
---

A review of `@selvajs/solve`: smaller public API, one owner for each solve rule, and the bugs it found.

**Breaking in `@selvajs/solve`:**

- The server `SolveOutcome` is now `SolveEngineOutcome`, and `PipelineInput` is gone: use `SolveInput`. The `SolveOutcome` on `/shared` and `/client`, the plugin's verdict, is unchanged.
- `/server` no longer exports `runSolvePipeline`, `SolvePipelineArgs`, `adaptEnvelopeToEncoding`, `buildSolveInputTree`, `createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`, their handle types, `serverIdentity`, `ServerIdentity` or `isDefinitionRef`. Use `SolveEngine`. `SolveEngine.toResponse` and `FrameworkAgnosticResponse` are gone: use `toWebResponse`.
- `definitionSource` no longer takes `{ versionId, load }`: pass `engine.definitionRef(versionId, load)`.
- `SolveEngine` drops the `logger` option and the `@selvajs/platform` dependency. A host that passed `logger` must pass `onDebugLog`, or its debug lines stop silently.
- `SolveEngine` throws a `RangeError` on a limit that is not a finite number in range.
- `/client` no longer exports `applyValueChange`, `makeInitialFlags`, `pickInputValues`, `applySolveResult`, `solvePhase`, `buildInitialValues`, `SolveSessionState`, `ExternalReader`, `reduceLiveSolve`, `createAsyncThrottle`, `AsyncThrottle`, `createSolveMemo`, `SolveMemo` or `SolveMemoOptions`. `/shared` no longer exports `SOLVE_BLOCKED_MARKER` or `outcomeFromComputeMessages`.
- `SolveDriver.clearCache` is now `reset`, and also stops the running solve. A custom driver implementing `clearCache` must rename it.
- A rejected solve's `SolveResult` no longer carries `source`: it held the outputs the verdict withheld.

**New:** `solveInputsFromSchema` and `acceptsGzip` on `/server`, `loginPath` on `createComputeFetchSolveFn`, and `signal` passed to `meshes.extract`. `shed` gains the reason `interrupted`, retryable, for a solve that lost its client.

**Fixed, client:** a hung solve no longer wedges the session; a rebuild stops the old definition's solve and drops its result; `ensureSolved` no longer returns a result for older inputs after an abort or a discard; a value edited during a manual solve stays dirty; an aborted result is not memoized, so a retry solves again; `dispose` stops the running and queued solves; a held result is dropped when a newer solve starts, and settles as `discarded`; a throwing listener or `onChange` no longer breaks a solve's one settlement; a solve started from a subscriber keeps its abort and deadline; a non-200 no longer closes the event stream for good; a 503 with `Retry-After` starts the cooldown, and that header's other forms parse; a network failure no longer claims the session expired; valid but wrong JSON and a truncated body read as errors; `stableInputKey` honours `toJSON` and treats an `undefined` property as absent; blocked or quota-full `sessionStorage` no longer throws; a late `solveEnded` no longer wipes the next solve's state; a verdict of `blocked` with no diagnostics no longer unblocks.

**Fixed, server:** a flight aborts when its last caller leaves and frees its key then, so an orphaned solve no longer holds a Rhino slot and a live caller no longer gets a 499 from someone else's disconnect; an already-aborted caller doesn't solve; an eviction no longer aborts running solves as a false 504, it drains them; a build in flight when a server is evicted no longer installs old credentials; handshake failures return `compute_error` instead of throwing; `gzip;q=0` is honoured; the response cap counts bytes, not UTF-16 units; concurrent definition loads share one read and honour the signal; a call with no deadline of its own keeps a 300 s ceiling on the long-deadline fetch.

**`@selvajs/selva`, behaviour change:** a solve of a stored definition reads its inputs from the version's schema and ignores the request's, so a caller can no longer forge a slot or drop a bound. Number widget bounds are enforced on the server. `inputs` on `POST /api/v1/definitions/{guid}/solve` is deprecated and ignored; omitting it now solves the stored inputs instead of the file's defaults. A version whose schema can't be read or backfilled now answers 503 instead of solving on the request's inputs. Remote-URL solves still read `inputs` from the body, and reject a malformed list with a 400. A failed Compute records a `compute_error` metric. A display error in the local preview is shown as a message on an applied solve.

**`@selvajs/compute`:** a redirect error no longer quotes credentials or a query string from `Location`.
