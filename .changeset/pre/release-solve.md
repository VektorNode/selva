---
'@selvajs/solve': major
---

Built on `@selvajs/compute` 5: a smaller API, solves that report how they ended, and limits read from the compute server.

**Breaking**

- ESM only.
- `SolveEngine` is the server entry. `/server` no longer exports `runSolvePipeline`, `adaptEnvelopeToEncoding`, `buildSolveInputTree`, `createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`, `serverIdentity` or `isDefinitionRef`. `SolveEngine.toResponse` is gone: use `toWebResponse`. The server `SolveOutcome` is now `SolveEngineOutcome`; `PipelineInput` is gone (use `SolveInput`, which loses `stepSize`).
- `transformInputParameter` is removed. Trees are built with `TreeBuilder.fromValues`: `generic` inputs reach the solve, uncoercible values are left out, numbers are no longer snapped to step decimals.
- `CachedClient` is `{ client, scheduler }`; `solveMeta` and `rhinoTiming` are gone.
- `definitionSource` takes `engine.definitionRef(versionId, load)`.
- `SolveEngine` drops the `logger` option (pass `onDebugLog`) and the `@selvajs/platform` dependency, throws `RangeError` on an invalid limit, and no longer takes `solveDeadlineMs` or `computeReuseDefinitionCache`: each server's `SolveLimits` come from the client, defaulting to `DEFAULT_SOLVE_DEADLINE_MS` (100 s).
- `/client` no longer exports its internal reducers and helpers (`applyValueChange`, `reduceLiveSolve`, `createAsyncThrottle`, `createSolveMemo` and others). `/shared` drops `SOLVE_BLOCKED_MARKER` and `outcomeFromComputeMessages`.
- `SolveDriver.clearCache` is renamed `reset` and also stops the running solve. A rejected `SolveResult` no longer carries `source`.

**Added**

- `session.solve()` resolves a `SolveSettlement` (`applied`, `discarded`, `blocked`, `aborted`, `failed`); `onSettled` and `ensureSolved`. `SolveReporter.reportAborted()`, `SolveDriver.hasQueued`.
- `solveInputsFromSchema`, `acceptsGzip`, `loginPath` on `createComputeFetchSolveFn`, `DEFAULT_SOLVE_DEADLINE_MS`, `MAX_SOLVE_DEADLINE_MS`. `SolvePhaseMetrics` carries the `Server-Timing` data.
- `Server-Timing` adds `rhino_gh`, `rhino_recomputed` and `rhino_cache`.

**Fixed and faster**

- Client: a hung solve no longer wedges the session; aborted results aren't memoized; `dispose` stops running and queued solves; a deadline reports an error instead of going quiet; `setValue` to the last-sent value doesn't solve again.
- Server: a solve with a live event channel no longer joins another caller's identical solve, so one user's cancel can't abort someone else's solve, and each gets its own progress events. A flight aborts when its last caller leaves, so an orphaned solve doesn't hold a Rhino slot; evictions drain running solves; the response cap counts bytes and stops the download; deadlines of 300 s or more work; cached solves reuse their gzipped body.
- Cache keeps no solve the plugin aborted. `dist` is no longer minified.
