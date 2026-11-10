# @selvajs/solve

## 2.1.0-beta.5

### Patch Changes

- e2e0bcb: A blocked or aborted solve no longer blanks `dynamicValueList` outputs (`blankOutputs` skips them). They hold the options and rows the form is drawn from, so lists and repeated rows stay as they were instead of emptying until the next good solve.

## 2.1.0-beta.4

### Minor Changes

- 32a5f6f: Preview solves: a definition can make its files when someone downloads them instead of on every edit. The UI schema gains `previewSolves` (schema 2.20.0, off when absent), set by the builder's "Make files on download" switch. With it on, the page solves each edit as a preview, and the plugin skips the file components whose only consumers are Download outputs. The outcome lists those outputs as `deferred`, and a click on Download runs one full solve of the inputs on screen.

  `SolveOptions`, `SchedulerSolveOptions` and `GrasshopperComputeConfig` gain `solveMode` (`SolveMode`: `'preview' | 'full'`), sent to compute as `selvamode` for a preview only; the scheduler's cache key includes it. `SolveEngineSolveArgs.solveMode` is part of the single-flight key. `SolveBodySchema` gains `mode`, default `full`. `SolveOutcome` and `SolveResult` gain `deferred`. A `SolveFn` takes an optional third argument, `SolveCallOptions`. `SolveDriver.solve` takes `{ solveMode }`, and the new optional `solveFiles` runs the download solve outside the session. `SolveSession` gains `files`, `makeFiles()` and `cancelFiles()`. `OutputDisplay` reads them from a context `ComputeApp` sets. Needs the VektorNode compute fork 9.11.0 and a matching Selva plugin. Anything older ignores the mode and solves in full.

### Patch Changes

- Updated dependencies [32a5f6f]
  - @selvajs/schemas@5.4.0-beta.2
  - @selvajs/compute@5.1.0-beta.1

## 2.1.0-beta.3

### Minor Changes

- 853051a: A signed-in user's solves of a stored definition carry `X-Session-Id`, so a compute server running the VektorNode fork's session affinity sends them back to the child holding that user's warm document. The id is an HMAC of the user and definition under `SELVA_HMAC_KEY`; share-link and remote-URL solves send none, and other servers ignore it. From a browser, the server must allow `X-Session-Id` in CORS. `ComputeConfig`, `SolveOptions` and `SchedulerSolveOptions` gain `sessionId`, which throws `INVALID_CONFIG` unless it is 1 to 128 characters from `!` to `~`, before the solve queues or loads its definition; `SolveEngineSolveArgs` gains `sessionId`. None of the caches key on it. `ServerTiming` gains `affinity`, the fork's routing outcome (`hit`, `claimed`, `spilled`, `none`), which Selva forwards as `rhino_affinity` and prints in its compute debug log.

  `SolveOptions` and `SchedulerSolveOptions` gain per-solve `headers`, which replace a client config header of any casing. Selva sends `X-Selva-Definition` with each solve, so a warm client no longer stamps every solve with the first definition it served. `SolveEngine.getClient` and `ClientCache.getClient` drop their `definitionGuid` option, and `getIO` requests no longer carry the header.

### Patch Changes

- Updated dependencies [853051a]
  - @selvajs/compute@5.1.0-beta.0

## 2.1.0-beta.2

### Minor Changes

- d424587: Share links work without an account. The app's session gate let no anonymous request reach the two routes that accept a share token, so a link opened by someone signed out went to the login page, and its solves were refused. The gate now lets a request carrying a share token through to those two routes, which accept or refuse the token themselves. The login redirect no longer copies a share token into `redirectTo`.

  `createComputeFetchSolveFn` takes a `bearerToken` option, sent as `Authorization: Bearer …`. The library page passes its share token there, in a header rather than the URL, so it stays out of access logs.

### Patch Changes

- Updated dependencies [d424587]
  - @selvajs/schemas@5.3.1-beta.1

## 2.1.0-beta.1

### Minor Changes

- b38182e: An input whose `source.kind` is `server` solves with its schema default, and a solve that posts a value for it is refused with 400. No binding resolver is wired, so before this such an input took whatever a caller posted. The client no longer sends a value for these inputs. New on `@selvajs/solve/server`: `postedServerSourcedIds`; `SolveInput` gains `serverSourced`.

### Patch Changes

- Updated dependencies [b38182e]
  - @selvajs/schemas@5.3.1-beta.0

## 2.1.0-beta.0

### Minor Changes

- 43a9046: The client's solve memo is capped by geometry bytes as well as by entries: 256 MB by default, `maxBytes` to change it. Every entry is a full copy of the scene's geometry, so a 13-million-triangle scene held about 390 MB per remembered solve, and a few solves could exhaust the tab. A result larger than the whole budget is not memoized and is fetched again instead. `MeshPolicy` gains an optional `byteSize`, which `meshPolicy` from `@selvajs/visualization/parse` implements.

## 2.0.1

### Patch Changes

- 8d47f38: A redeployed plugin no longer leaves old results in the solve cache. `getLimits()` now reads `deploymentId`, which the VektorNode fork reports and changes on every restart or child recycle. A warm client whose cache could answer re-reads it once it is 30 s old, waiting at most 1 s, and a client that reports another deployment is rebuilt with an empty cache. Before, the cache treated a solve as a pure function of the definition and its inputs, so after a plugin redeploy it served the old plugin's output for any inputs it had already seen, until the app restarted.
- Updated dependencies [8d47f38]
  - @selvajs/compute@5.0.1

## 2.0.0

### Major Changes

- edb568d: Built on `@selvajs/compute` 5: a smaller API, solves that report how they ended, and limits read from the compute server.

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

### Patch Changes

- Updated dependencies [edb568d]
- Updated dependencies [edb568d]
  - @selvajs/compute@5.0.0
  - @selvajs/schemas@5.3.0

## 2.0.0-beta.13

### Minor Changes

- 24e9b77: A solve's deadline, request cap and definition-cache reuse come from what its compute server reports, not from Selva's env.

  - `@selvajs/solve`: `SolveEngine`'s limits no longer take `solveDeadlineMs` or `computeReuseDefinitionCache`. Each server's `SolveLimits` is on the client `getClient(server)` returns; a server that reports nothing gets `DEFAULT_SOLVE_DEADLINE_MS` (100 s). `DEFAULT_SOLVE_DEADLINE_MS` and `MAX_SOLVE_DEADLINE_MS` are exported.
  - `@selvajs/platform`: `COMPUTE_TIMEOUT_DEFAULT_MS`, `COMPUTE_TIMEOUT_MIN_MS`, `COMPUTE_TIMEOUT_MAX_MS`, `COMPUTE_RETRY_MAX`, `clampTimeoutMs` and `clampRetryCount` are removed.
  - `@selvajs/server`: 2.0.0-beta.25 already dropped `ComputeLimits.solveDeadlineMs` and `computeReuseDefinitionCache` without saying so, and cannot run with `@selvajs/solve` 2.0.0-beta.12 or older: `new SolveEngine` throws on the missing deadline. Use it with this `@selvajs/solve` release. `COMPUTE_SOLVE_DEADLINE_MS` is no longer read, and the request cap is the fixed `COMPUTE_REQUEST_MAX_BYTES` (256 MB).

## 2.0.0-beta.12

### Major Changes

- 9240690: A review of `@selvajs/solve`: smaller public API, one owner for each solve rule, and the bugs it found.

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

### Minor Changes

- a7c12ee: Shared helpers for what every host was writing itself.

  - `@selvajs/platform`: `walkPages` and `listAll` read a cursor-paged list to its end. One call stops at `MAX_PAGE_LIMIT` without saying so.
  - `@selvajs/server`: `createBoundedTtlCache` and `createSessionRefresher` in `/http`, and `isUsableCachedSchema` in `/definitions`. `runHandler` now sends a thrown error's `details.retryAfter` as `Retry-After`.
  - `@selvajs/solve`: `SolvePhaseMetrics` carries everything in the `Server-Timing` header (`defLoadMs`, `rhino`, `settle`, `defBytes`), so a host logs the data rather than parsing the header.
  - `@selvajs/selva`: requests that arrive together with an expired session share one token exchange. A provider that rotates refresh tokens could otherwise refuse all but the first, which cleared the cookie and signed the user out.

### Patch Changes

- Updated dependencies [9240690]
  - @selvajs/compute@5.0.0-beta.9

## 2.0.0-beta.11

### Patch Changes

- Updated dependencies [b6935ce]
- Updated dependencies [817af19]
- Updated dependencies [cc081b1]
- Updated dependencies [eebd2f6]
- Updated dependencies [35e5c67]
- Updated dependencies [77780c7]
- Updated dependencies [5ab63df]
- Updated dependencies [ff7e2a0]
- Updated dependencies [1fb3914]
  - @selvajs/platform@1.0.0-beta.4

## 2.0.0-beta.10

### Patch Changes

- e0aa942: `session.setValue` no longer solves again when an input is set to the value the last solve already sent. A field that reports its value on input and again on blur used to solve twice, and Grasshopper re-applies every dynamic value list on each update, so the repeat was a real solve. The value still solves when `forceSolve` is passed, after a failed or aborted solve, for file and dynamic value list inputs, and for object values.

## 2.0.0-beta.9

### Patch Changes

- 2256395: Removed the `cacheerroredsolves` request option and the `COMPUTE_CACHE_ERRORED_SOLVES` setting. Only the VektorNode Rhino.Compute fork honored the flag, and the fork dropped it to stay closer to McNeel's server, which never caches an errored solve. Selva's own solve cache still keeps errored solves by default (`cache.cacheErroredSolves` on the scheduler).

  The scheduler's solve cache no longer stores a solve the Selva plugin aborted (`selva.outcome.aborted`): it stopped partway, so the same inputs solve again instead of replaying a partial result.

- Updated dependencies [2256395]
  - @selvajs/compute@5.0.0-beta.8

## 2.0.0-beta.8

### Patch Changes

- e39d929: chore(deps): bump the npm group across 1 directory with 34 updates
- Updated dependencies [e39d929]
  - @selvajs/compute@5.0.0-beta.6

## 2.0.0-beta.7

### Minor Changes

- 5e17d67: `ServerTiming` reads three more fields that a VektorNode-fork Rhino.Compute sends: `gh` (the part of `solve` spent inside Grasshopper), `recomputed` (`{ ran, total }` objects) and `cacheHit` (the server answered from its result cache). A cache hit now reaches `onServerTiming`; it carries no durations, so the callback used to stay silent.

  The solve pipeline's `Server-Timing` adds `rhino_gh`, `rhino_recomputed` and `rhino_cache` (1 on a compute cache hit) beside the other `rhino_*` entries.

### Patch Changes

- Updated dependencies [5e17d67]
  - @selvajs/compute@5.0.0-beta.5

## 2.0.0-beta.6

### Patch Changes

- Updated dependencies [07e6808]
- Updated dependencies [0cb9545]
- Updated dependencies [4125e70]
- Updated dependencies [aa0878a]
- Updated dependencies [33ef891]
  - @selvajs/compute@5.0.0-beta.4
  - @selvajs/schemas@5.3.0-beta.1

## 2.0.0-beta.5

### Patch Changes

- 2322937: `SolveEngine` stops downloading a compute response once it passes `computeResponseMaxBytes`, and returns `too_large`. It used to read and parse the whole body before checking its size. `ClientCacheConfig` takes the cap as an optional `maxResponseBytes`.
- Updated dependencies [2322937]
  - @selvajs/compute@5.0.0-beta.3

## 2.0.0-beta.4

### Major Changes

- 9a7d371: Built against the `@selvajs/compute` major.

  - **`transformInputParameter` is removed.** `buildSolveInputTree` (now in `transform-input`) builds the tree with `TreeBuilder.fromValues`, which changes what a solve sends:
    - `generic` inputs reach the solve; they were dropped.
    - A value compute can't coerce is left out, so Grasshopper keeps its own value: `'abc'` for a number used to send `0` (or the minimum), and `['abc']` used to send `"abc"`.
    - Text and Color values pass through unchanged. File strings pass through. Numbers are no longer snapped to step decimals.
  - **`SolveInput` loses `stepSize`**, which tree building no longer reads. `PipelineInput` is now the same type as `SolveInput`.
  - **`CachedClient` is `{ client, scheduler }`.** `solveMeta` and `rhinoTiming` are gone: the pipeline reads each solve's cache verdict and Rhino timing from `scheduler.solveDetailed()`, so overlapping solves no longer drop their `selva_cache`, `def_reupload` and `rhino_*` Server-Timing entries.

### Patch Changes

- Updated dependencies [7304b28]
- Updated dependencies [414e9bc]
- Updated dependencies [9a7d371]
  - @selvajs/compute@5.0.0-beta.2

## 1.3.0-beta.3

### Patch Changes

- Updated dependencies [594da9c]
- Updated dependencies [a0e6628]
- Updated dependencies [a0e6628]
- Updated dependencies [65786d5]
  - @selvajs/compute@4.3.0-beta.1
  - @selvajs/schemas@5.3.0-beta.0
  - @selvajs/platform@0.21.0-beta.3

## 1.3.0-beta.2

### Minor Changes

- daf8a99: - A solve now tells you how it ended. `session.solve()` returns a promise of a `SolveSettlement` (`applied`, `discarded`, `blocked`, `aborted` or `failed`), `session.onSettled(listener)` reports every solve including the ones input changes start, and `session.ensureSolved()` answers from the result on screen or solves only when it must. A result held for review settles on `acknowledge()` or `discard()`; one a queued solve replaces never settles. The promise never rejects, and `rebuild()` and `dispose()` resolve a waiting one as `aborted`.
  - `SolveReporter` gains `reportAborted()`, and `SolveDriver` an optional `hasQueued`. Every solve a driver is asked for must end in exactly one report.
  - The request/response driver no longer goes quiet on a stopped solve: a cancel reports `aborted`, and a solve past its deadline reports the error "The solve took longer than N s and was stopped." instead of leaving the user with nothing.

## 1.2.3-beta.1

### Patch Changes

- Updated dependencies [90ba461]
  - @selvajs/compute@4.2.2-beta.0

## 1.2.3-beta.0

### Patch Changes

- Updated dependencies [d50c8fa]
- Updated dependencies [5a96097]
- Updated dependencies [5a96097]
  - @selvajs/platform@0.21.0-beta.0

## 1.2.2

### Patch Changes

- Updated dependencies [3daeb50]
- Updated dependencies [78727bf]
  - @selvajs/platform@0.20.2
  - @selvajs/schemas@5.2.0

## 1.2.1

### Patch Changes

- 7f0da02: Republish of the previous release. npm staged that release instead of publishing it and then dropped it, so those versions were never installable and npm won't accept them again. No code changes.
- Updated dependencies [7f0da02]
  - @selvajs/compute@4.2.1
  - @selvajs/schemas@5.1.1

## 1.2.0

### Minor Changes

- 5bff576: Live solve events and a single solve verdict.

  - `SolveResult` gains `diagnostics` (level, source, `isGate` per message) and `aborted`. Both drivers decode the plugin's `SolveOutcome` through `decodeOutcome`/`finalizeResult`; on Rhino.Compute without the fork's `selva` block, the outcome is recovered from the message markers and the `: component "X" (guid)` suffix is stripped.
  - A blocked or aborted solve returns no outputs or meshes and is applied at once. `awaitingAck`/`acknowledge()`/`discard()` hold back only a result with warnings.
  - The session exposes `live` (`LiveSolveState`: diagnostics, progress per source, how the solve ended), `phase` (`idle`, `solving`, `review`, `blocked`), `abort()` and `dispose()`.
  - `createSolveEventStream` opens the cloud SSE stream; pass it to the request/response driver as a `SolveEventSource` and its `streamId` to `createComputeFetchSolveFn`.
  - `SolveEngine`/`runSolvePipeline` accept `selvaEvents` and forward it to Compute.

### Patch Changes

- Updated dependencies [b6f5796]
- Updated dependencies [251d17b]
- Updated dependencies [5bff576]
- Updated dependencies [5bff576]
  - @selvajs/compute@4.2.0
  - @selvajs/schemas@5.1.0

## 1.1.1

### Patch Changes

- cf41e54: chore(deps): bump the npm group across 1 directory with 26 updates
- Updated dependencies [cf41e54]
- Updated dependencies [ae5bcb6]
  - @selvajs/compute@4.1.3

## 1.1.0

### Minor Changes

- ff73858: Add Clear buttons for Selva's own solve and definition caches in `/admin/compute`

  The per-server **Purge** button POSTs to Rhino.Compute's `cache/purge`, which clears that server's
  `cachesolve` and nothing else. Selva's in-process solve cache sits in front of it, so a purge alone
  never produced a fresh solve — the only way to drop those results was to restart the process.

  Both cache panels under **Caching** now have a **Clear** button, behind a confirm dialog, reporting
  the entries and bytes dropped. They clear only the instance serving the request: behind a load
  balancer the others keep theirs, so a fleet-wide clear still means a restart.

  Neither is destructive. Clearing the solve cache costs a re-solve, clearing the definition cache
  costs a storage re-read; version ids are immutable, so no cached entry can go stale on its own.
  Reach for them when a definition reads a live URL, a database, or the clock, or after upgrading
  Rhino in place on an existing compute server.

  `SolveEngine` gains `clearDefinitionCache()`, alongside the existing `clearSolveCaches()`.

## 1.0.8

### Patch Changes

- Updated dependencies [87f2c6a]
- Updated dependencies [f9c4c99]
  - @selvajs/compute@4.1.1
  - @selvajs/schemas@5.0.2

## 1.0.7

### Patch Changes

- f763878: Fail fast when a compute server is unreachable, instead of waiting out the retry budget.

  A liveness probe now reports _why_ it failed, and callers stop retrying the failures that
  cannot resolve themselves. Previously a powered-off compute VM and a booting one were
  indistinguishable from a single probe, so both paid the full retry window.

  - New `classifyProbeFailure()` in `@selvajs/compute/core` turns a `probeServer()` result into
    a verdict (`refused`, `dns`, `timeout`, `unauthorized`, `http_error`, `unknown`) plus a
    `retryable` flag and an operator-facing summary.
  - `GrasshopperClient.create()` stops its retry ladder on a non-retryable verdict and bounds
    each probe at 2s rather than 5s. A refused connection or a rejected API key now fails in
    one probe instead of three; the thrown `ComputeError` carries `context.probeVerdict`.
  - `@selvajs/solve`'s client cache remembers a failed build for 5s, so repeated solves against
    a down server replay the original error instead of re-running the probe ladder each time.
    `evict()` clears it, so correcting a server's URL or key takes effect immediately.
  - `/api/admin/compute/status` returns `retryable`, `failureReason`, and `failureSummary`. The
    admin panel's health pill stops polling a server that reported a terminal failure and shows
    the reason ("Connection refused — …") instead of a bare "Offline" after 60s of spinning.

- Updated dependencies [f763878]
- Updated dependencies [f763878]
  - @selvajs/platform@0.20.1
  - @selvajs/compute@4.1.0

## 1.0.6

### Patch Changes

- 484ca51: Fix solve failures that surfaced as a bare HTTP 500 with no diagnosis, and tighten error handling across the compute stack.

  **Solve failures are now classified instead of collapsing to 500.** The solve pipeline only recognised a raw `AbortError` as a timeout or disconnect, but the scheduler rejects with `ComputeError` (`TIMEOUT_ERROR` / `ABORTED`) — so every real solve deadline and client disconnect fell through to a generic 500. The same mismatch hid an unreachable compute server: the route matched a raw `TypeError('fetch failed')`, which the transport wraps into `ComputeError` `NETWORK_ERROR` before it gets there. Deadlines now return 504, disconnects 499, and unreachable/rate-limited/rejected-credentials servers return 503 with a message naming which one it was. Only a genuine solve failure stays 500.

  **Server logs carry the compute server's own error body.** `renderThrown` dropped `code` and `statusCode`; it now appends a `[code=… status=…]` tag, and the solve failure log includes the raw (bounded) compute response body — often the only diagnostic that survives when the compute server scrubs exception messages in production mode.

  **The browser stopped discarding the server's explanation.** `createComputeFetchSolveFn` hard-coded "offline or unreachable" for any 503 without reading the body; it now shows the server's message on 503 and 504.

  **Wire-casing fixes in `@selvajs/compute`.** Three error-handling decisions read `values`/`errors` case-sensitively while the rest of the package reads them case-insensitively, so a PascalCase response from a stock mcneel server was misjudged: a partial success was discarded as a hard failure, `client.solve()` passed an errored response through as clean success, and `cacheErroredSolves: false` cached errored solves anyway. All three now use `readField`.

  **Other correctness and consistency fixes in `@selvajs/compute`:**

  - `fetchCompute` guards `JSON.stringify` — a circular or BigInt payload threw a raw `TypeError` instead of the documented `ComputeError`.
  - New `ComputeServerStats.probeServer()` reports probe status and connection error; `GrasshopperClient.create()` uses it so a 401/403 says the credentials were rejected rather than "server is not online".
  - `monitor()` and `TreeBuilder.parsePathString` throw `ComputeError` instead of `RangeError` / plain `Error`, so `instanceof ComputeError` holds across the whole public surface.
  - A ValueList default absent from its values map now reaches `parseErrors` instead of only the logger.
  - HTTP 400 maps to `VALIDATION_ERROR` (was `UNKNOWN_ERROR`); the missing-base64-codec throws use `ENVIRONMENT_ERROR` (was `INVALID_STATE`); 502 is labelled "Bad gateway".
  - Removed an unreachable catch in `extractFilesFromComputeResponse`, and corrected the `RATE_LIMIT` doc that claimed retries happen by default (`attempts` defaults to 0).

- Updated dependencies [484ca51]
  - @selvajs/compute@4.0.3

## 1.0.5

### Patch Changes

- Updated dependencies [4d16b79]
  - @selvajs/platform@0.20.0

## 1.0.4

### Patch Changes

- 6fa6b27: Three small fixes found in the open-issue backlog.

  The solve client serialized the input values a second time on every solve just to print their size. `JSON.stringify(values).length` ran unconditionally while the log line it fed was behind the `debug` flag, so a potentially MB-scale tree was walked and thrown away on every request in production. The measurement moved inside the `debug` block.

  Dialogs cap at `max-h-[85dvh]` and scroll internally. The content primitive set no height bound, so a dialog with a long member list or many form fields grew past the viewport instead of scrolling — the top and bottom, including the confirm button, became unreachable.

  Two index gaps in the Supabase schema. Definition lists sort on `created_at` under a `project_id` filter with only a `project_id` index behind them, so each project page sorted its slice in memory; a composite `(project_id, created_at desc)` covers both. And `SupabaseAuditQuery` paginates keyset-style on `(occurred_at desc, id desc)` while the three audit indexes stopped at `occurred_at`, leaving the tie-breaker to a sort — each is replaced by one carrying `id`.

- Updated dependencies [6fa6b27]
  - @selvajs/platform@0.19.1
  - @selvajs/schemas@5.0.1

## 1.0.3

### Patch Changes

- e782803: chore(deps): bump the npm group across 1 directory with 12 updates
- Updated dependencies [e782803]
  - @selvajs/compute@4.0.2

## 1.0.2

### Patch Changes

- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
- Updated dependencies [e779034]
  - @selvajs/platform@0.19.0

## 1.0.1

### Patch Changes

- Updated dependencies [679a24f]
  - @selvajs/platform@0.18.0

## 1.0.0

### Major Changes

- 4512068: **`ComputeFetchSolveFnOptions.meshes.loadRhino` is gone**, along with the `TRhino` type parameter
  and the `rhino` field on the `extract` callback's options.

  ```diff
   const onSolve = createComputeFetchSolveFn({
   	endpoint: '/api/v1/compute',
   	meshes: {
  -		loadRhino: () => import('rhino3dm').then((m) => m.default()),
  -		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
  +		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
   	}
   });
  ```

  Curves arrive pre-tessellated from the plugin (see `@selvajs/visualization`), so nothing in a
  viewer decodes Rhino geometry anymore. This option was worse than unnecessary: it loaded the WASM
  **unconditionally whenever `meshes` was configured** — on every viewer solve, not just those
  carrying curves — so removing it is a straight win for first paint and bundle size.

  There is no replacement and no fallback. A definition whose Display component predates backend
  tessellation now fails the solve with an actionable error — upgrade the component in Grasshopper
  (Solution → Upgrade obsolete components) and re-save.

- 4512068: **Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
  aliases left behind. Every reference across the workspace was updated in the same commit.

  ```diff
  -import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
  +import { fetchCompute, ComputeError } from '@selvajs/compute/core';
  ```

  ```diff
  -import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
  +import type { ParamType, InputStructure } from '@selvajs/schemas';
  ```

  Both renamed schema types were already backend-agnostic in value (`ParamType` is
  `number|integer|boolean|text|valueList|dynamicValueList|file|color|generic`; `InputStructure` is
  just arity — `item|list|tree`). Only the names were Rhino-flavored. The rename does not touch wire
  data: `paramType` still serializes as its lowercase string value, never the type name. Regenerated
  via `pnpm generate` — the C# plugin types regenerate too (`Plugin/Selva.Schema/Models/UISchema.Generated.cs`),
  so this needs a plugin rebuild.

  **`@selvajs/compute`'s root barrel is gone** — subpaths only, matching `@selvajs/solve` (no root
  export) and `@selvajs/visualization` (root deliberately empty):

  ```diff
  -import { GrasshopperClient } from '@selvajs/compute';
  +import { GrasshopperClient } from '@selvajs/compute/grasshopper';
  ```

  **Env var renamed:** `MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES`. No dual-read —
  operators update `.env` on upgrade. Everything else in `.env.example` was already neutral
  (`COMPUTE_*`).

  Also reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
  fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
  itself is just a bare string, backend-specific by convention rather than by type).

- 4512068: One name, one value, for how long a solve may run. The deadline is now sourced
  from the server and carried unchanged to the browser's `AbortController`, rather
  than each layer keeping its own answer under its own name.

  **Fixed — the client could abort a solve the server would have finished.** The
  throttle defaulted to `60_000` while the server's deadline was `100_000`, so any
  host that embedded `<ComputeApp>` without passing a timeout aborted at 60 s a
  solve the server was still happily running. The user saw a failure for work that
  succeeded. `@selvajs/solve` can't read env, so the fix is to require the value
  rather than guess it — there is no client-side default left to drift.

  **Breaking — the per-solve deadline is now required:**

  - `createAsyncThrottle`: `options.timeout` → **`options.runDeadlineMs`**, required,
    and the options bag itself is no longer optional. The name says what elapses;
    the throttle is generic, so its field is named after a run, not a solve.
  - `createRequestResponseDriver`: `options.timeout` → **`options.solveDeadlineMs`**,
    required.
  - `ComputeApp`: `solveTimeoutMs?` → **`solveDeadlineMs`**, required. Pass the value
    the server enforces; omitting it is now a type error rather than a silent 60 s.
  - `ComputeLimits.maxSolveDurationMs` → **`solveDeadlineMs`**.

  **Renamed — `MAX_SOLVE_DURATION_MS` → `COMPUTE_SOLVE_DEADLINE_MS`.** It joins the
  `COMPUTE_*` namespace every other compute knob already uses, and says what it
  bounds — one solve — instead of a vague "duration". The old name still works for
  one minor version and warns at boot, so no deployment breaks on upgrade.

  **`selva migrate` now rewrites deprecated env keys in your `.env`**, so a tuned
  value survives the shim being dropped later instead of silently reverting to a
  default. Only the key changes — value, comments, ordering and spacing are left
  byte-identical, a commented-out old name is ignored, and the old line is dropped
  outright when the new name is already set. `.env.bak` is written alongside the
  existing backups and restored if the migration rolls back.

  `selva doctor` reports the same deprecations without changing anything, covering
  this rename plus the four that were previously silent
  (`COMPUTE_DEFINITION_BYTE_CACHE_MB`, `COMPUTE_RESPONSE_CACHE_MB`,
  `DEFINITION_CACHE_TTL_MS`, `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`). The last of those
  is reported but not auto-fixed: its replacement encodes a value
  (`SELVA_FLAG_COMPUTE_DEBUG=verbose`), so migrate won't guess at it.

  Migration: run `selva migrate` to rewrite the env var, and pass `solveDeadlineMs`
  wherever you mount `ComputeApp` or build a driver.

### Minor Changes

- 4512068: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

- 4512068: The solve session moves out of `@selvajs/visualization` into `@selvajs/solve/client`.

  `@selvajs/visualization` is now **mesh conversion + viewer, and nothing else**. The session was a
  schema-driven form state machine that typed meshes as `unknown` and never inspected one — its
  presence was why the package couldn't be described in a sentence. With it gone the package also
  drops its last Selva dependency (`@selvajs/schemas`), so every sub-path needs only `three`,
  `rhino3dm` and `fflate`.

  **Breaking — `@selvajs/visualization`:**

  - **The `/session` sub-path export is removed.** Import from `@selvajs/solve/client` instead
    (`createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`,
    `createSolveMemo`, `stableInputKey`, the external-input storage helpers, the pure
    `solve-session-core` transitions). `SolveFn`/`SolveResult` come from `@selvajs/solve/shared`.
  - The root barrel no longer re-exports any of the above.
  - `@selvajs/ui` re-exports all of it unchanged, so hosts importing from `@selvajs/ui` or
    `@selvajs/ui/public` need no edit.

  **Renamed — `createComputeThrottle` → `createAsyncThrottle`** (`isComputing` → `isRunning`). It is
  generic over `T`, takes any `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute
  nor HTTP nor geometry — plugin-ui drives it over a WebSocket. The old name said "compute" only
  because of where the file happened to live.

  **Mesh ownership is now injected, not assumed.** `SolveResult<TMesh>` is opaque and the result memo
  no longer imports `three`; the clone/dispose rules are a `MeshPolicy` passed in. The three.js
  implementation is `meshPolicy`, newly exported from `@selvajs/visualization/parse`:

  ```ts
  import { meshPolicy } from '@selvajs/visualization/parse';
  const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
  ```

  `ComputeApp` wires this for you. A custom driver must pass it, or a memo hit will serve geometry the
  viewer already disposed. `createSolveMemo(max)` accordingly becomes
  `createSolveMemo({ max, meshPolicy })`.

  **Fixed while extracting it:** the memo's mesh clone copied `geometry.userData` **by reference**, so
  a cloned geometry shared the cross-solve geometry cache's ownership flag. `clearScene` skips flagged
  geometries (the cache disposes those itself), which meant nothing ever freed the memo's clones. The
  clone now copies `userData` before dropping the flag, and `releaseSceneObjects` refuses to dispose
  genuinely cache-owned geometry.

- 4512068: `@selvajs/solve/server` gains `SolveEngine`, a facade over the four primitives a consumer previously
  had to hand-assemble (`createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`,
  `runSolvePipeline`) plus the coalesce-key/abort/outcome-mapping glue every app route rewrote by hand.

  ```ts
  import { SolveEngine } from '@selvajs/solve/server';

  const engine = new SolveEngine({ limits }); // the 11-field subset of ComputeLimits it needs

  const outcome = await engine.solve({ server, definitionSource, inputs, values, signal });
  return engine.toWebResponse(outcome); // or toResponse() for a framework-agnostic {status,headers,body}
  ```

  `engine.solve()` accepts raw bytes, a string, a `DefinitionRef`, an already-built `ByteCacheRef` (from
  `engine.definitionRef()`, for a caller that needs the bytes before solving — e.g. schema extraction), or
  a `{ versionId, load }` pair that builds and caches the ref internally. `engine.stats()` aggregates
  client-cache, definition-byte-cache, and coalescing counters in one call.

  `@selvajs/solve/client` gains `createComputeFetchSolveFn`, a ready-made `SolveFn` for a
  `/api/compute`-shaped endpoint: 429 cooldown, session-expiry/redirect detection, non-JSON-response
  guarding, and abort handling at every await point, so a new consumer doesn't have to re-derive them.
  Mesh decoding stays a caller-supplied `meshes: { loadRhino, extract }` hook — the package never imports
  a renderer. Debug console telemetry defaults off; pass `debug: true` to enable it.

  `@selvajs/solve`'s TypeScript target moved ES2020 → ES2022 (matching `@selvajs/server`), enabling
  `Error(message, { cause })`.

  ## `@selvajs/selva`

  Migrated to the new facade: `clientCache.server.ts` + `definitionByteCache.server.ts` +
  `solveCache.server.ts` collapse into one `engine.server.ts` constructing a single app-wide
  `SolveEngine`; `/api/compute`'s hand-written coalesce/abort/outcome-mapping block is replaced by
  `engine.solve()` + `engine.toResponse()` (app policy — auth, DB reads, share tokens, rate limiting,
  metric recording — stays in the route, unchanged); the library page's `onSolve` closure is replaced by
  `createComputeFetchSolveFn(...)`. No public behavior change.

- 4512068: Make the reported `SolveResult` reachable from a `ComputeApp` host, so a commit path can pair the
  artifact it persists with the inputs that produced it.

  `source` and `values` travel correctly through the request/response driver's memo, but stopped at the
  session: `applySolveResult` merged `outputs` and discarded the rest, and `ComputeApp`'s only outbound
  seam was `onReady({ loadValues })`. So a host wanting the pair had to capture it inside its own
  `SolveFn` — which a memo hit never calls. Solve A, solve B, scrub back to A: the memo serves A, the
  viewer shows A, and the host commits B's geometry.

  `SolveSession` now exposes `lastResult: RetainedSolveResult | null` — the last reported result minus
  its meshes — and `ComputeApp` hands out `getLastResult()` alongside `loadValues`. Because the session
  fills it in `report()`, a memo hit populates it exactly like a fresh solve.

  Meshes are dropped from the retained slice rather than kept: they are GPU-backed and the viewer
  disposes what it renders on the next scene update, so retaining them would hand out disposed
  instances with no policy governing them. Live meshes stay on `session.meshes`. `rebuild()` nulls
  `lastResult` for the same reason it clears the driver memo; `reportError` deliberately leaves it, as
  the viewer still shows the geometry that produced it.

  `values` remains driver-supplied and absent on push transports (the plugin's WebSocket driver cannot
  attribute an unsolicited frame to a request) — documented on `SolveDriver` and `SolveResult`.

- 4512068: `SolveResult` now carries the payload it was built from and the inputs that produced it, so a
  consumer with a commit/persist step can hold onto the exact artifact it showed the user.

  ```ts
  const driver = createRequestResponseDriver(onSolve, () => session);
  // on report:
  result.source; // the raw GrasshopperComputeResponse, verbatim
  result.values; // the input set that produced it
  ```

  Both are optional and default to `unknown`/absent, so nothing existing changes shape.
  `createComputeFetchSolveFn` populates `source` and narrows its return to
  `SolveFn<TMesh, GrasshopperComputeResponse>`; `SolveFn`/`SolveResult` gained a matching `TSource`
  parameter so that narrowing survives an explicit return-type annotation.

  **Fixes a stale-result bug in the pattern this replaces.** Capturing the raw response inside your own
  `SolveFn` is silently wrong behind `createRequestResponseDriver`: a memo hit serves the cached result
  without ever calling the `SolveFn`. Solve A, solve B, scrub back to A — the viewer shows A while the
  captured response is still B's, and a commit path freezes that mismatch. The driver stamps `values`
  onto the result before storing it, so both fields travel through the memo with the result they belong
  to.

- 4512068: The solve core moves out of `@selvajs/server/compute` into `@selvajs/solve/server`, so the whole
  "input change → solve result" chain has one owner on both sides of the wire.

  ## Breaking — `@selvajs/server`

  **1. The solve core moved and is NOT re-exported.** Update the import path:

  ```diff
  -import { runSolvePipeline, createClientCache } from '@selvajs/server/compute';
  +import { runSolvePipeline, createClientCache } from '@selvajs/solve/server';
  ```

  Affected: `runSolvePipeline`, `adaptEnvelopeToEncoding`, `COMPUTE_CONTRACT_VERSION`,
  `COMPUTE_VERSION_HEADER`, `transformInputParameter`, `createClientCache`, `serverIdentity`,
  `createDefinitionByteCache`, `createMemorySolveResultCache`, `deriveSolveCacheInputKey`,
  `encodeSolveCacheEntry`, `decodeSolveCacheEntry`, `gunzipEntryBody`, `createSolveCacheSingleFlight`,
  and their types (`SolveOutcome`, `SolveEnvelope`, `SolvePipelineArgs`, `SolvePipelineCacheHook`,
  `SolvePhaseMetrics`, `PipelineInput`, `CachedClient`, `ByteCacheRef`, `ByteCacheStats`,
  `SolveCacheConfigSubset`, …). Add `@selvajs/solve` as a dependency.

  **2. The root export is gone.** `import … from '@selvajs/server'` no longer resolves; use a subpath:

  ```diff
  -import { resolveComputeLimits } from '@selvajs/server';
  +import { resolveComputeLimits } from '@selvajs/server/compute';
  ```

  The root barrel re-exported all nine subpaths into a single 41-symbol namespace, which hid which
  slice a consumer actually depended on. Nothing in this repo imported it.

  ## What each package owns now

  `@selvajs/server/compute` is **10 exports it owns**: `resolveComputeLimits`,
  `createComputeRateLimiter`, the SSRF guard (`isSafeRemoteDefinitionUrl` /
  `assertSafeRemoteDefinitionUrl`), `createRemoteDefinitionFetcher`, and their helpers/types. That is
  HTTP request policy — admission control and URL safety — which is a different job from running a
  solve. `@selvajs/server` no longer depends on `@selvajs/solve` at all.

  A compatibility shim was considered and rejected: it left `/compute` at 24 exports of which 14 were
  borrowed, so the package's surface no longer described what the package did — the exact problem this
  extraction exists to fix.

  ## `@selvajs/solve` — new `./server` sub-path

  Alongside `./client` and `./shared`, and still deliberately **no root barrel**. Also newly exported:
  `ByteRefOutcome` and `SolveCacheSingleFlightOptions`, which existed but were never public.

  The client/server boundary is enforced three ways: no root barrel, eslint `no-restricted-imports` on
  `src/client/**`, and a bundle test that checks the shipped `dist/client.js` for server modules,
  `process.env` reads and `node:*` imports.

### Patch Changes

- 4512068: Bound the scheduler's solve cache by bytes only. `CacheOptions.maxEntries` is
  removed and `maxBytes` is now required, so `cache: true` is no longer valid —
  enabling a cache always states a budget. A budget of `0` disables caching, the
  same as `cache: false`.

  Two bounds meant every caller had to reason about which one would bind first,
  and omitting `maxEntries` silently fell back to a default of 50 that could cap
  the cache far below its byte budget. Responses range from KB to hundreds of MB,
  so memory is the constraint that actually matters.

  Migration: `cache: true` → `cache: { maxBytes: <budget> }`; drop `maxEntries`.

- 4512068: `SolveEngine.solve()` now removes the abort listener it attaches to the caller's signal once the
  solve settles. `{ once: true }` only bounds how often a listener fires, not how long it stays
  attached, so every completed solve left one behind on a signal that outlives the call. A request
  signal fires `abort` after the response is consumed, and a session-scoped `AbortController` never
  settles at all — on that second shape the listeners accumulated without bound and Node warned at 11.

  Also simplified the mesh-extraction branch in `createComputeFetchSolveFn`, which checked the
  `meshes` option twice and re-tested a value `getRhino()` already guards.

- 4512068: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
- Updated dependencies [4512068]
  - @selvajs/platform@0.17.0
  - @selvajs/schemas@5.0.0
  - @selvajs/compute@4.0.0

## 1.0.0-beta.10

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- Updated dependencies [39db6f5]
  - @selvajs/compute@4.0.0-beta.6
  - @selvajs/platform@0.17.0-beta.3
  - @selvajs/schemas@5.0.0-beta.3

## 1.0.0-beta.9

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [0629321]
- Updated dependencies [a011c5e]
  - @selvajs/schemas@5.0.0-beta.2
  - @selvajs/platform@0.16.1-beta.2
  - @selvajs/compute@4.0.0-beta.5

## 1.0.0-beta.8

### Patch Changes

- Updated dependencies [0e2c428]
  - @selvajs/platform@0.16.1-beta.1
  - @selvajs/schemas@5.0.0-beta.1
  - @selvajs/compute@4.0.0-beta.4

## 1.0.0-beta.7

### Major Changes

- 5292563: **Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
  aliases left behind. Every reference across the workspace was updated in the same commit.

  ```diff
  -import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
  +import { fetchCompute, ComputeError } from '@selvajs/compute/core';
  ```

  ```diff
  -import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
  +import type { ParamType, InputStructure } from '@selvajs/schemas';
  ```

  Both renamed schema types were already backend-agnostic in value (`ParamType` is
  `number|integer|boolean|text|valueList|dynamicValueList|file|color|generic`; `InputStructure` is
  just arity — `item|list|tree`). Only the names were Rhino-flavored. The rename does not touch wire
  data: `paramType` still serializes as its lowercase string value, never the type name. Regenerated
  via `pnpm generate` — the C# plugin types regenerate too (`Plugin/Selva.Schema/Models/UISchema.Generated.cs`),
  so this needs a plugin rebuild.

  **`@selvajs/compute`'s root barrel is gone** — subpaths only, matching `@selvajs/solve` (no root
  export) and `@selvajs/visualization` (root deliberately empty):

  ```diff
  -import { GrasshopperClient } from '@selvajs/compute';
  +import { GrasshopperClient } from '@selvajs/compute/grasshopper';
  ```

  **Env var renamed:** `MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES`. No dual-read —
  operators update `.env` on upgrade. Everything else in `.env.example` was already neutral
  (`COMPUTE_*`).

  Also reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
  fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
  itself is just a bare string, backend-specific by convention rather than by type).

### Patch Changes

- Updated dependencies [5292563]
  - @selvajs/compute@4.0.0-beta.3
  - @selvajs/schemas@5.0.0-beta.0
  - @selvajs/platform@0.16.1-beta.0

## 1.0.0-beta.6

### Major Changes

- 9f60b66: **`ComputeFetchSolveFnOptions.meshes.loadRhino` is gone**, along with the `TRhino` type parameter
  and the `rhino` field on the `extract` callback's options.

  ```diff
   const onSolve = createComputeFetchSolveFn({
   	endpoint: '/api/v1/compute',
   	meshes: {
  -		loadRhino: () => import('rhino3dm').then((m) => m.default()),
  -		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
  +		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
   	}
   });
  ```

  Curves arrive pre-tessellated from the plugin (see `@selvajs/visualization`), so nothing in a
  viewer decodes Rhino geometry anymore. This option was worse than unnecessary: it loaded the WASM
  **unconditionally whenever `meshes` was configured** — on every viewer solve, not just those
  carrying curves — so removing it is a straight win for first paint and bundle size.

  There is no replacement and no fallback. A definition whose Display component predates backend
  tessellation now fails the solve with an actionable error — upgrade the component in Grasshopper
  (Solution → Upgrade obsolete components) and re-save.

### Patch Changes

- Updated dependencies [9f60b66]
- Updated dependencies [9f60b66]
  - @selvajs/compute@4.0.0-beta.2

## 1.0.0-beta.5

### Major Changes

- b9c9d6a: One name, one value, for how long a solve may run. The deadline is now sourced
  from the server and carried unchanged to the browser's `AbortController`, rather
  than each layer keeping its own answer under its own name.

  **Fixed — the client could abort a solve the server would have finished.** The
  throttle defaulted to `60_000` while the server's deadline was `100_000`, so any
  host that embedded `<ComputeApp>` without passing a timeout aborted at 60 s a
  solve the server was still happily running. The user saw a failure for work that
  succeeded. `@selvajs/solve` can't read env, so the fix is to require the value
  rather than guess it — there is no client-side default left to drift.

  **Breaking — the per-solve deadline is now required:**

  - `createAsyncThrottle`: `options.timeout` → **`options.runDeadlineMs`**, required,
    and the options bag itself is no longer optional. The name says what elapses;
    the throttle is generic, so its field is named after a run, not a solve.
  - `createRequestResponseDriver`: `options.timeout` → **`options.solveDeadlineMs`**,
    required.
  - `ComputeApp`: `solveTimeoutMs?` → **`solveDeadlineMs`**, required. Pass the value
    the server enforces; omitting it is now a type error rather than a silent 60 s.
  - `ComputeLimits.maxSolveDurationMs` → **`solveDeadlineMs`**.

  **Renamed — `MAX_SOLVE_DURATION_MS` → `COMPUTE_SOLVE_DEADLINE_MS`.** It joins the
  `COMPUTE_*` namespace every other compute knob already uses, and says what it
  bounds — one solve — instead of a vague "duration". The old name still works for
  one minor version and warns at boot, so no deployment breaks on upgrade.

  **`selva migrate` now rewrites deprecated env keys in your `.env`**, so a tuned
  value survives the shim being dropped later instead of silently reverting to a
  default. Only the key changes — value, comments, ordering and spacing are left
  byte-identical, a commented-out old name is ignored, and the old line is dropped
  outright when the new name is already set. `.env.bak` is written alongside the
  existing backups and restored if the migration rolls back.

  `selva doctor` reports the same deprecations without changing anything, covering
  this rename plus the four that were previously silent
  (`COMPUTE_DEFINITION_BYTE_CACHE_MB`, `COMPUTE_RESPONSE_CACHE_MB`,
  `DEFINITION_CACHE_TTL_MS`, `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`). The last of those
  is reported but not auto-fixed: its replacement encodes a value
  (`SELVA_FLAG_COMPUTE_DEBUG=verbose`), so migrate won't guess at it.

  Migration: run `selva migrate` to rewrite the env var, and pass `solveDeadlineMs`
  wherever you mount `ComputeApp` or build a driver.

### Minor Changes

- b9c9d6a: Make the reported `SolveResult` reachable from a `ComputeApp` host, so a commit path can pair the
  artifact it persists with the inputs that produced it.

  `source` and `values` travel correctly through the request/response driver's memo, but stopped at the
  session: `applySolveResult` merged `outputs` and discarded the rest, and `ComputeApp`'s only outbound
  seam was `onReady({ loadValues })`. So a host wanting the pair had to capture it inside its own
  `SolveFn` — which a memo hit never calls. Solve A, solve B, scrub back to A: the memo serves A, the
  viewer shows A, and the host commits B's geometry.

  `SolveSession` now exposes `lastResult: RetainedSolveResult | null` — the last reported result minus
  its meshes — and `ComputeApp` hands out `getLastResult()` alongside `loadValues`. Because the session
  fills it in `report()`, a memo hit populates it exactly like a fresh solve.

  Meshes are dropped from the retained slice rather than kept: they are GPU-backed and the viewer
  disposes what it renders on the next scene update, so retaining them would hand out disposed
  instances with no policy governing them. Live meshes stay on `session.meshes`. `rebuild()` nulls
  `lastResult` for the same reason it clears the driver memo; `reportError` deliberately leaves it, as
  the viewer still shows the geometry that produced it.

  `values` remains driver-supplied and absent on push transports (the plugin's WebSocket driver cannot
  attribute an unsolicited frame to a request) — documented on `SolveDriver` and `SolveResult`.

## 0.2.0-beta.4

### Minor Changes

- 64c954e: `SolveResult` now carries the payload it was built from and the inputs that produced it, so a
  consumer with a commit/persist step can hold onto the exact artifact it showed the user.

  ```ts
  const driver = createRequestResponseDriver(onSolve, () => session);
  // on report:
  result.source; // the raw GrasshopperComputeResponse, verbatim
  result.values; // the input set that produced it
  ```

  Both are optional and default to `unknown`/absent, so nothing existing changes shape.
  `createComputeFetchSolveFn` populates `source` and narrows its return to
  `SolveFn<TMesh, GrasshopperComputeResponse>`; `SolveFn`/`SolveResult` gained a matching `TSource`
  parameter so that narrowing survives an explicit return-type annotation.

  **Fixes a stale-result bug in the pattern this replaces.** Capturing the raw response inside your own
  `SolveFn` is silently wrong behind `createRequestResponseDriver`: a memo hit serves the cached result
  without ever calling the `SolveFn`. Solve A, solve B, scrub back to A — the viewer shows A while the
  captured response is still B's, and a commit path freezes that mismatch. The driver stamps `values`
  onto the result before storing it, so both fields travel through the memo with the result they belong
  to.

## 0.2.0-beta.3

### Patch Changes

- b5221ad: `SolveEngine.solve()` now removes the abort listener it attaches to the caller's signal once the
  solve settles. `{ once: true }` only bounds how often a listener fires, not how long it stays
  attached, so every completed solve left one behind on a signal that outlives the call. A request
  signal fires `abort` after the response is consumed, and a session-scoped `AbortController` never
  settles at all — on that second shape the listeners accumulated without bound and Node warned at 11.

  Also simplified the mesh-extraction branch in `createComputeFetchSolveFn`, which checked the
  `meshes` option twice and re-tested a value `getRhino()` already guards.

## 0.2.0-beta.2

### Minor Changes

- 105275c: `@selvajs/solve/server` gains `SolveEngine`, a facade over the four primitives a consumer previously
  had to hand-assemble (`createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`,
  `runSolvePipeline`) plus the coalesce-key/abort/outcome-mapping glue every app route rewrote by hand.

  ```ts
  import { SolveEngine } from '@selvajs/solve/server';

  const engine = new SolveEngine({ limits }); // the 11-field subset of ComputeLimits it needs

  const outcome = await engine.solve({ server, definitionSource, inputs, values, signal });
  return engine.toWebResponse(outcome); // or toResponse() for a framework-agnostic {status,headers,body}
  ```

  `engine.solve()` accepts raw bytes, a string, a `DefinitionRef`, an already-built `ByteCacheRef` (from
  `engine.definitionRef()`, for a caller that needs the bytes before solving — e.g. schema extraction), or
  a `{ versionId, load }` pair that builds and caches the ref internally. `engine.stats()` aggregates
  client-cache, definition-byte-cache, and coalescing counters in one call.

  `@selvajs/solve/client` gains `createComputeFetchSolveFn`, a ready-made `SolveFn` for a
  `/api/compute`-shaped endpoint: 429 cooldown, session-expiry/redirect detection, non-JSON-response
  guarding, and abort handling at every await point, so a new consumer doesn't have to re-derive them.
  Mesh decoding stays a caller-supplied `meshes: { loadRhino, extract }` hook — the package never imports
  a renderer. Debug console telemetry defaults off; pass `debug: true` to enable it.

  `@selvajs/solve`'s TypeScript target moved ES2020 → ES2022 (matching `@selvajs/server`), enabling
  `Error(message, { cause })`.

  ## `@selvajs/selva`

  Migrated to the new facade: `clientCache.server.ts` + `definitionByteCache.server.ts` +
  `solveCache.server.ts` collapse into one `engine.server.ts` constructing a single app-wide
  `SolveEngine`; `/api/compute`'s hand-written coalesce/abort/outcome-mapping block is replaced by
  `engine.solve()` + `engine.toResponse()` (app policy — auth, DB reads, share tokens, rate limiting,
  metric recording — stays in the route, unchanged); the library page's `onSolve` closure is replaced by
  `createComputeFetchSolveFn(...)`. No public behavior change.

## 0.2.0-beta.1

### Patch Changes

- e4f83b2: Bound the scheduler's solve cache by bytes only. `CacheOptions.maxEntries` is
  removed and `maxBytes` is now required, so `cache: true` is no longer valid —
  enabling a cache always states a budget. A budget of `0` disables caching, the
  same as `cache: false`.

  Two bounds meant every caller had to reason about which one would bind first,
  and omitting `maxEntries` silently fell back to a default of 50 that could cap
  the cache far below its byte budget. Responses range from KB to hundreds of MB,
  so memory is the constraint that actually matters.

  Migration: `cache: true` → `cache: { maxBytes: <budget> }`; drop `maxEntries`.

- Updated dependencies [e4f83b2]
  - @selvajs/compute@4.0.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- 8b2c168: The solve session moves out of `@selvajs/visualization` into `@selvajs/solve/client`.

  `@selvajs/visualization` is now **mesh conversion + viewer, and nothing else**. The session was a
  schema-driven form state machine that typed meshes as `unknown` and never inspected one — its
  presence was why the package couldn't be described in a sentence. With it gone the package also
  drops its last Selva dependency (`@selvajs/schemas`), so every sub-path needs only `three`,
  `rhino3dm` and `fflate`.

  **Breaking — `@selvajs/visualization`:**

  - **The `/session` sub-path export is removed.** Import from `@selvajs/solve/client` instead
    (`createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`,
    `createSolveMemo`, `stableInputKey`, the external-input storage helpers, the pure
    `solve-session-core` transitions). `SolveFn`/`SolveResult` come from `@selvajs/solve/shared`.
  - The root barrel no longer re-exports any of the above.
  - `@selvajs/ui` re-exports all of it unchanged, so hosts importing from `@selvajs/ui` or
    `@selvajs/ui/public` need no edit.

  **Renamed — `createComputeThrottle` → `createAsyncThrottle`** (`isComputing` → `isRunning`). It is
  generic over `T`, takes any `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute
  nor HTTP nor geometry — plugin-ui drives it over a WebSocket. The old name said "compute" only
  because of where the file happened to live.

  **Mesh ownership is now injected, not assumed.** `SolveResult<TMesh>` is opaque and the result memo
  no longer imports `three`; the clone/dispose rules are a `MeshPolicy` passed in. The three.js
  implementation is `meshPolicy`, newly exported from `@selvajs/visualization/parse`:

  ```ts
  import { meshPolicy } from '@selvajs/visualization/parse';
  const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
  ```

  `ComputeApp` wires this for you. A custom driver must pass it, or a memo hit will serve geometry the
  viewer already disposed. `createSolveMemo(max)` accordingly becomes
  `createSolveMemo({ max, meshPolicy })`.

  **Fixed while extracting it:** the memo's mesh clone copied `geometry.userData` **by reference**, so
  a cloned geometry shared the cross-solve geometry cache's ownership flag. `clearScene` skips flagged
  geometries (the cache disposes those itself), which meant nothing ever freed the memo's clones. The
  clone now copies `userData` before dropping the flag, and `releaseSceneObjects` refuses to dispose
  genuinely cache-owned geometry.

- 49cac15: The solve core moves out of `@selvajs/server/compute` into `@selvajs/solve/server`, so the whole
  "input change → solve result" chain has one owner on both sides of the wire.

  ## Breaking — `@selvajs/server`

  **1. The solve core moved and is NOT re-exported.** Update the import path:

  ```diff
  -import { runSolvePipeline, createClientCache } from '@selvajs/server/compute';
  +import { runSolvePipeline, createClientCache } from '@selvajs/solve/server';
  ```

  Affected: `runSolvePipeline`, `adaptEnvelopeToEncoding`, `COMPUTE_CONTRACT_VERSION`,
  `COMPUTE_VERSION_HEADER`, `transformInputParameter`, `createClientCache`, `serverIdentity`,
  `createDefinitionByteCache`, `createMemorySolveResultCache`, `deriveSolveCacheInputKey`,
  `encodeSolveCacheEntry`, `decodeSolveCacheEntry`, `gunzipEntryBody`, `createSolveCacheSingleFlight`,
  and their types (`SolveOutcome`, `SolveEnvelope`, `SolvePipelineArgs`, `SolvePipelineCacheHook`,
  `SolvePhaseMetrics`, `PipelineInput`, `CachedClient`, `ByteCacheRef`, `ByteCacheStats`,
  `SolveCacheConfigSubset`, …). Add `@selvajs/solve` as a dependency.

  **2. The root export is gone.** `import … from '@selvajs/server'` no longer resolves; use a subpath:

  ```diff
  -import { resolveComputeLimits } from '@selvajs/server';
  +import { resolveComputeLimits } from '@selvajs/server/compute';
  ```

  The root barrel re-exported all nine subpaths into a single 41-symbol namespace, which hid which
  slice a consumer actually depended on. Nothing in this repo imported it.

  ## What each package owns now

  `@selvajs/server/compute` is **10 exports it owns**: `resolveComputeLimits`,
  `createComputeRateLimiter`, the SSRF guard (`isSafeRemoteDefinitionUrl` /
  `assertSafeRemoteDefinitionUrl`), `createRemoteDefinitionFetcher`, and their helpers/types. That is
  HTTP request policy — admission control and URL safety — which is a different job from running a
  solve. `@selvajs/server` no longer depends on `@selvajs/solve` at all.

  A compatibility shim was considered and rejected: it left `/compute` at 24 exports of which 14 were
  borrowed, so the package's surface no longer described what the package did — the exact problem this
  extraction exists to fix.

  ## `@selvajs/solve` — new `./server` sub-path

  Alongside `./client` and `./shared`, and still deliberately **no root barrel**. Also newly exported:
  `ByteRefOutcome` and `SolveCacheSingleFlightOptions`, which existed but were never public.

  The client/server boundary is enforced three ways: no root barrel, eslint `no-restricted-imports` on
  `src/client/**`, and a bundle test that checks the shipped `dist/client.js` for server modules,
  `process.env` reads and `node:*` imports.

### Patch Changes

- Updated dependencies [53da168]
- Updated dependencies [7751bd0]
  - @selvajs/compute@4.0.0-beta.0
