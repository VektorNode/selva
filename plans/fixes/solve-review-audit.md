# `@selvajs/solve` review: source and tests

> **Tracked in:** unfiled. Review of `packages/solve`. Findings already fixed are removed from this
> document; `git diff packages/solve` shows them. Validation and the bugs this review missed:
> [solve-review-validation](./solve-review-validation.md).
>
> It looks for duplication, logic that does not earn its place, config drift, and tests that do not
> exercise a real case. Line numbers drift: when one stops resolving, grep the quoted text. Each
> finding is tagged `read` (the code was opened) or `name-only` (judged from names; open it before
> acting).

## Ground rules

- `@selvajs/solve` is published and has consumers outside this monorepo. `main` carries 1.2.2 with
  the same exports; `beta` is in changeset pre mode towards 2.0.0. A public removal rides that major
  only if it lands before pre exit. After that it means the next major.
- **A test earns its place** only if it exercises a case a caller or the server can actually hit,
  and its assertion fails when that behaviour breaks. A test does not earn it if it:
  - restates the implementation line by line,
  - mocks away the thing under test,
  - asserts a constant or a shape the compiler already enforces,
  - repeats another test's case with cosmetic input changes,
  - reaches an internal helper through an input no caller can produce,
  - pins accidental behaviour, or
  - is named after an issue or audit number instead of a behaviour.

## Source: duplication

- **Gzip detection written twice.** `/\bgzip\b/i` at `server/solve-pipeline.ts:228` and `:343`. Both
  match `gzip;q=0`, which is a client refusing gzip. One `acceptsGzip()` that honours `q=0`. `read`
- **Rate-limit message built twice.** `client/compute-fetch-solve-fn.ts:64` and `:86`. One
  `rateLimitedError(seconds)`. The pre-check at `:86` also skips a custom `onRateLimited`, so route
  it through the same hook or say the hook fires only on the 429 itself. `read`
- **External storage guards.** `client/external-storage.ts:20-45`: `write`, `read` and `clear` each
  repeat the same two guard lines. One helper returning the key or `null`. `read`
- **Stop branches in the driver.** `client/drivers/request-response.ts:54-58` and `:65-69` both log
  and call `reportStopped`. One branch. `read`
- **`[string, number][]` for prep marks** three times: `SolveEngine` args, `SolvePipelineArgs`,
  `ServerTimingParts`. One `PrepMark` type. `name-only`
- **Two adjacent `if (!result.fromCache)` blocks.** `server/client-cache.ts:313` and `:322`. Merge;
  the second reads `errors` through an untyped cast. `read`
- **The "mesh-free, lags by design" facts** are on both `RetainedSolveResult` and `lastResult`
  (`client/session/solve-session-core.ts:14-23`, `:59-66`). Keep them on the type. `read`
- **`stableInputKey` wraps a one-call `serialize`.** `client/solve-memo.ts:17-27`. Fold them. Keep
  the export: an external host imports it. `read`

## Source: logic that does not earn its place

**Client**

- `client/async-throttle.ts:51`: `abortCurrent()` at the top of `execute` is a no-op. `execute` runs
  only when idle and `finally` has nulled the controller. `read`
- `client/session/solve-session.ts:254,256`: `if (held)` in `acknowledge`. `awaitingAck` true implies
  `heldResult` is set. Derive `awaitingAck` from `heldResult`, which removes the guard. `read`
- `client/session/solve-session.ts:154,297,335,364,367`, `solve-session-core.ts:143,156,204,252`:
  `schema?.`, `inputs?.` and `diagnostics ?? []` guard non-optional fields, and
  `buildInitialValues` already dereferences them unguarded. `read`
- `solve-session-core.ts:108-121,164,209`: transitions mutate `state` and return it; the session
  ignores the return. Only `solve-session-core.test.ts` reads it. `read`
- `pendingValues` on `SolveSessionState` is written and cleared but read by nothing outside tests.
  `read`
- `client/solve-memo.ts:90-91`: `if (oldest === undefined) break` exists only to satisfy the types.
  `read`
- `client/solve-memo.ts:82,93,98`: `console.info` on every hit, evict and clear, always on, during a
  slider scrub. `compute-fetch-solve-fn.ts:77` gates the same kind of log behind `debug`. `read`
- `client/compute-fetch-solve-fn.ts:170,215`: `bytes` holds UTF-16 units and `heapMB` holds bytes.
  Debug logs only; rename. `read`
- `client/events/live-solve.ts:22,57`: `ended.kind` is `string`, and a malformed payload silently
  reads as `'ok'`. Use `SolveEndedKind`. `read`
- `client/events/live-solve.ts:63`: runs the whole-outcome decoder on one message. Export a
  `decodeDiagnostic` from `shared/outcome.ts`. `read`
- `client/events/solve-event-stream.ts:72-73`: `subscribe` calls `open()` again, which only matters
  after `close()`, where it silently reopens under the old `streamId`. Drop it or say so. `read`

**Server**

- `server/solve-pipeline.ts:163-165`: `treeBuildMs` times `args.inputTree ?? ...`. `SolveEngine`
  always passes the tree, so `tree;dur` is about 0 on every real path and hosts log that number.
  `read`
- `server/solve-pipeline.ts:246-248,253`: `serialized.length` is UTF-16 units, compared with
  `responseMaxBytes`, stored as `serializedBytes` and used for the gzip threshold. Only `:307` uses
  `Buffer.byteLength`. Non-ASCII output gets the wrong cap and metric. `read`
- `server/solve-pipeline.ts:348-350`: `envelope.encoding === 'gzip'` always has a `Uint8Array` body,
  so the `Buffer.from` arm is unreachable. `:255` and `solve-engine.ts:310-315` copy a body that is
  already a `Uint8Array`. `read`
- `server/solve-pipeline.ts:189-191`: the `AbortError` arm is justified by a custom executor, but
  this pipeline always calls `client.scheduler.solveDetailed`, which normalizes aborts. `name-only`
- `server/solve-engine.ts:133-144,83,325-328`: the `{ versionId, load }` source sugar has no
  non-test caller. `read`
- `server/solve-engine.ts:277-289`: `toResponse(opts.onError)` has no consumer, and `fail` falls
  through if a hook does not throw. `read`
- `server/client-cache.ts:32-44,105,394`: the `ServerIdentity` brand buys nothing. `getClient` keys
  on plain `server.id`, and `evict` takes `string | ServerIdentity`, which collapses to `string`.
  `read`
- `server/definition-byte-cache.ts:53-55,69-72`: the `Entry` wrapper adds nothing; `store` re-sets an
  existing key without moving it to the MRU end. `delete` before `set`. `read`
- `server/solve-cache-single-flight.ts:41-44,58`: `promise: undefined!`, and `onJoin` and
  `onWaiterJoined` are two channels for one event. `read`
- `server/transform-input.ts:11`: filters on `paramType`, which the schema declares required. Only a
  test feeds `undefined`. Drop it, or keep it and say persisted schemas can lack it. `read`
- `server/solve-pipeline.ts:60`: `PipelineInput = SolveInput` is a pure alias. `read`
- `shared/outcome.ts:26,34-36`: hand-cast decoding of unknown wire data. A narrow type guard against
  the generated level union replaces the string set. `read`

**Comments and docs**

Rule violations: `server/solve-cache-single-flight.ts:7-9` and `server/README.md:100` narrate
history; `client/compute-fetch-solve-fn.ts:6-13` narrates ("Ports", "re-deriving");
`client/external-storage.ts:3-4` names consumer packages; `client/index.ts:5-13,25,29-30` justifies
exports by a host that does not exist; `client/session/solve-session.ts:351-353,360` cross-references
instead of stating; `client/events/solve-event-stream.ts:58` comments an absent handler;
`client/async-throttle.ts:66-68,89-91` restates; `shared/solve-fn.ts:10-16` stacks a `TMesh` doc on
the wrong symbol; `server/client-cache.ts:51` and `server/solve-engine.ts:62` carry a literal
"Default 16"; `server/client-cache.ts:23-26,59-63` narrates a future router;
`server/solve-pipeline.ts:128-134` is a second home for the status map.

Docs that contradict the code:

- `src/client/README.md:40,116`: `createRequestResponseDriver()` with no arguments; it needs
  `(onSolve, getReporter, { solveDeadlineMs })`. `:41`: `session.solve({...})`; `solve()` takes no
  arguments. `:73-75,146`: options omit `solveDeadlineMs`. `:125-128`: omits required `inputs` and
  `outputs`. `read`
- `src/client/README.md:111-118`: the "WebSocket app" example uses the HTTP driver. The WebSocket
  driver lives in plugin-ui. `read`
- `src/server/README.md:79`, `src/server/index.ts:10`, `README.md:247`: claim `node:crypto`,
  `process.env`, cache backends and credentials. The server half uses `node:zlib`, `node:util` and
  `undici`. `read`
- `src/server/README.md:106-109`: a "Server-Timing" section describes the contract-version header.
  `read`
- `src/server/README.md:16-22`: the file table omits `solve-engine.ts` and `long-fetch.ts`. `read`
- `README.md:197-204`: engine step order is wrong; the tree is built before single-flight. `read`
- `README.md:22`: "just need the types", but `/shared` exports runtime functions. `read`
- `server/client-cache.ts:99-103`, `solve-engine.ts:99`: call `definitionGuid` per solve. It is baked
  into the cached client at first build, so every later solve on that server carries the first
  definition's guid. `read`

## Public API candidates

`SolveOutcome` names two different types: the pipeline union on `/server` and the wire verdict on
`/shared` and `/client`. Rename the server one (`SolveEngineOutcome`). It is the one change here an
external host has to adapt to, in type-only edits.

Removal candidates, with no importer in the repo or the known external host, confirmed by a repo-wide
search. Most of the unused barrel rows are not here: those are types reachable from signatures that
stay (`SolveEngineOptions`, `MeshPolicy`, `ResolvedServer`).

- Client: `applyValueChange`, `makeInitialFlags`, `pickInputValues`, `applySolveResult`,
  `solvePhase`, `buildInitialValues`, `SolveSessionState`, `ExternalReader`, `reduceLiveSolve`,
  `createAsyncThrottle`, `AsyncThrottle`, `createSolveMemo`, `SolveMemo`, `SolveMemoOptions`.
  `createAsyncThrottle` appears in prose in `packages/ui/CONTEXT.md`, `createSolveMemo` in a comment
  in the website's `LruDemo.svelte`; update both.
- Server: `runSolvePipeline`, `SolvePipelineArgs`, `adaptEnvelopeToEncoding`, `buildSolveInputTree`,
  `createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight` and their handle
  types, `serverIdentity`, `ServerIdentity`, `isDefinitionRef`, `FrameworkAgnosticResponse`.
  `runSolvePipeline` and `buildSolveInputTree` are documented in `src/server/README.md`, and named by
  `plans/features/presolve-bundle.md` and `docs/adr/0001-pre-step-producers.md`.
  `createClientCache` and `serverIdentity` are named by ADR 0004.
- Shared: `SOLVE_BLOCKED_MARKER`, `outcomeFromComputeMessages`.

`EMPTY_LIVE_SOLVE` stays: plugin-ui uses it and `@selvajs/ui` re-exports it.

## Package, scripts and config

Baseline: type-check, lint, build and `publint --strict` are green; `attw` is green for node16 and
bundler, and the node10 and CJS warnings match the ESM-only siblings. `dist/client.js` reaches no
`node:`, `undici` or `@selvajs/platform` import, transitively. The `.d.ts` leaks no devDependency.

- **The bundle-boundary guard can skip in CI.** `src/__tests__/client-bundle-boundary.test.ts` is
  `describe.skipIf(!hasBuild)`, `turbo.json` `test` depends only on `^build`, and
  `.github/workflows/test.yml:123` runs `turbo run test`. Add
  `"@selvajs/solve#test": { "dependsOn": ["build"] }`, or fail when `dist` is missing under `CI`.
  `read`
- **`@selvajs/platform` is a runtime dep for `NoopLogger` and `ILogger` only**
  (`server/solve-engine.ts:17`), and `server.js` imports the root barrel for it. Both consumers pass
  `onDebugLog`, so see the simplification below. `read`
- **Hardcoded devDep versions:** `esbuild`, `eslint-config-prettier`, `globals`, `@eslint/js`.
  `read`
- **Unused devDeps:** `@eslint/js`, `eslint-config-prettier` and `globals` are imported only by
  `@selvajs/config`, which does not declare them. Check they still resolve before dropping them from
  this package; declaring them in `@selvajs/config` is the real fix. `vite` is not imported here;
  compute and platform do without it. `read`
- **No `prepack: publint --strict`**, which compute, platform, schemas and server have. `read`
- **`build` runs `type-check` first**, which compute and platform do not. `read`
- **`files`:** the `!__tests__`, `!*.test.*` and `!*.spec.*` negations cover nothing, since only
  `dist` and `README.md` are allowed. `LICENSE` ships anyway. `read`
- **`tsconfig.json`** applies `lib: DOM` and `types: node` to everything, so `tsc` cannot tell client
  from server. Nothing uses the gap today (`rg` finds no `Buffer` or `process` in `src/client`), so
  it is latent. Per-folder configs would close it. It also lacks `verbatimModuleSyntax`, which compute
  sets and which guards the failure mode the boundary test names. `read`
- **`eslint.config.mjs:19-37`** covers `src/client/**` only. `src/shared/**`, imported by both halves,
  has no ban, and bare `undici` is not banned in `client/`. `read`
- **`sideEffects: false`:** `new Agent()` runs at import of `server.js`. A bundler dropping an unused
  `server` entry is what you want, so this is harmless; the fix is lazy construction only if import
  cost shows up. `read`

Left alone, checked: source maps point at unshipped `../src` but embed `sourcesContent`; no
`selva-source` condition (compute has none either); changeset wiring; `engines`.

## Tests

### Overlap across files

- Debounce and memo rate: `drag-rate.test.ts` copies `packages/ui`'s debounce. Keep the real paths:
  `async-throttle.test.ts` "keeps only one in flight" and `solve-session.test.ts:110`.
- Abort signal forwarded to the scheduler: `solve-pipeline.test.ts:206` and the queued-disconnect
  test at `:431`. Keep `:431`.
- `paramType` filter: `solve-pipeline.test.ts:150`, `:185` and `transform-input.test.ts:28`. Keep
  `:185` with a no-`paramType` input, and `transform-input.test.ts:28`.
- Memo hit reporting: `solve-session.test.ts:135` and `:209`. Keep `:209`.
- Held-result commit: `solve-session-core.test.ts:228` and `solve-session.test.ts:391`. Keep `:391`.

### Files to delete whole

- `src/client/__tests__/drag-rate.test.ts`: re-implements the debounce inline and asserts a
  simulation's request count.
- `src/shared/__tests__/solve-input.test.ts`: type assertions with a runtime shell. `expectTypeOf`
  does nothing unless typecheck mode is on.
- `src/server/__tests__/solve-result-cache-seam.test.ts`: tests an LRU defined in the test file, plus
  platform's `NoopSolveResultCache`. Move the Noop case to platform if it is wanted.

### Per file

- `src/__tests__/client-bundle-boundary.test.ts`: trim. Drop "bundles for the browser at all" (`:46`)
  and the placeholder `it.skip` with its describe (`:104-108`), which never runs. Make "proves the
  assertions can fail" (`:84`) assert every `serverOnly` name, and check `server.js` in `hasBuild`.
- `client/__tests__/async-throttle.test.ts`: trim. Drop "aborts the in-flight request when a new one
  starts": its name is false, it never asserts an abort.
- `client/__tests__/compute-fetch-solve-fn.test.ts`: trim. Fold `:91` into `:44`. Drop `:204` and
  `:274`. `:44` is named "extracts outputs" and never asserts `result.outputs`: add that, plus a
  nickname-fallback case.
- `client/__tests__/external-storage.test.ts`, `live-solve.test.ts`, `shared/__tests__/outcome.test.ts`,
  `server/__tests__/long-fetch.test.ts`: keep.
- `client/__tests__/solve-memo.test.ts`: trim. Drop "handles null and primitive values" and "never
  hands the same mesh instance to two consumers" (covered by the test at `:160`).
- `client/__tests__/solve-session-core.test.ts`: trim. Drop `:270`.
- `client/__tests__/solve-session.test.ts`: trim. Drop `:135`. Rewrite `:172`: it counts `clearCache`
  on a wrapper instead of proving a second definition re-solves.
- `shared/__tests__/compute-diagnostics.test.ts`: trim. Drop `:77-108`. Rewrite `:113` around an error
  carrying only `[Selva:log]`.
- `server/__tests__/client-cache.test.ts`: trim. Drop `:227`, `:301`, `:387`, `:493`, `:540`. Fold
  `:510` into `:500`, `:341` into `:127`, `:168` into `:148`. Assert HIT and miss rather than full log
  prefixes at `:409-441`. Move the fetch-wiring tests out of the concurrency describe; drop the ADR
  pointer at `:327`.
- `server/__tests__/definition-byte-cache.test.ts`: trim. Merge `:13` and `:28`. Rename `:119`: it
  never re-stores. Drop `:96`.
- `server/__tests__/solve-cache-single-flight.test.ts`: trim. Drop `:123`. Fold `:82` into `:60`.
- `server/__tests__/solve-engine.test.ts`: keep, tighten. "aggregates stats" asserts zeros from a
  fresh engine. The "no byteRefOutcome threading" test asserts only `kind`. Shorten the `{versionId,
load}` test name.
- `server/__tests__/solve-pipeline.test.ts`: trim. Drop `:198`, `:206`. Merge `:150` into `:185`.
  Rename `:318` and `:431`, which cite "C5" and "R3"; drop "ISSUES 46" and "K3".
- `server/__tests__/transform-input.test.ts`: trim. Keep "clamps", "lets value win", "falls back to
  default", "keeps explicit false" and "skips no paramType". The rest test `TreeBuilder`; check
  compute covers them, then drop.

### Real behaviour with no test

- `client/events/solve-event-stream.ts` has no test: `currentSolveId` tracking, `cancelCurrent`,
  malformed JSON, `?` vs `&` on the stream id.
- `solve-session.ts`: `loadValues`, `abort()` reaching `driver.cancel`, `ensureSolved` after an error
  or a block, `rebuild` in manual mode, `rebuild` abandoning waiters, a failing `onSolve` writing no
  memo entry.
- `compute-fetch-solve-fn.ts`: every test uses the legacy `errors`/`warnings` strings; the structured
  `selva.outcome` path has no test. Nor do 503 with a message, 500, 429 without `Retry-After`, or
  network failure.
- `async-throttle.ts`: the `TimeoutError` reason `request-response.ts` relies on; a rejecting run.
- `solve-engine.ts`: different values must not coalesce (the mock `TreeBuilder` hides a bad key),
  mixed `acceptEncoding` through `engine.solve`, the facade methods, seven of the eight limit
  mappings, and the non-ok passthrough.
- `solve-pipeline.ts`: the `RangeError` and non-`RangeError` branches of `JSON.stringify`.
- `client-cache.ts`: failed-build TTL expiry, two callers sharing a failing build,
  `clearSolveCaches`.
- `solve-cache-single-flight.ts`: a synchronous throw in `work`.

## Simplification and architecture

Worth doing, most valuable first. None touches the public API unless it says so.

1. **Coalesce the solve, not the envelope.** Single-flight wraps only the scheduler call and error
   classification. Each caller encodes its own response afterwards, and a new `response-encoding.ts`
   owns `gzippedBodies`, holding a promise so N waiters gzip once. This removes
   `adaptEnvelopeToEncoding`, the blocking `gunzipSync` and the second regex. Waiters get their own
   Server-Timing. Cost: non-gzip waiters each stringify. Tests: the `adaptEnvelopeToEncoding` block
   becomes encoder tests; engine coalescing tests stay.
2. **Ref-counted abort in single-flight.** `run(key, work(signal), callerSignal)` aborts when the last
   caller leaves and frees the key then, replacing `hasWaiters` and `onWaiterJoined`. Do it with (1).
   Tests: `solve-cache-single-flight.test.ts`, engine tests `:239`, `:270`, `:292`.
3. **Make the pipeline internal.** Unexport `runSolvePipeline`, make `inputTree` required, drop
   `inputs` and `values`, and measure the tree build in the engine. Public removal. Do not merge
   engine and pipeline: stateless execution and owned state have different reasons to change.
4. **Normalize the definition source at the boundary.** Drop `{ versionId, load }` and the separate
   `byteRefOutcome` argument. Public: the union narrows. No caller changes.
5. **One landing path in the session.** `report`, `reportError`, `reportAborted`, `acknowledge` and
   `discard` each hand-roll mutate, emit, queued/held check, settle. Fold them into one `land()`.
   Whether a user cancel of a newer solve also drops a held result is a product call.
6. **Finish the session/core split.** The header says every decision lives in core, but `loadValues`,
   `ensureSolved`, `forceSolve` and `rebuild` decide in the shell. Add `createInitialState()` for
   create and `rebuild`, delete `pendingValues`, derive `awaitingAck`, make transitions `void`.
   Core tests need mechanical edits.
7. **Cut the barrels.** See [Public API candidates](#public-api-candidates).
8. **Drop `@selvajs/platform`.** Remove the `logger` option, `NoopLogger` and the dependency. Public:
   one option. Selva deletes one line. This supersedes adding a narrow platform subpath.
9. **Rename the server `SolveOutcome`, drop `PipelineInput`.** Public.
10. **Fold `toResponse` into `toWebResponse`,** dropping `onError` and `FrameworkAgnosticResponse`.
    Public. Keep the mapping; fix the `server/index.ts` line saying status mapping is "not here".
11. **Extract the concurrency probe and debug text from `client-cache.ts`.** Low priority. Covered by
    `client-cache.test.ts`.

Considered and left:

- **Splitting the server half into its own package:** with platform gone only `undici` remains, in
  one file, and the boundary test shows it never reaches a browser. It saves install weight and costs
  a package. An optional peer does not work: `long-fetch.ts` imports it statically.
- **`SolveEngine` as a class:** inconsistent with the factories, but nothing hangs on the difference.
- **One shared LRU:** the three have different units and ownership.
- **Single-flight in the scheduler:** abort semantics across a queue in a browser-safe package cost
  more than they save.
- **Merging session and core, or a real reducer:** `values` is a live map that can hold large
  outputs, and nothing needs the purity.
- **`MeshPolicy`:** the viewer disposes what it renders, so memo hits need it.
- **Optional driver members:** the HTTP and WebSocket drivers really differ.
- **Lazy `getReporter`:** the session and driver reference each other.
- **`TMesh` on `SolveSession`:** hosts take `any[]`, so it buys nothing yet.
- **Per-solve `X-Selva-Definition`:** needs a compute scheduler option, and nothing reads the header
  today. Correct the comment now.

## File size

Three files have more than one reason to change:

- `server/solve-pipeline.ts`: outcome classification, wire encoding, the Server-Timing format.
- `server/client-cache.ts`: warm-client lifetime, adaptive concurrency, debug telemetry.
- `client/compute-fetch-solve-fn.ts`: HTTP failure policy, verdict and output extraction, telemetry.

## Order of work

1. Duplication, dead logic and docs that leave the API alone.
2. Test cuts, then the untested behaviour above.
3. Simplifications 1 and 2 together, then 5 and 6.
4. Public API changes (3, 4, 7, 8, 9, 10) before pre exit. Only 9 needs an external host to adapt.

## How to validate this document

- Findings are from reading the code; the tests section was read test by test. Rows tagged
  `name-only` must be opened first. Proposals were not prototyped, so their costs are estimates.
- Re-check: `pnpm type-check && pnpm lint && pnpm test` in `packages/solve`, and
  `pnpm dlx publint --strict`.
- Decisions a human must make: the public API list, the package's server dependency shape, and what
  a user cancel does to a held result.
