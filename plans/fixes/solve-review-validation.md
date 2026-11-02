# `@selvajs/solve` review: validation

> **Tracked in:** unfiled. Validates [solve-review-audit](./solve-review-audit.md), then lists what
> that review missed. Line numbers drift: when one stops resolving, grep the quoted text.

## How this was checked

Baseline on `beta`: `tsc`, `eslint`, `vitest` (296 passed, 1 skipped), `tsdown` and
`publint --strict` all green. The suite stayed green while every bug below reproduced.

Every test "drop" row, every public API row and every config row was checked by an agent that did
not write it. `vitest` and lint were rerun in a throwaway clone with the proposed devDeps removed.
Proposals were judged against the built output and measured. Three independent bug hunts ran
against `dist` without seeing the review. Each hunt script was rerun once more, except H19, where
the recorded 335 s output was read, and H24, whose probe ran once.

Not verified here:

- **Real Rhino.Compute.** Server repros use a stub over real HTTP, so nothing below proves how the
  VektorNode fork behaves.
- **A browser.** Client repros run in Node with real timers. The Svelte layers were read, not run.
- **The live routes for the forged-inputs finding.** It is reproduced at `buildSolveInputTree`; the
  route path is from reading.
- **The comment-rule paragraph** in the review: only the two "Default 16" literals were opened.
- **Four "keep" verdicts** (`external-storage`, `live-solve`, `outcome`, `long-fetch` test files)
  rest on the review's read alone, and three of the fourteen no-test bullets were not sampled.

## Corrections

Wrong:

- **"Mesh-free, lags by design" duplication.** Not a duplicate. Mesh-free is on
  `RetainedSolveResult`; "lags" describes the `lastResult` field only
  (`solve-session-core.ts:14-23`, `:59-66`). Leave both.
- **`FrameworkAgnosticResponse` as a removal.** It is the return type of the public
  `SolveEngine.toResponse`. It goes only if simplification 10 makes `toResponse` private first.
- **"`rebuild` abandoning waiters" has no test.** `solve-session.test.ts:616` covers it. `rebuild` in
  manual mode is covered for notification only (`:325-334`).

Partly right, source and config:

- **`schema?.` guards.** Redundant in `solve-session.ts`. In `solve-session-core.ts:143,156,204,252`
  the parameters are declared optional and `solve-session-core.test.ts:248` passes `undefined`, so
  tighten the signatures first.
- **Transitions return `state`.** True, but `applyValueChange`'s `shouldSolve` is used. Return a
  boolean, not `void`.
- **`tree;dur` is about 0.** True through `SolveEngine`. A direct `runSolvePipeline` caller still
  measures a real build.
- **Copies of a `Uint8Array`.** `solve-pipeline.ts:255` can go. `solve-engine.ts:312` cannot: TS
  rejects `Uint8Array<ArrayBufferLike>` as `BodyInit`, so it is a type requirement costing 1.5 ms at
  50 MB. Use a cast or leave it.
- **`AbortError` arm.** Confirmed unreachable and promote the tag to `read`:
  `solve-scheduler.ts:719-721` normalizes it. `solve-pipeline.test.ts:366-385` throws a raw
  `AbortError` from a mock and must change with it.
- **`onJoin` and `onWaiterJoined`.** One event, two audiences (engine hook, owner only). Merging
  changes behaviour. `undefined!` is removable.
- **Gzip regex.** Three copies, not two: `selva/.../definitions/[guid]/solve/+server.ts:89` feeds the
  idempotency bucket, so a stored gzip reply can replay to a later `gzip;q=0`. The route must call the
  same `acceptsGzip`, which is one new public symbol. `x-gzip` also matches.
- **Rate-limit message.** "Route the pre-check through the hook" falls through to `fetch` with a
  non-throwing hook, which `compute-fetch-solve-fn.test.ts:126` pins. Call the hook, then always
  throw.
- **Stop branches.** The second sits inside the `try`, so a throwing `report()` reaches `reportError`.
  One branch changes that path. Skip this.
- **`SOLVE_BLOCKED_MARKER`.** Safe to unexport, but `SolveDiagnostics.cs:15` names the constant in a
  comment; reword it.
- **Doc updates for the barrel cut.** Also add `src/client/README.md:29` (`reduceLiveSolve`) and
  `client/index.ts:30-31` to the doc updates for the barrel cut.
- **Bundle-boundary guard skips in CI.** Reproduced for `--filter` and local runs: 6 tests skip. In
  CI `pnpm type-check` runs first and pulls `solve#build` through `ui` and `selva`, so `dist` is
  normally present. Fragile, not happening today. The `turbo.json` fix stands.
- **Hardcoded devDeps.** The catalog has no entries for these. Dropping three of them is the fix,
  which leaves `esbuild`.
- **Unused devDeps.** Confirmed by clone: with all four removed, install, lint, build and tests stay
  green. `@selvajs/config` resolves them from the root `package.json`.
- **`sideEffects`.** `new Agent()` costs 0.03 ms and opens nothing; the 54 ms is the `undici` import,
  which is needed anyway. Lazy construction buys nothing.

Partly right, tests:

- **`drag-rate.test.ts`.** The debounce and memo are inline copies, as stated, but it is the only
  place pinning that spaced moves with a fast solve exceed the 120/100 s limit. See
  [Decisions](#decisions-that-need-a-human) before deleting.
- **`solve-input.test.ts`.** `expectTypeOf` is a no-op in vitest, but `tsc --noEmit` compiles this
  file, so `meshes: unknown[]` and `SolveInput extends SchemaInput` are enforced by `pnpm type-check`.
  Delete the runtime shell, keep the type assertions.
- **`client-bundle-boundary.test.ts`.** Content right, lines wrong: `:52`, `:87`, `:107-109`.
- **`compute-fetch-solve-fn.test.ts:204`.** Keep it. It is the only positive control for `:195`, which
  otherwise passes with no telemetry at all.
- **`solve-memo.test.ts` mesh-instance test.** The survivor is `:140`, not `:160`.
- **`solve-session-core.test.ts:228`.** Add its `hasNeverSolved` assertion to
  `solve-session.test.ts:391` before dropping it.
- **`compute-diagnostics.test.ts`.** The duplicate is `:69-97`. `:77-108` would cut `:100`, the only
  test of the `[Selva:log]` non-gate path. The proposed `:113` rewrite fails against today's code: an
  error carrying `[Selva:log]` gets no `isGate`. The message is still shown, so rename the test.
- **`client-cache.test.ts`.** Carry `mode === 'queue'` from `:341` into `:127`. The `:409-441` change
  is a brittleness fix, not HIT/miss coverage: `onSettle`'s HIT/miss has no test.
- **`transform-input.test.ts`.** Also keep `:20`, which pins nickname to `paramName`. Compute's
  `data-tree.test.ts:377-510` covers the rest.
- **`solve-pipeline.test.ts:185`, the `{versionId, load}` test name, and `:318`.** The review edits
  tests that simplifications 1, 3 and 4 delete. Leave them until those land.
- **No-test list.** "429 without `Retry-After`" is partly covered at `compute-fetch-solve-fn.test.ts:143`,
  and `TimeoutError` indirectly at `solve-session.test.ts:696`.

Partly right, proposals:

- **The section header.** "None touches the public API unless it says so" is false for 1 (removes
  `adaptEnvelopeToEncoding`), 2 (`run` signature on an exported factory) and 6 (exported transitions,
  `SolveSessionState`).
- **1, coalesce the solve.** Sound with one change. As written it regresses plain clients, because
  all waiters resume in one microtask run. Memoize `json` on a per-flight wrapper, not the WeakMap.
  It dies with the waiters and wins every row (N=4, 50 MB, longest event-loop block, ms):

  ```text
  scenario                  current   as written   per-flight json
  owner-gzip+3plain display     579          121                34
  owner-gzip+3plain tree        310          265                70
  all-plain display              35          100                26
  all-plain tree                 65          217                54
  ```

  Heap at all-plain is 50 MB current, 200 MB as written, 50 MB per-flight. All-gzip is unchanged.
  Owner-plain with gzip waiters drops the wire from 200 MB to 163 MB. Also:
  - Order stays stringify, then `RangeError` and cap, then gzip. The memo stores
    `Promise<{ body, serializedBytes }>`, resolves to a `too_large` verdict, and is deleted on
    rejection, or a response stays poisoned while cached.
  - The key frees before encoding, so with no result cache a caller arriving during gzip re-solves.
  - A waiter reads its own ref's `def_bytes` as `skipped`. Carry the owner's verdict in the flight.
  - `runSolvePipeline` cannot drop its envelope while public, so 3 goes first.

- **2, ref-counted abort.** Sound, including killing near-complete solves: an aborted executor never
  reaches `cache.set`, and a solo disconnect already does this. A departed waiter must skip encoding
  after the flight, or 1 makes it stringify for nobody.
- **5, one landing path.** The five paths really differ: `acknowledge` and `discard` ignore
  `hasQueued`, `report` also checks `awaitingAck`. A plain `land()` changes acknowledge-while-queued.
  Write the policy test first, and accept two shapes if that is what it shows.
- **6, finish the split.** `awaitingAck` stays as a session getter. Do it after 7.
- **7, cut the barrels.** ADR 0004 D1 requires an opaque identity, so removing `serverIdentity`
  amends the ADR in the same change. `createClientCache` is only an implementation note there.
- **8, drop platform.** Also update `README.md:160` and `server/README.md:102`. A JS host passing
  `logger` silently loses debug lines. Delete `solve-result-cache-seam.test.ts` first.
- **9.** Confirmed. It is the only change an external host must adapt to, in five type-only files.
- **Order of work.** Step 2 edits tests that step 3 and 4 delete, and step 3 changes public API before
  step 4 decides it. Decide the public list first, leave affected test cuts until after 1, 3, 4 and 10.
- **Considered and left.** All agreed. Per-solve `X-Selva-Definition`: also correct ADR 0004's "useful
  in access logs" line.

## Confirmed

Under the review's headings. Everything not listed in Corrections held.

- **Duplication:** rate-limit message, storage guards, `PrepMark`, adjacent `fromCache` blocks,
  `stableInputKey` (the fold widens the public parameter, compatibly).
- **Logic, client:** `abortCurrent` no-op, `if (held)`, `pendingValues` unread (three test lines read
  it), memo `break`, ungated memo logs, `bytes` and `heapMB`, `ended.kind`, `decodeOutcome` on one
  message, `subscribe` reopening.
- **Logic, server:** `serialized.length`, unreachable `Buffer.from`, `{ versionId, load }`, `onError`
  and `fail`, `ServerIdentity`, the byte-cache `Entry` and MRU, the `paramType` filter,
  `PipelineInput`, hand-cast decoding.
- **Docs:** every README and JSDoc contradiction, including `definitionGuid`.
- **Public API:** all rows except `FrameworkAgnosticResponse`. Removal has no code importer in the
  repo or the known external host. `EMPTY_LIVE_SOLVE` stays.
- **Config:** `prepack`, `build`, `files`, `tsconfig`, `eslint` scope, platform runtime dep.
- **Tests:** `solve-result-cache-seam.test.ts` deletion, `async-throttle` drop,
  `solve-session.test.ts:135` and `:172`, `solve-session-core.test.ts:270`, `client-cache` drops and
  folds, `definition-byte-cache`, `solve-cache-single-flight` (lines point inside the tests),
  `solve-engine` tightening, `solve-pipeline` renames.
- **Architecture:** 3, 4, 10, 11 sound. Presolve is a planning doc whose foundation is gone and its
  `solve` is injected, so `engine.solve` fits; change `presolve-bundle.md:169`.

## New findings

Ranked by impact. None of these is in the review as a bug. Simplification 2 proposes the fix for H6
without naming the bug.

### High

**H1. The request body defines the inputs.** `reproduced` at the tree, `read-only` through routes.
`server/transform-input.ts:9-15`, reached from `selva/.../api/v1/compute/+server.ts:50` and
`definitions/[guid]/solve/+server.ts:69`. `solve-pipeline.ts:71` calls them "persisted input
params", but both routes pass `body.inputs` and the README example does too. The caller picks `id`,
`nickname`, `paramType` and the bounds:

- Dropping `maximum` turned a clamped 100 into 1e9, so a share-link visitor sets their own limits on
  the owner's Compute.
- An input with a chosen `id` and a reserved `nickname` fills a host-owned slot
  (`["host-context",["FORGED-CONTEXT"]]`). A host that injects reserved values by id, or filters
  `values` by schema id, is bypassed. An external host carrying that rule is exposed on its preview
  path.

Fix: resolve `inputs` from the stored version schema on the server and ignore the body's copy. Use
`Object.hasOwn(values, id)`: an `id` of `constructor` reads the inherited function today.

**H2. One hung solve wedges the session for good.** `reproduced`. `client/async-throttle.ts:64`. The
slot frees only when `run` settles. With a `SolveFn` that ignores the signal, after the deadline and
after `abort()`, `isSolving` stayed true, `solve()` stayed pending, `error` stayed empty, and the next
`setValue` never ran. Production path: `meshes.extract` (`compute-fetch-solve-fn.ts:195`) gets no
signal, so a hang in mesh parsing outlives the deadline `runDeadlineMs` documents. Fix: race `run`
against the abort, report the stop, ignore the late settlement, and pass `signal` to `extract`.

**H3. `rebuild` lets the old definition's result land in the new session.** `reproduced`.
`client/session/solve-session.ts:343`, `drivers/request-response.ts:61-63`. It neither cancels the run
nor stops `memo.set` after `clearCache`. In a manual schema the new session showed `OLD-MESH` with
`hasNeverSolved` false, dirty false and `applied` settled. With equal input ids the old result filled
the just-cleared memo and v2 never solved. A commit gate commits the wrong definition. Fix:
`driver.cancel()` before `clearCache`, and a generation on the driver that skips `memo.set` and
`report` for older runs.

**H4. `ensureSolved` returns a stale result.** `reproduced`. `client/session/solve-session.ts:315-325`.
After `abort()` or `discard()` in auto mode nothing marks inputs unsolved: `applied` with
`result.values.a === 1` while `values.a === 2`, no solve run. `ui/run-panel-action.ts:14` runs
`solvesFirst` actions such as exports on that result. Fix: solve unless `lastResult.values` equals the
picked inputs, or raise a dirty flag on abort and discard. For a discard, decide between re-solving
and settling `discarded`.

**H5. A value edited during a manual solve loses its dirty flag.** `reproduced`.
`solve-session-core.ts:188-189,217-218`. Result: `values.a=2`, `hasPendingChanges=false`,
`lastResult.values.a=1`. The Calculate prompt disappears on a stale answer, and H4's export path
follows. Fix: clear only the pending ids whose value equals `result.values[id]`. Push drivers report
no `values`, so they need a dispatch-time snapshot.

**H6. Abort ownership in single-flight is wrong both ways.** `reproduced`.
`server/solve-engine.ts:226-229`. Leader and waiter both gone: nothing cancels upstream
(`upstreamCancelled: 0`), the key stays in flight, the waiter never settles, and the Rhino slot is
held to the deadline. One waiter that joins and leaves disables cancellation. A live caller joining a
dying flight gets `client_abort`, a 499 for a client that never aborted; an external host carries a
workaround for exactly this. Fix: simplification 2, plus H15.

**H7. `evict` ignores a build in flight.** `reproduced`. `server/client-cache.ts:394,432`. After key
rotation the wire carried `OLD-KEY`. After evict plus a new URL the client pointed at the old URL, with
no expiry until the next evict. A stale build failing after the evict writes `failed`, so the corrected
config replays the old 401 for 5 s. `disposeAll` during a build left one warm client after shutdown. A
revoked key keeps working, silently: the header comment's "MUST call evict" guarantee has a race.
Fix: a per-id generation bumped by `evict` and `disposeAll`; a build finishing under an old generation
disposes itself and writes neither `cache` nor `failed`. `.finally` deletes only its own promise.

**H8. An aborted result is memoized, so a retry replays the abort.** `reproduced`.
`client/drivers/request-response.ts:62`. `report()` nulls `lastSent` "so the same values retry", but the
retry hits the memo: `aborted`, `aborted`, one `SolveFn` call. Those inputs stay stuck until a rebuild.
Reachable from a 200 carrying `selva.outcome.aborted`. Compute's `ResponseCache` already refuses this.
Fix: skip `memo.set` when `result.aborted`.

### Medium

**H9. `evict` or LRU kills busy solves and reports a false 504.** `reproduced`.
`server/client-cache.ts:382,402`, `solve-pipeline.ts:194-199`. A config write mid-solve returned 504
"Solve exceeded the 30s deadline." after 2 ms, and the timeout metric counts it. Any abort not from the
caller reads as a deadline. Fix: only `TIMEOUT_ERROR` maps to `timeout`; a bare `ABORTED` gets its own
retryable outcome. See [Decisions](#decisions-that-need-a-human) on draining.

**H10. `dispose` leaves the driver running.** `reproduced`. `solve-session.ts:410-415`. The in-flight
signal stayed unaborted, the queued solve started, and `setValue` after dispose ran a third.
`useSolveSession` disposes on unmount and ComputeApp never cancels, so leaving a page costs a full
solve plus the queued one. Fix: `driver.cancel()` in `dispose`, a disposed flag, and clear the memo.

**H11. A held result outlives newer solves.** `reproduced`. `solve-session.ts:249-257,390-395`, despite
"never a stale one" at `solve-session-core.ts:49-51`. During a newer solve `acknowledge()` commits the
older result and resolves the a=2 `solve()` with `result.values.a === 1`. If the newer solve fails,
phase stays `review`, and acknowledging applies the older result beside the live error:
`['failed','applied']`. Fix: drop the held result in `dispatch`, settling it `discarded`, and clear
`awaitingAck` in `reportError`.

**H12. Host callbacks break "every solve ends in exactly one report".** `reproduced`.
`drivers/request-response.ts:46-50,63-71`, `async-throttle.ts:63,74-75`. A throwing `onSettled` turns a
good solve into a second `failed` settlement. A throwing subscriber, a `meshPolicy.clone` throwing on a
hit, or a `bigint` value leaves `solve()` hung. `onChange` throwing at `setRunning(true)` leaves
`isRunning` true for good. Fix: move `memo.get` and `memo.set` into the `try`, report outside it,
isolate listeners, and put `setRunning(true)` inside the `try`.

**H13. A subscriber starting a solve on `isSolving` falling loses its controller.** `reproduced`.
`async-throttle.ts:53-60,74-75`. `setRunning(false)` calls `onChange` before the controller is nulled,
so `finally` wipes the new run's controller. That run cannot be aborted and has no deadline. Svelte
hosts batch effects and are less exposed. Fix: a local `controller` in the deadline callback, and null
the shared one before `setRunning(false)`, only if it is still this run's.

**H14. One non-200 closes the event stream for good.** `reproduced` with undici `EventSource`.
`client/events/solve-event-stream.ts:58`. "EventSource reconnects on its own" holds for dropped
connections only. A 502 during a deploy stopped it at two hits against a healthy server. `open()` then
no-ops because `source` is non-null, and `currentSolveId` sticks. The tab loses progress and explicit
cancel until reload. The solve itself still works. The comment at selva
`library/[guid]/+page.svelte` ("would retry a 401 forever") is wrong for the same reason. Fix: an
`error` handler that on `CLOSED` drops `source`, clears `currentSolveId` and reopens with backoff.

**H15. An already-aborted signal still pays for a solve.** `reproduced`. `solve-engine.ts:234`.
`addEventListener` never fires for an aborted signal, so a client gone before that line gets
`{ kind: 'ok', computeCalls: 1 }`. Reachable through the auth, DB and handshake awaits ahead of it.
Fix: check `args.signal.aborted` on entry and after `getClient`.

**H16. Omitted `inputs` is a 200 with the wrong answer.** `reproduced`. `packages/server/src/api/bodies.ts:32`
with `solve-pipeline.ts:82`. `POST /definitions/{guid}/solve` without `inputs` defaults to `[]`, drops
every value, and returns the file's defaults. `openapi/v1.yaml` documents that as fine. `inputs: [null]`
throws a raw `TypeError`, returned as a 500 carrying the JS message. H1's fix removes both.

**H17. Compute failures record no metric and throw.** `read-only`. `selva/.../solve.server.ts:389-417`
has no `compute_error` branch, and `engine.solve` throws when the handshake or tree build fails
(`solve-engine.ts:217,220`), though the README says expected failures do not throw. During an outage no
row is written. Fix: return `compute_error` for `getClient` failures and add the branch.

**H18. A 503 with `Retry-After` sets no cooldown.** `reproduced`. `compute-fetch-solve-fn.ts:146`. Five
solves made five POSTs on a 503 and one on a 429. Slider drags hit a saturated server harder at the
moment it asks clients to back off. Fix: read `Retry-After` before branching on status.

**H19. The long-deadline fetch removes every timeout from `/io`.** `reproduced`, 335 s real time, output
read and not rerun. `server/long-fetch.ts:7`, `compute/.../grasshopper-client.ts`. The unlimited fetch is
installed on the client config, and `getIO` and `getRawIO` have no `timeoutMs`. At a 320 s deadline a hung
`/io` was still pending at 335 s, against 301.07 s on the global path. `load-for-render.ts:193` awaits it
on page load. The default deadline is unaffected. The undici fix itself works: 310 s headers and a 310 s
body stall both succeeded. Fix: a ceiling on calls with no signal.

**H20. A redirect `Location` carries secrets into the error.** `reproduced`.
`packages/compute/src/core/compute-fetch/response.ts:148`. A planted
`http://user:PLANTED-PW@evil.example/x?token=PLANTED-TOK` appeared in `message` and `context`, and from
reading, `mapSolveError` sends that to the browser and logs. Fix: `redactUrl` on both. It is compute's,
found through this package's transport.

**H21. Every network failure tells the user to sign in again.** `reproduced`.
`compute-fetch-solve-fn.ts:118,128`. A refused connection reads "Request blocked — your session may have
expired". `reportError` drops the `cause`, so an outage is misreported. `redirectedToLogin` matches only an
exact `/login`, and a non-throwing `onSessionExpired` falls through to "invalid response". Fix: a neutral
message, a configurable login path, and throw after the handler returns.

**H22. Valid-but-wrong JSON and failed downloads escape the guard.** `reproduced`.
`compute-fetch-solve-fn.ts:137,164,174`. A body of `null` gives a raw `TypeError` on both 200 and 500.
`{"message":{}}` gives `[object Object]`. A 200 with `[]` passes as an empty success. A truncated body
throws `TypeError: terminated`. The mid-download abort branch at `:165` is dead: `res.text()` rejects
first, so a direct `SolveFn` caller does not get the documented `{ outputs: {} }`. Fix: `try` around
`res.text()`, require a plain object, accept `d.message` only as a string.

**H23. Concurrent definition loads are not coalesced, and the signal is dropped.** `reproduced`.
`server/definition-byte-cache.ts:102-116`. Eight callers made eight storage reads and held eight copies.
The ref drops the `signal` `materializeDefinition` passes, so a hung store read stays pending after the
solve times out and each retry adds one. Fix: an in-flight map deleted in `finally`, and forward `signal`.

**H24. `onSettled` fires twice on the WebSocket path.** `reproduced`. The WebSocket driver's `report` then
`reportError` settles `applied`, then `failed`, despite "fires once per settled solve". Nothing in
plugin-ui listens today. Fix in plugin-ui: carry the display error as a diagnostic in the outcome.

### Low

- **`SolveEngineLimits` is not validated.** `reproduced`, public API only: `resolveComputeLimits` rejects
  these. `solveDeadlineMs` of 0 or -1 means no deadline; `createDefinitionByteCache(NaN)` retains without
  limit. `solve-engine.ts:152-176`, `definition-byte-cache.ts:62`. Validate in the constructor.
- **Storage throws through session creation.** `reproduced`. `external-storage.ts`: blocked storage makes
  `createSolveSession` throw `SecurityError`; quota throws from `write`. Catch them.
- **`stableInputKey` collisions.** `reproduced`. `Date`s collide because `toJSON` is ignored, unlike
  compute's `stable-hash.ts`; `undefined` collapses to `null` though the wire form differs.
- **`reduceLiveSolve`.** `reproduced`. A late `solveEnded` from solve A wipes B's diagnostics. A progress
  event with no fraction resets the forward-only guard.
- **`Retry-After` parsing.** `reproduced`. An HTTP-date or `0` becomes 5 s, `-30` sets no cooldown,
  `Infinity` locks the solve function permanently.
- **`decodeOutcome({ blocked: true })` with no `diagnostics` unblocks.** `reproduced`. Fail-open, though
  the C# default list makes it unlikely. `blocked: "true"` also reads false.
- **`outcomeFromComputeMessages` does not normalize** as `decodeOutcome`'s doc promises: duplicates and
  `''` survive. Non-string entries throw. `reproduced`.
- **Rejected results still carry the full `source`,** including withheld outputs. `reproduced`.
  `finalizeResult`, `shared/outcome.ts`.
- **A response body in the console.** `reproduced`. The non-JSON `console.warn` at
  `compute-fetch-solve-fn.ts:139` ignores `debug`, despite "gates ALL console telemetry", and logs the
  body. `client-cache.ts:327` logs raw solver text in debug. `read-only`.
- **`onJoin` throwing fails the waiter** and skips `notifyOwner`. `reproduced`.
- **Coalesced callers share one `headers` object** by reference; neither app mutates it. `reproduced`.
- **`solve-engine.ts:6-8` says `@selvajs/server` depends on solve;** `server/src/compute/index.ts:9` says
  it does not. `read-only`.

Tested and clean: cross-tenant cache keys, prototype pollution through wire keys, byte-cache accounting
under LRU and oversized entries, `gzippedBodies` reuse, one module-level dispatcher with no per-call leak,
`Set-Cookie` and `Authorization` staying out of error context, value fidelity of `"true"`, `"null"`,
`"007"` and long digit strings, single copy of `ComputeError`, undici and global fetch classifying
alike.

## Decisions that need a human

1. **Server-owned inputs (H1, H16).** Recommend yes: read `inputs` from the stored schema and accept but
   ignore the body's. It costs a schema read on the solve path and changes `/api/v1` semantics; the
   OpenAPI field becomes deprecated.
2. **Public API cuts before pre exit.** Recommend taking simplifications 3, 4, 7, 8, 9, 10 in the 2.0
   window. After pre exit each is another major.
3. **What `evict` does to running solves (H9).** Recommend draining: remove the entry and dispose when
   idle. A config write then leaves running solves on old credentials until they finish, which matters
   for a revoked key. Abort instead if revocation must be immediate.
4. **Held result on a newer solve (H11).** Recommend dropping it at dispatch, which also settles the
   review's open question about a user cancel: nothing is left to keep.
5. **Spaced slider moves exceed the rate limit.** `drag-rate.test.ts` documents a known overrun at about
   6 moves a second with fast solves. Recommend a real session-level test, then delete the copy, then
   decide whether the client should pace or the limit should rise.
6. **Memoizing errored results.** `solve-memo.test.ts:87` pins this as deliberate; the server cache skips
   them by default. Recommend keeping it: an error is deterministic for the same inputs, an abort is not.
7. **`X-Selva-Definition`.** Nothing reads it. Recommend correcting the comments and ADR 0004 now, and
   removing the parameter unless a router is planned.

## Appendix: repro scripts

Run with Node 24 after `pnpm build` in `packages/solve`, from a folder in that package holding the
harness and the script. The output in each finding is what a fix must change.

**Client harness** (`h.mjs`)

```text
export * from '../dist/client.js';
import { createSolveSession, createRequestResponseDriver } from '../dist/client.js';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const schema = (x = {}) => ({ inputs: [{ id: 'a', paramType: 'number', default: 0 }], outputs: [{ id: 'o' }], ...x });
export const race = (p, ms = 150) => Promise.race([p, sleep(ms).then(() => 'HUNG')]);
for (const k of ['info', 'debug', 'warn']) console[k] = () => {};
export function make(onSolve, { deadline = 60000, sch = schema(), ...o } = {}) {
  let s; const driver = createRequestResponseDriver(onSolve, () => s, { solveDeadlineMs: deadline, onChange: () => s?.notify(), ...o });
  s = createSolveSession({ schema: sch, scopeKey: 'k', driver }); return { s, driver };
}
export const deferred = () => { const log = []; const fn = (v, sig) => new Promise((res, rej) => { log.push({ v, sig, res, rej }); sig.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))); }); fn.log = log; return fn; };
```

**Server stub** (`stub.mjs`)

```text
// Stub Rhino.Compute over real HTTP. `hold` pauses /grasshopper until release(); records aborts.
import http from 'node:http';
export const SERVER = '../dist/server.js';
export const limits = { solveDeadlineMs: 30000, computeResponseMaxBytes: 1e8, computeReuseDefinitionCache: false,
  computeServerCachesolve: false, computeMaxQueueDepth: 0, computeQueueWaitMs: 0,
  computeDefinitionCacheBytes: 1e8, computeSolveCacheBytes: 0 };
export async function stub(opts = {}) {
  const s = { solves: 0, closed: 0, headers: [], keys: [], waiting: [], hold: opts.hold ?? false, rootDelay: opts.rootDelay ?? 0 };
  s.release = () => { for (const f of s.waiting.splice(0)) f(); };
  const body = opts.body ?? { values: [{ ParamName: 'o', InnerTree: { '{0}': [{ data: 'x'.repeat(2000) }] } }] };
  const srv = http.createServer((req, res) => {
    s.keys.push(req.headers['rhinocomputekey'] ?? req.headers['x-api-key'] ?? req.headers['authorization']);
    if (req.method === 'GET') {
      if (req.url === '/' ) return void setTimeout(() => res.end('ok'), s.rootDelay);
      if (req.url.startsWith('/activechildren')) return void res.end('4');
      return void res.end('{}');
    }
    let n = 0; req.on('data', (d) => (n += d.length));
    req.on('end', () => {
      s.solves++; s.headers.push(req.headers['x-selva-definition']);
      res.on('close', () => { if (!res.writableFinished) s.closed++; });
      const send = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
      s.hold ? s.waiting.push(send) : send();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  s.url = `http://127.0.0.1:${srv.address().port}`;
  s.close = () => { srv.closeAllConnections(); srv.close(); };
  return s;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const inputs = [{ id: 'a', nickname: 'A', paramType: 'Number' }];
export const def = { versionId: 'v1', load: async () => new Uint8Array([1, 2, 3]) };
```

**Transport harness** (`lib.mjs`)

```text
import { createServer } from 'node:http';
export const SOLVE = '../dist';
export const COMPUTE = '../../compute/dist';
export async function serve(handler) {
  const sockets = new Set();
  const seen = [];
  const s = createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => { seen.push({ m: req.method, u: req.url, h: req.headers }); handler(req, res, b); });
  });
  s.on('connection', c => { sockets.add(c); c.on('close', () => sockets.delete(c)); });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${s.address().port}`, seen, sockets, s, close() { for (const c of sockets) c.destroy(); s.close(); } };
}
/** Answers the liveness and children probes; hands POSTs to `post`. */
export const compute = (post, children = '2') => serve((req, res, b) => {
  if (req.method === 'GET' && req.url === '/') return res.end('compute.rhino3d running');
  if (req.url.startsWith('/activechildren')) return res.end(children);
  post(req, res, b);
});
export const t0 = () => { const s = performance.now(); return () => ((performance.now() - s) / 1000).toFixed(2) + 's'; };
```

**H1** (`08-forged-inputs.mjs`)

```text
// `inputs` comes off the request body in both apps. Host filled {ctx: real}; the request forges a slot.
import { SERVER } from './stub.mjs';
const { buildSolveInputTree } = await import(SERVER);
const show = (t) => JSON.stringify(t.map((x) => [x.ParamName, x.InnerTree['{0}'].map((i) => i.data)]));
const real = { id: 'ctx', nickname: 'host-context', paramType: 'Text' };
const hostFilled = { ctx: 'REAL-CONTEXT', evil: 'FORGED-CONTEXT' };          // { ...args.values, ...reserved.values }
console.log('reserved slot honest :', show(buildSolveInputTree([real], hostFilled)));
console.log('reserved slot forged :', show(buildSolveInputTree([{ id: 'evil', nickname: 'host-context', paramType: 'Text' }], hostFilled)));
const slider = (bounds) => ({ id: 'w', nickname: 'Width', paramType: 'Number', ...bounds });
console.log('schema max 100       :', show(buildSolveInputTree([slider({ maximum: 100 })], { w: 1e9 })));
console.log('request drops max    :', show(buildSolveInputTree([slider({})], { w: 1e9 })));
console.log('omitted inputs (/solve default []):', show(buildSolveInputTree([], { w: 5 })));
for (const bad of [[null], [{ paramType: 5 }]]) { try { buildSolveInputTree(bad, {}); } catch (e) { console.log('malformed', JSON.stringify(bad), '->', e.constructor.name, e.message); } }
console.log('inherited id         :', buildSolveInputTree([{ id: 'constructor', nickname: 'x', paramType: 'Text', default: 'd' }], {}));
console.log('__proto__ id, default:', JSON.stringify(buildSolveInputTree([{ id: '__proto__', nickname: 'x', paramType: 'Text', default: 'd' }], {})));
const before = ({}).polluted;
buildSolveInputTree([{ id: 'p', nickname: '__proto__', paramType: 'Text' }], JSON.parse('{"p":{"__proto__":{"polluted":1}}}'));
buildSolveInputTree([{ id: 'p', nickname: 'x', paramType: 'Text' }], JSON.parse('{"p":{"{0}":[{"__proto__":{"polluted":1}}]}}'));
console.log('prototype polluted   :', ({}).polluted !== before);
```

**H2** (`r01-hang.mjs`)

```text
import { make, sleep, race } from './h.mjs';
const calls = []; const never = (v) => { calls.push(v); return new Promise(() => {}); };
const { s } = make(never, { deadline: 50 });
const p = s.solve(); await sleep(120);
console.log('after deadline:', await race(p), 'isSolving', s.isSolving, 'error', JSON.stringify(s.error));
s.abort(); await sleep(20); console.log('after abort isSolving', s.isSolving, await race(p));
s.setValue('a', 2); await sleep(120); console.log('calls', calls.length, 'phase', s.phase);
```

**H3** (`r04-rebuild.mjs`)

```text
import { make, sleep, deferred, schema } from './h.mjs';
{ const f = deferred(); const { s } = make(f); const seen = []; s.onSettled((x) => seen.push(x.status));
  s.setValue('a', 1); await sleep(1);
  s.rebuild({ inputs: [{ id: 'b', paramType: 'number', default: 0 }], outputs: [{ id: 'p' }], instanceSolve: false }, 'k2');
  f.log[0].res({ outputs: { o: 'OLD-DEF' }, meshes: ['OLD-MESH'] }); await sleep(5);
  console.log('manual rebuild: meshes', s.meshes, 'values.o', s.values.o, 'neverSolved', s.hasNeverSolved, 'dirty', s.hasPendingChanges, 'lastResult.values', s.lastResult?.values, 'settled', seen, 'fetch aborted', f.log[0].sig.aborted); }
{ const f = deferred(); const { s } = make(f);
  s.setValue('a', 1); await sleep(1);
  s.rebuild(schema({ id: 'v2' }), 'k'); s.setValue('a', 1); await sleep(1);
  f.log[0].res({ outputs: { o: 'v1-result' } }); await sleep(5);
  console.log('v2 inputs equal v1: solveFn calls', f.log.length, 'isSolving', s.isSolving, 'values.o', s.values.o); }
```

**H4** (`r02-ensure.mjs`)

```text
import { make, sleep, deferred } from './h.mjs';
{ const f = deferred(); const { s } = make(f);
  s.setValue('a', 1); f.log[0].res({ outputs: { o: 'for1' } }); await sleep(5);
  s.setValue('a', 2); await sleep(5); s.abort(); await sleep(5);
  const r = await s.ensureSolved();
  console.log('abort: values.a', s.values.a, 'ensureSolved', r.status, 'result.values.a', r.result?.values?.a, 'solves', f.log.length); }
{ const f = deferred(); const { s } = make(f);
  s.setValue('a', 1); f.log[0].res({ outputs: { o: 'for1' } }); await sleep(5);
  s.setValue('a', 2); await sleep(1); f.log[1].res({ outputs: { o: 'for2' }, diagnostics: [{ level: 'warning', message: 'w', isGate: true }] }); await sleep(5);
  s.discard(); const r = await s.ensureSolved();
  console.log('discard: values.a', s.values.a, 'ensureSolved', r.status, 'result.values.a', r.result?.values?.a, 'solves', f.log.length); }
```

**H5** (`r03-manual.mjs`)

```text
import { make, sleep, deferred, schema } from './h.mjs';
const f = deferred(); const { s } = make(f, { sch: schema({ instanceSolve: false }) });
s.setValue('a', 1); s.solve(); await sleep(1);
s.setValue('a', 2); console.log('during: dirty', s.hasPendingChanges);
f.log[0].res({ outputs: { o: 'for1' } }); await sleep(5);
const r = await s.ensureSolved();
console.log('after: values.a', s.values.a, 'dirty', s.hasPendingChanges, 'lastResult.values.a', s.lastResult.values.a, 'ensureSolved', r.status, r.result?.values?.a, 'solves', f.log.length);
```

**H6, both gone** (`02-all-gone.mjs`)

```text
// Leader + waiter both abort. Does the upstream solve get cancelled? Does the waiter return?
import { stub, SERVER, limits, inputs, def, sleep } from './stub.mjs';
const { SolveEngine } = await import(SERVER);
const s = await stub({ hold: true }); const engine = new SolveEngine({ limits });
const server = { id: 's', serverUrl: s.url };
const args = { server, definitionSource: def, inputs, values: { a: 1 } };
const a = new AbortController(), b = new AbortController();
let bDone = false;
const p1 = engine.solve({ ...args, signal: a.signal });
await sleep(100);
const p2 = engine.solve({ ...args, signal: b.signal }).finally(() => (bDone = true));
await sleep(50);
b.abort(); a.abort();
await sleep(500);
console.log({ afterBothAbort: { upstreamCancelled: s.closed, waiterSettled: bDone, inFlight: engine.stats().coalescing.inFlight } });
s.release(); console.log((await p1).kind, (await p2).kind); s.close(); process.exit(0);
```

**H6, joining a dying flight** (`03-join-dying-flight.mjs`)

```text
// Waiter joins in the gap between the leader's abort and the flight settling: live client gets client_abort.
import { stub, SERVER, limits, inputs, def, sleep } from './stub.mjs';
const { SolveEngine } = await import(SERVER);
const s = await stub({ hold: true }); const engine = new SolveEngine({ limits });
const server = { id: 's', serverUrl: s.url };
const args = { server, definitionSource: def, inputs, values: { a: 1 } };
const a = new AbortController();
const p1 = engine.solve({ ...args, signal: a.signal });
await sleep(100);
a.abort();
const p2 = engine.solve({ ...args, signal: new AbortController().signal }); // same tick, never aborted
console.log({ leader: (await p1).kind, liveWaiter: (await p2).kind }); s.close(); process.exit(0);
```

**H7** (`04-evict-pending-build.mjs`)

```text
// evict() during a build: the old URL/key is installed anyway and survives every later solve.
import { stub, SERVER, limits, inputs, def, sleep } from './stub.mjs';
const { SolveEngine } = await import(SERVER);
const old = await stub({ rootDelay: 200 }), rotated = await stub();
const engine = new SolveEngine({ limits });
const sig = new AbortController().signal, args = { definitionSource: def, inputs, signal: sig };
const p = engine.solve({ ...args, server: { id: 's', serverUrl: old.url, apiKey: 'OLD' }, values: { a: 1 } });
await sleep(50);
engine.evictServer('s'); // config-write path: rotation
await p;
await engine.solve({ ...args, server: { id: 's', serverUrl: rotated.url, apiKey: 'NEW' }, values: { a: 2 } });
console.log({ oldServerSolves: old.solves, rotatedServerSolves: rotated.solves, keySeenByOld: old.keys.at(-1) });
old.close(); rotated.close(); process.exit(0);
```

**H8** (`r05-memo-abort.mjs`)

```text
import { make, sleep, schema, finalizeResult } from './h.mjs';
let n = 0;
const fn = async () => { n++; return n === 1 ? finalizeResult({ outputs: {} }, { diagnostics: [], blocked: true, aborted: true }) : { outputs: { o: 'real' } }; };
const { s } = make(fn);
console.log('1st', (await s.solve()).status);
console.log('retry', (await s.solve()).status, 'solveFn calls', n, 'values.o', s.values.o, 'phase', s.phase);
```

**H9** (`05-evict-inflight.mjs`)

```text
// Operator rotates config during a running solve: reported as a deadline that never elapsed.
import { stub, SERVER, limits, inputs, def, sleep } from './stub.mjs';
const { SolveEngine } = await import(SERVER);
const s = await stub({ hold: true }); const engine = new SolveEngine({ limits });
const p = engine.solve({ server: { id: 's', serverUrl: s.url }, definitionSource: def, inputs, values: { a: 1 }, signal: new AbortController().signal });
await sleep(100);
const t0 = performance.now(); engine.evictServer('s');
const o = await p;
console.log({ kind: o.kind, message: o.message, ranForMs: Math.round(performance.now() - t0), status: engine.toResponse(o).status }); s.close(); process.exit(0);
```

**H10** (`r06-dispose.mjs`)

```text
import { make, sleep, deferred } from './h.mjs';
const f = deferred(); const { s } = make(f);
s.setValue('a', 1); s.setValue('a', 2); await sleep(1);
s.dispose(); console.log('after dispose: inflight aborted', f.log[0].sig.aborted, 'isSolving', s.isSolving, 'queued', s.isSolving);
f.log[0].res({ outputs: {} }); await sleep(5);
console.log('solves started after dispose (trailing):', f.log.length - 1, 'with', f.log[1]?.v);
s.setValue('a', 3); await sleep(1); f.log[1].res({ outputs: {} }); await sleep(5);
console.log('setValue after dispose ran solve:', f.log.length);
```

**H11** (`r13-held.mjs`)

```text
import { make, sleep, deferred } from './h.mjs';
const gate = [{ level: 'warning', message: 'w', isGate: true }];
{ const f = deferred(); const { s } = make(f);
  s.setValue('a', 1); await sleep(1); f.log[0].res({ outputs: { o: 'for1' }, diagnostics: gate }); await sleep(5);
  const p = (s.setValue('a', 2), s.solve()); await sleep(1); console.log('phase', s.phase, 'awaitingAck', s.awaitingAck);
  s.acknowledge(); const r = await p; console.log('solve() for a=2 resolved with result.values.a', r.result?.values?.a, 'while isSolving', s.isSolving); }
{ const f = deferred(); const { s } = make(f); const seen = []; s.onSettled((x) => seen.push(x.status));
  s.setValue('a', 1); await sleep(1); f.log[0].res({ outputs: { o: 'for1' }, diagnostics: gate }); await sleep(5);
  s.setValue('a', 2); await sleep(1); f.log[1].rej(new Error('net')); await sleep(5);
  console.log('after failed newer solve: phase', s.phase, 'error', s.error, 'values.a', s.values.a, 'seen', seen);
  s.acknowledge(); console.log('ack: values.o', s.values.o, 'lastResult.a', s.lastResult.values.a, 'error', s.error, 'seen', seen); }
```

**H12** (`r07-throw.mjs`)

```text
import { make, sleep, race, deferred, createAsyncThrottle } from './h.mjs';
console.error = () => {}; process.on('unhandledRejection', (e) => console.log('unhandledRejection:', e.message));
{ const { s } = make(async () => ({ outputs: { o: 1 } })); const seen = [];
  s.onSettled((x) => { seen.push(x.status); if (seen.length === 1) throw new Error('host onSolved bug'); });
  const r = await s.solve(); await sleep(5);
  console.log('settled listener throws: promise', r.status, 'listener saw', seen, 'session.error', JSON.stringify(s.error), 'meshes ok, lastResult', !!s.lastResult); }
{ const { s } = make(async () => ({ outputs: { o: 1 } }));
  let armed = false; const un = s.subscribe(() => { if (armed) throw new Error('render bug'); });
  const p = s.solve(); armed = true;
  console.log('subscriber throws: solve()', await race(p, 100), 'isSolving', s.isSolving); }
{ let n = 0; const t = createAsyncThrottle(async () => {}, { runDeadlineMs: 1e4, onChange() { if (++n === 1) throw new Error('onChange bug'); } });
  t.trigger(1); await sleep(5); console.log('onChange throws once on start: isRunning', t.isRunning); let ran = 0;
  t.trigger(2); await sleep(5); console.log('hasPending', t.hasPending); process.exit(0); }
```

**H13** (`r08-reentrant.mjs`)

```text
import { make, sleep, race, deferred } from './h.mjs';
const f = deferred(); const { s } = make(f, { deadline: 60 }); let once = true;
s.subscribe(() => { if (!s.isSolving && s.lastResult && once) { once = false; s.setValue('a', 2); } });
s.setValue('a', 1); await sleep(1); f.log[0].res({ outputs: {} }); await sleep(5);
console.log('second run live, isSolving', s.isSolving, 'signal aborted', f.log[1].sig.aborted);
s.abort(); await sleep(5); console.log('abort(): signal aborted', f.log[1].sig.aborted, 'isSolving', s.isSolving);
await sleep(120); console.log('past deadline: signal aborted', f.log[1].sig.aborted, 'isSolving', s.isSolving, 'error', JSON.stringify(s.error));
```

**H14** (`r11-sse.mjs`)

```text
// run: node --experimental-eventsource r11-sse.mjs
import http from 'node:http';
import { createSolveEventStream, sleep } from './h.mjs';
let hits = 0;
const srv = http.createServer((req, res) => { hits++;
  if (hits === 1) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('retry: 20\n\nevent: solve\ndata: {"type":"solveStarted","solveId":"S","seq":1}\n\n'); setTimeout(() => res.destroy(), 30); return; }
  if (hits === 2) { res.writeHead(502); res.end('bad gateway'); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: solve\ndata: {"type":"solveStarted","solveId":"T","seq":1}\n\n'); });
await new Promise((r) => srv.listen(0, r)); const url = `http://127.0.0.1:${srv.address().port}/e`;
const st = createSolveEventStream({ endpoint: url, cancelEndpoint: (i) => url + i }); const un = st.subscribe(() => {});
await sleep(600); console.log('hits', hits, 'currentSolveId', st.currentSolveId, '(server is healthy again on hit 3)');
st.subscribe(() => {}); await sleep(300); console.log('after new subscribe hits', hits); st.close(); srv.close(); process.exit(0);
```

**H15** (`01-already-aborted.mjs`)

```text
// An already-aborted caller signal: does engine.solve still run the compute call?
import { stub, SERVER, limits, inputs, def, sleep } from './stub.mjs';
const { SolveEngine } = await import(SERVER);
const s = await stub(); const engine = new SolveEngine({ limits });
const server = { id: 's', serverUrl: s.url };
const c = new AbortController(); c.abort();
const o = await engine.solve({ server, definitionSource: def, inputs, values: { a: 1 }, signal: c.signal });
console.log({ kind: o.kind, computeCalls: s.solves }); s.close(); process.exit(0);
```

**H18** (`shed.mjs`)

```text
// A 503 + Retry-After (the `shed` outcome) sets no cooldown; a 429 does.
import { SOLVE, serve } from './lib.mjs';
const { createComputeFetchSolveFn } = await import(`${SOLVE}/client.js`);
let posts = 0, status = 503;
const s = await serve((q, r) => { posts++; r.writeHead(status, { 'content-type': 'application/json', 'retry-after': '30' }); r.end('{"message":"Compute server is at capacity. Retry shortly.","retryAfter":30}'); });
const f = () => createComputeFetchSolveFn({ endpoint: s.url, definitionUrl: () => 'x', inputs: () => [], outputs: () => [] });
for (status of [503, 429]) { posts = 0; const fn = f(); for (let i = 0; i < 5; i++) await fn({}, new AbortController().signal).catch(() => {}); console.log(status, 'with Retry-After 30: 5 solves ->', posts, 'POSTs'); }
process.exit(0);
```

**H19** (`long-fetch-300.mjs`)

```text
// Real elapsed time past undici's 300s. Takes ~5.5 minutes.
import { SOLVE, compute, t0 } from './lib.mjs';
const { createClientCache } = await import(`${SOLVE}/server.js`);
const srv = await compute((q, r, b) => {
  const J = { 'content-type': 'application/json' };
  if (q.url.includes('hang')) return;
  if (q.url.endsWith('/io')) return; // hung server: the IO call never answers
  if (b.includes('Ym9keQ')) { r.writeHead(200, J); r.write('{"values":'); return setTimeout(() => r.end('[]}'), 310_000); }
  setTimeout(() => { r.writeHead(200, J); r.end('{"values":[]}'); }, 310_000);
});
const mk = (ms) => createClientCache({ solveDeadlineMs: ms, cachesolve: false, reuseServerDefinitionCache: false, maxQueueDepth: 0, queueWaitMs: 0, responseCacheMaxBytes: 0, debug: false });
const long = await mk(320_000).getClient({ id: 'l', serverUrl: srv.url });
const short = await mk(100_000).getClient({ id: 's', serverUrl: srv.url });
const longBody = await mk(320_000).getClient({ id: 'b', serverUrl: srv.url });
const e = t0();
const say = (l) => (v) => console.log(l, e(), v?.code ?? '', v?.message?.slice(0, 100) ?? JSON.stringify(v));
long.scheduler.solve('aGVsbG8=', []).then(say('A long deadline, headers at 310s, solved:'), say('A FAILED:'));
longBody.scheduler.solve('Ym9keQ==', []).then(say('B long deadline, body stall 310s:'), say('B FAILED:'));
short.client.solve('aGVsbG8=', [], { timeoutMs: 330_000 }).then(say('C global fetch, timeoutMs 330s:'), say('C failed:'));
short.client.getIO('aGVsbG8=').then(say('D getIO, global path:'), say('D getIO global failed:'));
long.client.getIO('aGVsbG8=').then(say('E getIO, undici path:'), say('E getIO undici failed:'));
setTimeout(() => { console.log('END at', e(), '— lines missing above are still pending'); process.exit(0); }, 335_000);
```

**H23** (`07-byte-cache.mjs`)

```text
// Concurrent misses, and non-finite budgets.
import { SERVER } from './stub.mjs';
const { createDefinitionByteCache } = await import(SERVER);
const c = createDefinitionByteCache(1e6); let loads = 0;
const load = async () => { loads++; await new Promise((r) => setTimeout(r, 20)); return new Uint8Array(1000); };
await Promise.all(Array.from({ length: 8 }, () => c.getOrLoad('v', load).load()));
console.log({ concurrentLoadsForOneVersion: loads, stats: c.stats() });
for (const budget of [NaN, Infinity]) {
  const n = createDefinitionByteCache(budget);
  for (let i = 0; i < 50; i++) await n.getOrLoad('v' + i, async () => new Uint8Array(1e6)).load();
  console.log({ budget, retained: n.stats().bytes, evictions: n.stats().evictions });
}
let got; const r = createDefinitionByteCache(1e6).getOrLoad('v', async (sig) => { got = sig; return new Uint8Array(1); });
await r.load(AbortSignal.timeout(1000)); console.log({ loaderReceivedSignal: got !== undefined }); process.exit(0);
```

H16 runs in the H1 script. H20 to H22 and the Low items came from longer multi-case scripts: each case is
a `node:http` handler returning the response named in the finding, against
`createComputeFetchSolveFn` or `new SolveEngine`.
