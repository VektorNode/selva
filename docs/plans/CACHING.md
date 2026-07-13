# Solve Caching — Scaling Findings & Plan

Investigation of the solve caching story (2026-07-11), spanning `@selvajs/compute`
(this repo — scheduler, hashing, cache-key reuse) and its consumer
`@selvajs/selva` (the cloud app — `/api/compute`, client cache, provider stores).
Driver: **evaluate where better caching helps at 1000+ users**, plus two feature
asks — a solution cache that lives longer than the current 5-min in-process one,
and a downloadable "pre-solved" definition format.

Categories: **cache** (caching layer), **perf** (throughput/latency), **correctness**
(collision/poisoning risk), **feature** (new capability), **seam** (missing
extension point). ~~Nothing here is fixed yet.~~ **See the status dashboard
below — everything owned by the package has shipped and is committed on
`selva-compute@beta` awaiting release; everything still open lives in the
`selva` repo and is planned in the
[Selva-side implementation plan](#selva-side-implementation-plan-2026-07-13).**

> **Note (2026-07-13):** `selva-compute`'s own `CACHING.md`/`ACTION_PLAN.md`/
> `ISSUES.md` were deleted after the work landed — **this file is now the single
> living tracker** for the caching effort. Package facts below were re-verified
> against `selva-compute@beta` HEAD on 2026-07-13.

## Status dashboard (updated 2026-07-13)

Every work item in this file, split by owning repo. Findings are detailed in
their own sections below (historical `ISSUES.md` numbers kept for reference).

**`@selvajs/compute` — all package work COMMITTED on `beta`, changeset added
(`long-cats-wish`, minor), release pending:**

| Item                                 | Status                        | Where                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DefinitionRef package seam (M1 half) | ✅ DONE                       | `definition-ref.ts`; identity keying, lazy `load()`, 6 pinned tests; re-exported from top barrel                                                                                      |
| M3 — strip `algo`                    | ✅ DONE                       | stripped at the source in `runSolve` + regression test (ISSUES 58) — persist-path strip moot                                                                                          |
| R1 — sampled `Uint8Array` hashing    | ✅ FIXED                      | full-content `fnv1aBytes` in the tree path (ISSUES 56)                                                                                                                                |
| R2 — errored-solve caching flag      | ✅ DONE                       | `CacheOptions.cacheErroredSolves`, default `true` per decision (ISSUES 114)                                                                                                           |
| R3 — dead queued solves (pkg half)   | ✅ FIXED                      | queued-phase abort listener settles ABORTED + prunes queue (ISSUES 46)                                                                                                                |
| R11 — shared mutable cache hits      | ✅ DONE                       | immutability contract documented on `solve()` (ISSUES 116)                                                                                                                            |
| R12 — stringify edge collisions      | ✅ FIXED                      | `[undefined]`/sparse arrays now distinct (ISSUES 53); `NaN→null` matches the wire, kept                                                                                               |
| R7 — double definition hash          | ✅ DONE (for refs)            | hash-once memo threaded through the scheduler (ISSUES 57); `DefinitionRef` skips hashing entirely                                                                                     |
| H2 — durable keying export           | ✅ DONE (revised)             | `stableStringify`/`hashDefinition`/`hashSolveInput` exported for key parity; app hashes SHA-256 over the canonical string (open question 3 resolved: hash app-side)                   |
| R5 — queue bounds (pkg half)         | ✅ DONE (2026-07-13)          | `maxQueueDepth` + `queueWaitMs` on `SolveSchedulerOptions`; sheds with `QUEUE_FULL`/`QUEUE_TIMEOUT` (`statusCode: 503`), tested                                                       |
| Per-request timing correlation       | ✅ DONE (partial)             | `onServerTiming(timing, requestId)` — requestId = `X-Request-ID`; scheduler does not yet surface which requestId belongs to which `solve()`, so the app's seq-guard attribution stays |
| H3 — in-scheduler cache seam         | ⏸ DEFERRED by design          | H1 lives app-layer (amendment 3); revisit only if the durable cache moves in-package                                                                                                  |
| R4 — single-flight (pkg half)        | ⏸ CLOSED by design            | coalescing belongs app-side next to the L2 lookup (amendment 4), not in the scheduler                                                                                                 |
| R9/K6 — per-solve cache overrides    | ⬜ NOT DONE (small follow-up) | no per-solve `skipCache` / `cachesolve` override on `scheduler.solve()` — see Phase 3 note; H1 works without it (accepting L1 double-store for live solves)                           |

**`selva` / `@selvajs/server` (app repo) — see the
[implementation plan](#selva-side-implementation-plan-2026-07-13) for sequencing:**

| Item                                  | Status                  | Notes                                                                                                                                                                                             |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 — durable L2 solve cache           | ⬜ TODO, design decided | one-cache-per-channel, per-definition quota, gzipped envelopes (R6), orgId key                                                                                                                    |
| Definition-byte cache (M1 app half)   | ✅ DONE (2026-07-13)    | `definition-byte-cache.ts` byte-budget LRU keyed on version id; wired as `DefinitionRef` in the solve route; `def_bytes` Server-Timing verdict; `COMPUTE_DEFINITION_BYTE_CACHE_MB` (0 disables)   |
| Monotonic version numbers             | ✅ DONE (2026-07-13)    | `nextVersionNumber` counter on the record + atomic `reserveNextVersionNumber` (both providers, Supabase RPC/migration, conformance); `uploadVersion` no longer reuses numbers after delete-latest |
| R4 — single-flight map                | ⬜ TODO, decided        | `Map<inputKey, Promise>` next to the L2 lookup                                                                                                                                                    |
| M2 — client-side result memo          | ⬜ TODO                 | small LRU in `createSolveSession`                                                                                                                                                                 |
| R2 — misleading "never cached" log    | ⬜ TODO                 | fix wording in `client-cache.ts` onSettle debug lines                                                                                                                                             |
| R3 — wire disconnect signals (verify) | ⬜ TODO                 | confirm the route passes request-abort signals so the package fix actually bites                                                                                                                  |
| R5 — concurrency + load shedding      | ✅ DONE (2026-07-13)    | `COMPUTE_MAX_CONCURRENT` (B6) + queue cap / queue-wait deadline / 503-shed (B7) all shipped; both queue knobs default `0`=unbounded. R4 single-flight rides with Phase 3 (L2)                     |
| R8 — config folded into durable key   | ⬜ TODO                 | modelunits/tolerances/`COMPUTE_CONTRACT_VERSION` in the H1 key                                                                                                                                    |
| R9 — `solveCacheLimit` on definition  | ⬜ TODO, shape decided  | one number: absent = inherit, 0 = off, N = quota                                                                                                                                                  |
| R10 — per-request definition header   | ⬜ TODO (future)        | before any affinity routing ships                                                                                                                                                                 |
| F1 — pre-solved bundle (+ prewarm)    | ⬜ TODO                 | after H1; R13's post-transform keying applies here                                                                                                                                                |

**Related trackers:**

- Selva pre-scale audit: `selva/docs/plans/data-access-efficiency-audit.md` — its
  "Not yet audited" section explicitly scopes `@selvajs/compute` OUT and flags it
  as the unaudited core; this file is that follow-up for the caching surface. Its
  B1 (Rhino.Compute saturation) and LB (definition-affinity routing) sections are
  the load context these findings sit inside.
- `selva-compute/CONTEXT.md` L29–42 (the three existing caches) and L92–97 (the
  fixed binary-definition collision bug that drove full-content `hashDefinition` —
  directly relevant to finding C1 below).

---

## Selva-side implementation plan (2026-07-13)

Everything the app repo needs to do now that the `@selvajs/compute` package work
is committed (release pending). Phases are ordered by dependency and payoff;
0–2 are small and independently shippable, 3 is the structural win, 4–5 follow.
Work each phase's checkboxes top to bottom; statuses: `☐ open` / `▶ in
progress` / `✅ done`.

**New package surface this plan consumes** (all in the pending minor release):
`DefinitionRef`/`SolveDefinition`/`isDefinitionRef`, `maxQueueDepth` +
`queueWaitMs` scheduler options with `QUEUE_FULL`/`QUEUE_TIMEOUT` error codes
(`statusCode: 503`), exported `stableStringify`/`hashDefinition`/
`hashSolveInput`, `onServerTiming(timing, requestId)`, and
`CacheOptions.cacheErroredSolves`.

### Phase 0 — adopt the release — ✅ DONE (2026-07-13, `@selvajs/compute@3.1.0-beta.5`)

- ✅ **0.1** Catalog bumped to `^3.1.0-beta.5` + installed; full workspace
  `pnpm build` (11 tasks), `pnpm check` (0 errors), server suite 199 green,
  selva app suite 198 green.
- ✅ **0.2** `onServerTiming` compatibility confirmed (narrower callback
  type-checks against the widened `(timing, requestId)` signature).
- **Adoption fallout found & fixed (beta.5 changed `processInput` semantics):**
  1. **ValueList defaults were silently dropped** — beta.5's `valueListParser`
     fallback discards a default it can't validate against a `values` map, and
     `SchemaInput` never carries the option map, so every app value-list /
     dynamicValueList selection stopped reaching Grasshopper (TreeBuilder
     filters inputs with no default). Fixed in `transform-input.ts`: the
     existing dropped-default restoration now also restores scalar ValueList
     defaults (scoped to ValueList only — other types' dropped defaults are
     package-rejected garbage and must stay dropped).
  2. **Integer `stepSize` is no longer forced to 1** — beta.5 honors a
     server-authored stepSize verbatim (heuristic is fallback-only). Intended
     package contract change; app test re-pinned to the new behavior + a new
     test pins the no-authored-stepSize fallback.

### Phase 1 — definition-byte path (DC / M1 app half) — ✅ DONE (2026-07-13)

Landed: byte-budget LRU keyed on immutable version id (`definition-byte-cache.ts`),
wired as a `DefinitionRef` in the solve route so pointer-known solves move zero
bytes; `def_bytes;desc=hit|miss|skipped` Server-Timing verdict; monotonic
`nextVersionNumber` root-cause fix across both providers + Supabase migration
(`EXPECTED_MIGRATION_HEAD` → `20260713120000`). Full build + svelte-check + server
(214) + app (198) + provider conformance suites green. Per-item notes below.

- ✅ **1.1** Byte-cache module in `@selvajs/server/compute`
  (`definition-byte-cache.ts`): `versionId → Uint8Array`, LRU evicted by
  **total byte budget** (definitions are multi-MB — not entry count), no TTL
  (version ids are immutable), `getOrLoad(versionId, load)` returning a
  `DefinitionRef`-compatible loader, hit/miss counters exposed. Env knob
  `COMPUTE_DEFINITION_BYTE_CACHE_MB` (0 disables) in `resolveComputeLimits`.
- ✅ **1.2** Solve route replaces the eager `storage.get(version.fileKey)`
  (`api/compute/+server.ts` local-definition branch) with a
  `DefinitionRef { key: version.id, load: () => storage.get(version.fileKey) }`
  from `definitionRef(version.id, …)` (app-side `definitionByteCache.server.ts`),
  passed into `runSolvePipeline` (whose `definitionSource` now widens to
  `SolveDefinition`). Pointer-known solves move ZERO bytes; a missing blob now
  surfaces at solve time (compute_error) instead of an upfront 404, and the
  schema-backfill bridge materializes via `ref.load()` (warming the entry).
- ✅ **1.3** Server-Timing verdict `def_bytes;desc=hit|miss|skipped` emitted next
  to `selva_cache`/`def_reupload` via a per-ref `ByteRefOutcome` the pipeline
  reads after the solve. (`skipped` = byte-less pointer solve — `load()` never
  called.) 4 pinned pipeline tests.
- ✅ **1.4** Verified there is NO separate server-side render/getIO byte path:
  the library page renders from the cached `version.schema`, and upload-time
  schema extraction runs on in-hand bytes (no version id yet, correctly NOT
  cached). The solve route was the sole `storage.get(version.fileKey)` consumer
  and now goes through the byte cache — so this item is covered by 1.2, not a
  second wiring site. (`loadDefinitionBytes` helper exists for a future path.)
- ✅ **1.5** Monotonic version numbers (root-cause fileKey fix): `nextVersionNumber`
  counter on the definition record + atomic `reserveNextVersionNumber` on
  `IDefinitionStore` (local: config-lock-serialized read+bump with a legacy
  max()-seed fallback; Supabase: SECURITY DEFINER `reserve_next_version_number`
  RPC returning the pre-bump value). `DefinitionService.uploadVersion` reserves
  instead of `max(existing)+1`; `create` seeds the counter at 2.
  Migration `20260713120000_selva_next_version_number.sql` (column + backfill +
  RPC), `EXPECTED_MIGRATION_HEAD` bumped. Conformance tests pin
  delete-then-reserve minting a FRESH number.
- ✅ **1.6** Tests: `definition-byte-cache.test.ts` (byte-budget LRU eviction,
  version-id keying / reused-fileKey non-collision, over-budget pass-through,
  budget-0 disable, per-ref hit/miss/skipped outcome); `def_bytes` pipeline
  tests; `definition-service.test.ts` (uploadVersion reserves + derives fileKey
  from the reserved number, never lists versions); conformance
  reserveNextVersionNumber suite. Note: the route-level "second solve does not
  hit storage" was covered at the byte-cache seam (a warm `getOrLoad` never calls
  the loader) rather than a full HTTP harness — the existing compute route tests
  deliberately avoid the live-compute shell for the same reason.
- Note: remote-URL definitions stay on the existing TTL byte cache (URLs are
  mutable); local versions are byte-cached by immutable id (drafts included,
  channel decision 4d).

### Phase 2 — backpressure adoption (R5 app half / audit B7) — ✅ DONE (2026-07-13)

Landed: `maxQueueDepth` + `queueWaitMs` threaded through `ClientCacheConfig` →
`createScheduler` (env `COMPUTE_MAX_QUEUE_DEPTH` / `COMPUTE_QUEUE_WAIT_MS`, both
`0` = unbounded by default — nothing sheds until an operator opts in); a new
`shed` `SolveOutcome` classifying `QUEUE_FULL`/`QUEUE_TIMEOUT` rejections →
route maps to **503 + `Retry-After`**; a `shed` `SolveFailureKind` for the
metric record; R3 abort-while-queued wiring verified. Full build + check +
server (220) + app (198) + all 16 test tasks green, lint 0 errors. Per-item
notes below.

- ✅ **2.1** `computeMaxQueueDepth` / `computeQueueWaitMs` added to
  `ComputeLimits` (`readNonNegativeInt` so `0` is valid) and threaded through
  `ClientCacheConfig` → `createScheduler` beside `maxConcurrentSolves`. Env
  knobs `COMPUTE_MAX_QUEUE_DEPTH` / `COMPUTE_QUEUE_WAIT_MS` in
  `resolveComputeLimits`, exported from `computeLimits.ts`, wired in
  `clientCache.server.ts`, documented in both `.env.example` copies.
  **Default: both `0` = unbounded / no deadline** (prior behavior — the queue
  grows without limit). Chose unbounded-by-default over an inferred cap because
  there's no production load data yet; blindly shedding could reject legitimate
  bursts. `0` maps to `undefined` at the `createScheduler` call (passing `0`
  would shed EVERY queued solve). Tuning guidance in the env docs: depth ≈ 2–3×
  `COMPUTE_MAX_CONCURRENT`, wait ≈ `MAX_SOLVE_DURATION_MS`.
- ✅ **2.2** `runSolvePipeline` classifies `RhinoComputeError` with
  `code === QUEUE_FULL | QUEUE_TIMEOUT` (checked BEFORE the generic
  `compute_error` return) into a new `SolveOutcome` kind
  `shed { reason: 'queue_full' | 'queue_timeout'; retryAfterSeconds; message }`.
  The route maps `shed` to a raw **503 + `Retry-After`** Response (apiError
  can't set the header — mirrors the rate-limit 429 path) and records the new
  `shed` `SolveFailureKind`. `shed` flows through the free-text `failure_kind`
  column (no migration / CHECK constraint) in both metric stores.
- ✅ **2.3** Verified R3 wiring: the route already forwards `request.signal`
  into `scheduler.solve` (so the package's queued-abort prune, ISSUES 46, can
  bite) and the pipeline classifies an aborted-signal AbortError as
  `client_abort` → 499. Added a pipeline test proving a disconnect-while-queued
  forwards the signal, settles `client_abort`, and never leaks a compute result.
- ✅ **2.4** Audit tracker rows B7 / B1 queue bullet updated (see
  `data-access-efficiency-audit.md`).
- Note: the package's `maxQueueDepth`/`queueWaitMs` + `QUEUE_FULL`/
  `QUEUE_TIMEOUT` codes shipped in `@selvajs/compute@3.1.0-beta.5`; this phase
  is pure app-side adoption. Single-flight (R4) and concurrency sizing beyond
  `COMPUTE_MAX_CONCURRENT` stay out of scope — R4 lands with the L2 cache
  (Phase 3), and sizing is an operator tuning task, not code.

### Phase 3 — durable L2 solve cache (H1 + H2 app side) — M, the structural win

Design fully decided under [H1](#h1-no-durable--shared-solve-cache--the-structural-gap--cacheperf)
and its amendments; this is the build list.

- ☐ **3.1** `ISolveResultCache` provider interface in `@selvajs/platform`
  (+ `NoopSolveResultCache`), async from day one, entries = opaque gzipped
  envelope bytes + small metadata header, best-effort contract (`get` may
  miss, `set` may drop), quota passed at write time
  (`set(key, bytes, { maxEntriesForDefinition })`), key parts
  `(orgId, definitionId, versionId, inputKey)`. Env selection
  `SOLVE_CACHE_PROVIDER=memory|off` (Redis later — interface must not require
  its capabilities).
- ☐ **3.2** Memory backend in `@selvajs/server`: per-definition count quota +
  LRU-within-definition, global byte backstop `SOLVE_CACHE_MAX_TOTAL_MB`,
  default per-definition quota `SOLVE_CACHE_DEFAULT_MAX_ENTRIES`.
- ☐ **3.3** Keying (H2/R8/R13): `inputKey = sha256(stableStringify(transformedTree) + configSubset)`
  computed **post-transform** in the pipeline, using the package's exported
  `stableStringify` (key parity) + node `crypto` SHA-256 app-side.
  `configSubset` folds in modelunits/tolerances/`dataversion` +
  `COMPUTE_CONTRACT_VERSION`. Store the canonical string (or its full hash
  preimage length + prefix) in the entry header for hit-time comparison —
  defense-in-depth against collision.
- ☐ **3.4** Pipeline hook (amendment 3): `runSolvePipeline` accepts optional
  `solveCache?: { lookup(inputKey), store(inputKey, envelope) }`; on hit,
  return the stored pre-gzipped envelope (near-CPU-free); on miss, solve then
  write-through on the success branch. The app passes the closure ONLY for
  live-channel solves with quota > 0 — channel gating by hook presence, zero
  policy conditionals in the package/pipeline.
- ☐ **3.5** Single-flight (R4): `Map<inputKey, Promise>` wrapped around the
  L2 lookup+solve, above the `ISolveResultCache` interface.
- ☐ **3.6** `solveCacheLimit` on the definition record (R9, shape decided:
  absent = inherit, `0` = off, `N` = quota): platform type/schema, both
  providers (+ Supabase migration — bump `EXPECTED_MIGRATION_HEAD`, O3),
  definition-settings UI (one number input, "0 disables"), consulted before
  every L2 read/write.
- ☐ **3.7** B8 rides along: switch the pipeline's `gzipSync` to async
  `zlib.gzip` while touching those exact lines (audit B8 — event-loop stall).
- ☐ **3.8** Observability: `l2_cache;dur=0|1` Server-Timing verdict next to
  `selva_cache`; hit/miss/entry-count/byte counters on the memory backend.
- ☐ **3.9** Tests: quota eviction within one definition doesn't evict
  another's entries; `0` disables; org isolation in the key; hit returns
  byte-identical envelope; single-flight coalesces N concurrent identical
  solves into one compute call; version bump = fresh keyspace (no
  invalidation logic to test — that's the point).
- **Open decision (small package follow-up, does NOT block 3.1–3.9):**
  per-solve `skipCache`/`cachesolve` overrides on `scheduler.solve()` (K6/R9
  pkg half) are not in the release. Until they exist: live solves keep L1 on
  (harmless double-store, bounded 20 entries) and drafts keep `cachesolve`
  on. When the seam ships in the next package minor, flip live solves to
  `{ skipCache: true }` and draft solves to `{ cachesolve: false }` per the
  channel decision. Alternative rejected: a second uncached scheduler per
  warm client would split the `maxConcurrent` budget per server.

### Phase 4 — client + polish — XS–S each, any order

- ☐ **4.1** M2 — client-side result memo: small `(inputHash → result)` LRU in
  `createSolveSession` (`@selvajs/ui`); kills slider-return-to-value re-hits
  before they leave the browser.
- ☐ **4.2** R2 — fix the misleading debug-log wording in
  `@selvajs/server/compute/client-cache.ts` (errored solves ARE cacheable now
  via `cacheerroredsolves`; the "NEVER cached" comment describes only the
  default).
- ☐ **4.3** Optionally surface `requestId` from `onServerTiming` in the debug
  logs for concurrent-solve correlation. The B6 seq-guard attribution stays —
  the scheduler still doesn't expose which requestId belongs to which
  `solve()` call; revisit if the package adds that linkage.
- ☐ **4.4** R10 (future, before any affinity routing): per-request
  `X-Selva-Definition` — needs a per-request header hook upstream; tracked,
  not actionable this cycle.

### Phase 5 — F1 pre-solved bundle + prewarm — M–L, after Phase 3

Blocked on H1 (same keying + envelope machinery). Unchanged from the
[F1 section](#f1-pre-solved-downloadable-definition-bundle--feature); the
prewarm variant (seed byte cache + Rhino pointer + L2 on publish) is the cheap
first slice. Resolve open question 5 (input-space enumeration authoring UX)
before starting.

---

## What already exists (baseline — no action, context for the findings)

Four caching layers are already in place and well-instrumented:

1. **Warm client/scheduler LRU**, per compute server `id`, cap 16.
   `selva/packages/server/src/compute/client-cache.ts:127` (`createClientCache`).
   Caches the Rhino.Compute connection/handshake, not results.
2. **In-process solve response cache** — the scheduler's own `Map`, keyed on
   `hashSolveInput(definition, dataTree)`.
   `src/features/grasshopper/scheduler/solve-scheduler.ts:186` +
   `readCache`/`writeCache` (`:650`/`:664`). Wired at
   `client-cache.ts:193` with `{ maxEntries: 20, ttlMs: 5*60_000 }`.
3. **Rhino `cachesolve`** — the compute server's own result cache (identical
   request body). Flag flows through `applyOptionalComputeSettings`
   (`solve.ts:263`).
4. **Server definition-cache / pointer reuse** — large `.gh` referenced by
   server cache-key instead of re-uploading. `reuseServerDefinitionCache` +
   `runExecutor` (`solve-scheduler.ts:478`), `solveByCacheKey`/
   `solveGrasshopperDefinitionWithCacheKey` (`solve.ts:142`/`:168`).

Plus: a remote-URL `.gh` byte cache (`selva/packages/selva/src/routes/api/compute/+server.ts:58`)
and the persisted per-version extracted UI schema (`DefinitionVersion.schema`).

The endpoint is heavily instrumented — `Server-Timing` exposes `selva_cache`,
`def_reupload`, `rhino_*` verdicts (`+server.ts:520-559`). Use these to measure
before/after any change here.

**Serializability confirmed:** `GrasshopperComputeResponse`
(`src/features/grasshopper/types.ts:289-309`) is a plain JSON object (strings/
numbers/arrays; geometry is base64 strings, no `Uint8Array`/class instances). It
is fully persistable and replayable through `GrasshopperResponseProcessor`
without re-solving — this is what makes both the durable cache (H1) and the
pre-solved bundle (F1) feasible.

---

## High severity

### H1. No durable / shared solve cache — the structural gap — cache/perf

> **Status: TODO (selva repo)** — design fully decided (see the revalidation amendments and the dashboard at the top); package prerequisites shipped 2026-07-11.

The only result cache (baseline #2) is 20 entries, 5-min TTL, and
**process-local**. At 1000 users:

- 20 entries is nothing — a handful of public definitions under slider-scrub
  load evict it in seconds; effective hit rate → ~0.
- Process-local means every app instance keeps its own 20 entries, and the cache
  dies on every deploy. Multi-instance = N× compute warm-up for the same solve.

**Fix (app-layer, recommended):** an `ISolveResultCache` provider in
`selva/packages/platform`, checked in `+server.ts` right before
`getClient`/`scheduler.solve` (`+server.ts:384-398`), written on the success
branch (`+server.ts:402`). Redis for hot / blob storage for cold. The package's
local `Map` stays as L1; this is the shared L2.

**Decided structure (2026-07-11, with the user) — definition-scoped quotas,
not one global LRU:**

```
ONE RESULT CACHE PER CHANNEL (revalidation amendment, 2026-07-11):

live solve   → L2 read: (orgId, definitionId, versionId, sha256(inputs))
               → hit: return stored gzipped envelope (R6), near-CPU-free
               → miss: scheduler with { cache: false } (L1 skipped)
                 → Rhino `cachesolve` → actual solve
               ← L2 write-through when the definition's quota allows

draft solve  → scheduler L1 only (tiny hot memo for the editor's iteration
               loop) + { cachesolve: false } → never touches L2
```

Rationale for L1-draft-only: an L1 hit returns a response object that still
pays `JSON.stringify` + `gzipSync` per request (B8's event-loop stall), while
an L2 hit returns the pre-gzipped envelope — strictly cheaper. Running both
for live solves double-stores every result and doubles what must be debugged.
One cache per path, each with one job.

- **Per-definition entry quota** — each definition gets its own budget of
  cached solves; eviction is LRU _within_ the definition. A slider-heavy
  definition churns only its own entries instead of evicting everyone else's
  (solves R9's wide-input-space problem structurally, not with an off-switch).
  Old versions' entries age out naturally inside the definition's quota.
- **The per-definition policy is ONE number:** `solveCacheLimit` on the
  definition record — absent = inherit the global env default
  (`SOLVE_CACHE_DEFAULT_MAX_ENTRIES`), `0` = caching off (the
  non-determinism escape hatch), `N` = cap. This **supersedes the earlier
  `'inherit' | 'off'` enum decision** (K6 flag-shape) — one field, one input
  box in definition settings ("0 disables"), strictly simpler.
- **Global byte budget as the ops backstop** — entries range KB→100s of MB,
  so a count quota can't bound memory: `SOLVE_CACHE_MAX_TOTAL_MB` (in-memory)
  / `maxmemory allkeys-lru` (Redis) evicts across everything regardless of
  per-definition counts. Authors think in counts; operators think in bytes;
  both knobs exist.
- Keying by `versionId` means publish = fresh keyspace, rollback = old
  entries hit again, invalidation = nothing to build.

**Pluggable-store contract (decided 2026-07-11)** — the in-memory
implementation ships first, but the interface is written so Redis (or any
shared store) is a **config change, not a redesign**:

- `ISolveResultCache` is a `@selvajs/platform` provider interface (same
  pattern as storage/auth/metrics), selected via env
  (`SOLVE_CACHE_PROVIDER=memory | redis`). The solve pipeline only talks to
  the interface.
- **Async API from day one** — the memory impl returns promises too;
  otherwise every call site changes shape when a network store arrives (the
  H3 sync-fast-path lesson, applied preemptively).
- **Entries are opaque bytes** — the gzipped envelope (R6) + a small metadata
  header. Memory stores the same buffer Redis would; hits stay near-CPU-free
  in both backends, and there is no serialization drift between impls.
- **Best-effort contract** — `get` may miss at any time (restart, eviction,
  network blip); `set` may silently drop. Correctness never depends on cache
  presence — this is what makes backends interchangeable AND what makes the
  no-correctness-TTL versionId keying safe under any eviction policy.
- **Quota semantics work in both**: per-definition count quota + LRU-within-
  definition = `Map` + counters in memory, per-definition sorted set
  (score = last access) in Redis. The interface passes
  `(definitionId, versionId, inputKey)` so the backend organizes its own
  keyspace; eviction is backend-internal, budgets are config.
- **The byte cap moves with the backend**: in-memory it's
  `SOLVE_CACHE_MAX_TOTAL_MB` inside the Node heap; on Redis the backstop is
  the server's `maxmemory allkeys-lru` — sized independently of the app
  (this is the "raise the total cap by adding Redis" upgrade path), and the
  cache becomes shared across app instances for free.
- Key prefixes (`solve:`, `rl:`) reserved so one Redis can also serve the B5
  rate limiter and still split later (already in the Redis notes below).
- Single-flight (R4) stays ABOVE the interface: in-process coalescing first;
  the Redis `SET NX` lease is an optional backend capability added when the
  Redis impl lands — the interface must not require it of the memory impl.

**Revalidation amendments (2026-07-11, architecture/maintainability pass):**

1. **Root-cause fix for the fileKey trap:** version numbers become
   **monotonic** (`nextVersionNumber` stored on the definition record, never
   decremented) — delete-latest + re-upload can no longer reuse a number, so
   `fileKey` becomes genuinely immutable. `versionId` keying stays as
   belt-and-braces, but no future cache can be poisoned by the gap-reuse
   behavior. Pre-release = free to change.
2. **One result cache per channel** (see the flow above): live → L2 only
   (scheduler called with `{ cache: false }`); draft → L1 only. The K6
   per-solve flags are therefore REQUIRED infrastructure for L2, not
   optional hygiene.
3. **L2 hook = injected closure in `runSolvePipeline`**: the pipeline accepts
   optional `solveCache?: { lookup(inputKey), store(inputKey, gzippedBytes) }`
   and computes `inputKey` from the TRANSFORMED tree (R13). The app passes
   the closure ONLY for live-channel solves with quota > 0 — channel gating
   by hook presence, zero policy conditionals in the package.
4. **Single-flight correction:** the scheduler has NO in-flight coalescing
   (verified against source 2026-07-11 — ISSUES.md 115's status overstates
   it), and with L1 draft-only it's the wrong place anyway. Dogpile
   protection for live solves = `Map<inputKey, Promise>` next to the L2
   lookup, above the `ISolveResultCache` interface.
5. **Backend statelessness:** the per-definition quota is passed at write
   time — `set(key, bytes, { maxEntriesForDefinition })` — so backends hold
   no policy, only data.
6. **Impl homes:** memory backend lives in `@selvajs/server` (platform ships
   only the interface + a Noop, matching the existing provider pattern);
   Redis backend is a later optional module.
7. **Key namespace includes `orgId`** — access gates precede every lookup so
   it isn't strictly needed, but it's free defense-in-depth and closes the
   open per-org-isolation question.
8. **One env family, one release:** all cache knobs named consistently and
   parsed in `resolveComputeLimits` / documented in `.env.example`; ALL
   `@selvajs/compute` changes (DefinitionRef + per-solve cache flags,
   optionally B7 queue bounds) ship in ONE minor release to pay the publish
   gate once. B8's async `zlib.gzip` rides along with the pipeline hook
   (same lines of code).

**Why app-layer, not in this package:** the durable key wants `versionId`
(immutable → **no TTL needed**, results valid forever), which the package doesn't
know about. Keeping correctness (collision-safety, status gating, per-org
isolation) next to auth is right. See H2 for the one package change this needs.

### H2. `hashSolveInput` is 32-bit and `@internal` — unsafe as a durable key — correctness/seam

> **Status: PARTIAL (this repo)** — the 32-bit collision bugs are fixed (two-part `defHash|treeHash` key, ISSUES 53-56/68), so the in-process key is sound. The SHA-256/`stableStringify` export for durable keying still awaits open question 3.

`src/features/grasshopper/scheduler/stable-hash.ts:81` — 32-bit FNV-1a, 8-hex
chars, marked `@internal`, not re-exported from any barrel.

A ~4-billion-value space is fine for a 20-entry in-process Map. For a **durable,
cross-user** cache it will collide at volume — and a collision serves user A's
geometry to user B. CONTEXT.md L92–97 records that a definition-collision bug of
exactly this shape already shipped once.

**Fix:** the durable cache (H1) must key on a wide hash (SHA-256) AND store the
canonical inputs to compare on a hit (defense-in-depth against collision). The
package should export a public, stable keying helper — either a SHA-256 variant
of `hashSolveInput`, or just export `stableStringify` (`stable-hash.ts:10`) and
let the app hash. This is the ONLY package change H1 strictly requires.

### H3. No pluggable cache seam in `SolveScheduler` — seam

> **Status: DEFERRED BY DESIGN** — H1 lives app-layer above the scheduler (revalidation amendment 3); revisit only if the durable cache should ever move in-package.

`solve-scheduler.ts:186` — the cache is a hardcoded `private Map` with private
`readCache`/`writeCache`. No `CacheStore` interface, no injection point.

Consequence: a durable cache cannot be injected into the scheduler today; it must
wrap the scheduler at the app layer (which H1 does). Also note the fast path
(`solve-scheduler.ts:328-345`) is **synchronous** — `readCache` returns
synchronously to build a resolved promise — so any in-scheduler async store would
force that path async. This is the reason H1 lives above the scheduler, not
inside it.

**Optional future fix (only if a durable cache should live IN the package):**
introduce `interface CacheStore { get(key): Promise<...>; set(...) }` on
`SolveSchedulerOptions`, replacing the direct `Map` in `solve()`/`execute()`, and
make the fast path async. Not needed for H1's app-layer approach — tracked here
so the decision is explicit.

---

## Medium severity

### M1. Local `.gh` blob refetched from storage on every solve — perf

> **Status: package half DONE / app half TODO** — the `DefinitionRef` seam shipped in this repo 2026-07-11; the `versionId → bytes` cache and route wiring remain in `selva`.

`selva/packages/selva/src/routes/api/compute/+server.ts:315` —
`storage.get(version.fileKey)` runs on every local solve. Remote URLs get the
byte cache (baseline); local versions do not. Version blobs are ~~immutable per
`fileKey`~~ **immutable per `versionId` only — `fileKey` can be REUSED with
different bytes** (see the correctness constraint in the "Definition-byte
caching" section below).

**Fix:** ~~small keyed cache of version bytes (`fileKey` → bytes)~~ **superseded
(2026-07-11)** by the full decided design in
[Definition-byte caching](#definition-byte-caching--decided-design-2026-07-11)
at the bottom of this file — same idea, keyed by `versionId`, plus the byte-less
pointer path.

### M2. Client-side solve session has no result memo — perf

> **Status: TODO (selva repo, ui)**.

`selva/packages/ui/src/lib/compute/createSolveSession.svelte.ts` — abort-on-newer
exists, but there is no `(inputHash → result)` memo. Dragging a slider back to a
prior value re-hits the server.

**Fix:** small LRU in the solve session. Cheapest user-facing latency win; kills
slider-scrub storms before they leave the browser. Pairs with the scheduler's
existing `latest-wins` mode.

### M3. Strip `algo` before persisting cached results — perf/correctness

> **Status: DONE (this repo)** — `algo` is stripped at the source in `runSolve` (regression-tested, ISSUES 58), so a persist-path strip is moot: responses never carry it.

`GrasshopperComputeResponse.algo` (`types.ts:296`) carries the full base64
definition inside every response. If H1 persists responses verbatim, every cache
entry stores the whole `.gh` again (multi-MB). Also note `runSolve`
(`solve.ts:207-214`) **strips the server `pointer`/cacheKey** off the response —
so if the durable cache wants to keep the cache key, capture it from
`SolveWithCacheKey.cacheKey`, not from the response object.

**Fix:** in H1's write path, drop `algo` (and any other definition-echo fields)
before persisting; rehydrate is unaffected (the processor reads `values`, not
`algo`).

---

## Feature asks

### F1. Pre-solved, downloadable definition bundle — feature

> **Status: TODO (selva repo)** — blocked on H1.

Ask: pre-solve a definition (e.g. 100 input combos), package as a file a user
can download and run **without compute**.

Feasible because `GrasshopperComputeResponse` is self-contained and replayable
(see baseline note). Shape: `{ manifest, entries: { [key]: response } }` where
each response has `algo` stripped (M3) and `key` is the SHA-256 of canonical
inputs (H2). A viewer with the bundle serves any matching combo with zero
compute; on a miss it falls back to a live solve.

**Hard constraint to state up front:** Grasshopper input spaces are
continuous/combinatorial. A bundle only covers **discrete, enumerable** inputs
(dropdowns, toggles, small integer ranges). A free-float slider cannot be fully
baked — so the format is "exact-match lookup with graceful live-solve fallback",
not a general offline solver.

**Dependency:** builds directly on H1's result serialization + keying. Do H1
first; F1 is then mostly packaging + a bundle-aware read path in the viewer.

**Variant — prewarm (no download):** the same batch-solve, but the output
populates H1's durable cache instead of a file. Same machinery, different sink.
Cheap to offer alongside F1.

---

## Recommended sequence

| #   | Item                                                                                                            | Layer                         | Effort | Payoff at 1000 users                              |
| --- | --------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------ | ------------------------------------------------- |
| 1   | M1 — cache local `.gh` blob by `fileKey`                                                                        | selva app                     | XS     | drops a storage read per solve                    |
| 2   | M2 — client-side result memo                                                                                    | selva ui                      | S      | kills slider-scrub storms client-side             |
| 3   | **H1 + H2** — durable `ISolveResultCache` keyed `(versionId, sha256(inputs))`, SHA-256 export from this package | platform + app + this package | M      | the structural win — a hit skips compute entirely |
| 4   | M3 — strip `algo` in the persist path                                                                           | app                           | XS     | keeps cache entries small                         |
| 5   | F1 — pre-solved downloadable bundle                                                                             | new feature                   | M–L    | offline / abuse-shielded runs; built on H1        |

H3 (in-package cache seam) is deferred — only needed if the durable cache should
move into the package later; H1's app-layer approach makes it optional.

---

## Open questions (resolve before implementing)

1. **H1 key scope** — key on `versionId` (immutable, no TTL) vs a definition-byte
   hash? `versionId` is cleaner but is app-only knowledge, reinforcing app-layer
   placement. Confirm draft-channel overwrites mint a new version id (no in-place
   blob mutation under a stable id).
2. **H1 store** — Redis-only, blob-only, or tiered? Ties into the audit's B5
   (Redis for the rate limiter at multi-instance) — one Redis dependency could
   serve both.
3. **H2 hash** — export a SHA-256 `hashSolveInput` variant from this package, or
   export `stableStringify` and hash app-side? Former keeps keying logic in one
   place; latter avoids a new public API on the package.
4. **Status gating** — ~~cache only `published`/`live` versions?~~ **Answered
   2026-07-11 (channel-gating rule, decided with the user):** durable /
   server-side result caches are **live-only**; in-process and byte caches
   **deliberately include drafts**. Concretely: (a) **H1's durable L2
   reads+writes only live-channel solves** — draft versions are solved a
   handful of times then abandoned, so persisting them is pure eviction churn
   and storage cost; (b) once the per-solve cache-override seam (K6) exists,
   the app **sends `cachesolve: false` on draft-channel solves** so draft
   results stop occupying the Rhino server's RAM/disk — a first concrete
   consumer of that seam; (c) the scheduler's **L1 keeps caching drafts** (the
   editor re-solving the same draft inputs is one of its hottest legitimate
   uses; TTL+LRU bound the cost); (d) the **definition-byte cache keeps
   drafts** too — draft iteration re-solves the same multi-MB blob dozens of
   times per session, and bytes are content-safe regardless of channel. No
   correctness angle anywhere: all keys are content/version-derived, so a
   re-uploaded draft can never be served stale. ~~Skip errored solves (mirror
   `cacheerroredsolves`)?~~ **Answered 2026-07-11: no — errored solves are
   valid GH results and are cached (see addendum R2 / ISSUES.md 114).** Still
   open: per-org isolation in the key to prevent cross-tenant reads?
   Per-definition `cachePolicy` off-switch (addendum R9): decided 2026-07-11 —
   definition **record** field + settings UI, result caches only. **Shape
   revised same day:** a single number `solveCacheLimit` (absent = inherit
   global default, `0` = off, `N` = per-definition entry quota) instead of the
   briefly-decided `'inherit' | 'off'` enum — see the "Decided structure"
   block under H1.
5. **F1 enumeration** — how does an author declare the discrete input space to
   batch-solve? New schema metadata on inputs, or an admin "generate bundle" UI
   that walks enumerable inputs?
6. **Invalidation** — with `versionId` keying, a new version is a new key (no
   invalidation needed). Confirm there's no path that mutates a version's bytes
   under a stable id (would poison the cache).

---

## Re-review addendum (2026-07-11, second pass)

A second pass over the same surface, verifying the findings above against the
code and hunting for what the first pass missed. Everything above stands, with
these corrections and additions. Same categories.

**Tracker links:** the package-level _bugs_ below are filed in `ISSUES.md` —
R2 → issue 114, R4 → issue 115, R11 → issue 116; R1/R3/R7/R12 and the `algo`
echo were already tracked there as issues 56/46/57/53/58 (see the overlap note
atop the "Caching Re-review" section there). App-side findings (R5, R10) are
noted in `selva/docs/plans/data-access-efficiency-audit.md` under the compute
entry of "Not yet audited". Design-level items (R6, R8, R9, R13, Redis notes)
live only here.

### Corrections to the first pass

- **Stale line refs / moved seam.** The solve pipeline was extracted out of the
  app route into `@selvajs/server` — `runSolvePipeline`
  (`selva/packages/server/src/compute/solve-pipeline.ts`). Current locations:
  `storage.get(version.fileKey)` is `+server.ts:213` (not :315); `getClient` is
  `+server.ts:271`; the Server-Timing envelope is built in
  `solve-pipeline.ts:291` (not `+server.ts:520-559`); the remote-URL byte cache
  lives in `remote-definition.ts` (`createRemoteDefinitionFetcher`), not inline
  in the route. **Consequence for H1:** the natural hook point is no longer "in
  `+server.ts` before `getClient`" — it is inside (or wrapping)
  `runSolvePipeline`, between tree build and `scheduler.solve`
  (`solve-pipeline.ts:168`), because the pipeline already owns
  serialize + gzip and that enables R6/R13 below.
- **M3 is understated — `algo` is echoed to the _browser_ today, not just a
  persistence concern.** `runSolve` strips `pointer` but NOT `algo`
  (`solve.ts:207-215`), `GrasshopperComputeResponse.algo` is "always present"
  (`types.ts:296`), and the pipeline serializes the whole response
  (`solve-pipeline.ts:191`). So every solve response carries the full base64
  definition back to the client — multi-MB of dead weight per slider tick, and
  base64-of-zip barely gzips. A repo-wide grep found **no consumer of
  `response.algo`** in either repo (the processor reads `values`). Promote M3
  to: strip `algo` in `runSolvePipeline` (or `runSolve`) before serialization,
  today, independent of H1. Verify no external/plugin API consumer first.

### New — high severity

#### R1. Sampled `Uint8Array` hashing collides — and defeats H2's defense-in-depth — correctness

> **Status: FIXED (this repo, 2026-07-11)** — tree `Uint8Array`s are keyed by a full-content hash (ISSUES 56); the lossy-canonical objection to H2's defense is gone.

`stable-hash.ts:20-25`: a `Uint8Array` _inside the dataTree_ is stringified as
`{len, first 32 + last 32 bytes}`. Two binary inputs of equal length differing
only in the middle (plausible for structured binary formats with fixed headers/
trailers) produce the **same cache key today** → wrong cached result served.
Worse: H2's planned mitigation — "store the canonical inputs and compare on a
hit" — cannot catch this, because the canonical string is itself lossy. Any
durable key (and its stored-canonical comparison) must hash binary inputs over
**full content**. The per-solve perf argument for sampling is weak given the
definition already gets a full-content pass in the same key.

#### R2. Errored solves ARE cached by the in-process cache — resolved as intended (decision 2026-07-11)

> **Status: package DONE / app log TODO** — `CacheOptions.cacheErroredSolves` shipped (default `true`, both behaviors test-pinned, ISSUES 114). The misleading `client-cache.ts` log wording remains to fix in `selva`.

`solve-scheduler.ts:436` — `writeCache` runs on every resolved response with no
gate on `response.errors`, and the debug log in `client-cache.ts:222-224` ("an
errored solve is NEVER cached") is true only of Rhino's own `cachesolve` — the
Selva cache contradicts it.

**Decision (2026-07-11): keep caching them — this is correct, not a bug.** In
Grasshopper an errored solve is still a valid, deterministic result: definitions
raise GH errors by design (guarded components, validation branches —
`types.ts:205-207` documents exactly this pattern). The durable cache (H1)
should store them too. Residual work only: fix the misleading app-side log
wording, and optionally add `CacheOptions.cacheErroredSolves` (default **true**)
for consumers wanting Rhino-flag parity. Answers open question 4's "skip
errored solves?" — no. Genuinely _transient_ failures (network, plugin crash)
reject rather than resolve, so they never reach the cache either way. Tracked
as `ISSUES.md` 114 (downgraded to api/docs).

#### R3. Queued solves whose client disconnected still execute — perf/correctness

> **Status: package FIXED / app wiring to verify** — queued items now settle ABORTED on signal fire (ISSUES 46). Verify the `selva` route actually passes request-disconnect signals so this bites.

`solve-scheduler.ts:358` checks `externalSignal.aborted` only at `solve()`
entry; the abort listener is attached in `execute()` (`:415`). An `AbortSignal`
that fires while the item waits in `fifoQueue`/`pendingForLatestWins` never
triggers a listener added later — so `execute()` runs the **full compute for a
dead request**. The app uses `queue` mode, so at 1000 users a disconnect storm
(page nav during a burst) burns real Rhino time on requests nobody is waiting
for. Fix: `execute()` should first check `item.externalSignal?.aborted` and
settle as `ABORTED`; better, attach the listener at enqueue time and prune the
queue on abort.

#### R4. No single-flight / stampede protection anywhere — perf

> **Status: package half CLOSED BY DESIGN / app half TODO** — coalescing belongs next to the L2 lookup (revalidation amendment 4); the `Map<inputKey, Promise>` remains to build in `selva`.

Cache lookup happens only at `solve()` call time (`solve-scheduler.ts:328`).
N identical requests arriving while the first is still solving all enqueue and
all execute — there is no `key → in-flight promise` coalescing. Rhino's
`cachesolve` softens the repeats server-side, but each still pays a round trip,
and the planned durable L2 has the classic cold-key dogpile at 1000 users (hot
public definition + deploy = thundering herd onto Rhino). Fixes: (a) in-package,
a `Map<key, Promise>` coalescing identical in-flight solves — cheap and safe;
(b) for H1's L2, a lock/lease (e.g. Redis `SET NX` + wait) or
stale-while-revalidate. The plan above doesn't mention dogpiles at all.

#### R5. All solves per server serialize through one queue with no backpressure — perf

> **Status: TODO (mostly selva)** — concurrency sizing, queue cap + shedding, queue-wait deadline are app config/behavior; optional package queue bounds (B7) also unimplemented.

`client-cache.ts:190-193` creates the shared scheduler with `mode: 'queue'` and
no `maxConcurrent` → **1** (`solve-scheduler.ts:220`). Every user solving on the
same compute server, on the same app instance, waits in one FIFO. One slow solve
(deadline default 100 s, `limits.ts:128`) stalls everyone behind it; the queue
is unbounded; and `timeoutMs` starts at _execution_, so queue wait is unbounded
and invisible (and per R3 the dead requests still run). Caching aside, this is
the throughput ceiling the 1000-user question is really about — a cache miss
rate of even 10 % serializes. Directions: `maxConcurrent` sized to the Rhino
pool's children, a queue-depth cap that sheds load fast (503 + Retry-After
beats a hung request), a queue-wait deadline, plus R4's coalescing. Sits
directly inside the audit's B1 (Rhino saturation) context.

### New — medium severity

#### R6. Cache the serialized+gzipped envelope, not the response object — perf (H1 design)

> **Status: TODO (selva repo)** — part of H1's write path.

If H1 stores `GrasshopperComputeResponse` objects, every L2 _hit_ still pays
`JSON.stringify` (RangeError ceiling ~512 MB; configured cap
`computeResponseMaxBytes` defaults to **300 MB**, `limits.ts:134`) plus
`gzipSync` per request. Storing the compressed envelope body instead (stamped
with `COMPUTE_CONTRACT_VERSION`, `solve-pipeline.ts:40`) makes a hit almost
CPU-free and shrinks entries 5–10×; `algo` never enters it once M3/R6-strip
lands. Cost: cache format is coupled to the wire contract — acceptable because
the version stamp invalidates old entries on a bump. Non-gzip clients get a
gunzip fallback (rare).

#### R7. Definition bytes are FNV-hashed twice per solve on the event loop — perf

> **Status: PARTIAL (this repo)** — `DefinitionRef` solves skip hashing entirely (ISSUES 57); string/`Uint8Array` callers still hash twice. Adopting refs in the app is the intended fix.

`scheduler.solve` hashes the full definition in `hashSolveInput`
(`solve-scheduler.ts:320`) and `runExecutor` hashes it **again** at `:491`. For
a multi-MB `.gh` that is two full synchronous passes per request on the Node
event loop (tens of ms each at JS FNV speeds) — real blocking at high RPS. Fix:
memoize the definition hash in a `WeakMap<Uint8Array, string>` (pairs perfectly
with M1 — a per-`fileKey` byte cache reuses the same instance, so the hash
computes once per blob), or accept a caller-supplied definition identity
(`versionId`) — which is the same seam H2 wants anyway.

#### R8. Solve-affecting config is not in the key — correctness (durable only)

> **Status: TODO (selva repo)** — fold into H1's durable key.

`hashSolveInput` covers definition + dataTree, but `modelunits`, tolerances and
`dataversion` change results too (`solve.ts:263-273`). Safe today because
config is fixed per scheduler and schedulers are per server id. A durable
cross-instance cache keyed only `(versionId, inputHash)` collides across
differing server configs or Rhino versions. The durable key must fold in: the
solve-affecting config subset, `COMPUTE_CONTRACT_VERSION`, and (decide) the
compute server's Rhino version. Extends open question 3.

#### R9. Per-definition cache policy — non-determinism AND wide input spaces (H1/F1)

> **Status: TODO (selva repo, shape decided)** — one `solveCacheLimit` number on the definition record; optional package `skipCache` per-solve seam not built.

Two distinct reasons the durable cache needs a per-definition on/off switch
(2026-07-11 direction: this is a wanted feature, likely selva-side since the
app owns the definition record):

1. **Non-determinism.** Grasshopper definitions can be non-deterministic —
   Random components, time/date, external data fetched _inside_ the
   definition. `versionId + inputs` keying with no TTL freezes one sample
   forever, and an F1 bundle bakes it in. Today's 5-min TTL only masks this.
2. **Insanely wide input spaces.** A definition dominated by continuous
   sliders has an effectively infinite key space — hit rate ≈ 0, so caching it
   buys nothing while every solve writes a new entry: it churns the eviction
   budget and evicts entries that _would_ have hit. Turning the cache off for
   such definitions is a win in itself.

Shape: a `cachePolicy` flag on the definition (or version) record in selva,
consulted before the L2 read/write. The package needs no change for L2 —
but note the L1 limitation: the scheduler's cache is per _server_ and shared
across every definition solved on it, so a wide-space definition already
floods the 20-entry LRU and evicts other definitions' entries today. A
per-definition policy can only skip L2; honoring it at L1 would need the H3
seam (or a per-solve `skipCache` option on `scheduler.solve`) — cheap to add
if L1 flooding shows up in the `selva_cache` hit-rate telemetry. F1's
authoring flow must surface the same flag (a non-cacheable definition can't
be bundled; a wide-space one can only bundle explicitly enumerated combos).

#### R10. `X-Selva-Definition` header is stale on shared clients — correctness (future)

> **Status: TODO (selva repo, future)** — required before affinity routing ships.

`client-cache.ts:110,185-187` — the header is baked at client _build_ time from
whichever definition first touched that server; every later definition on the
same warm client sends the wrong guid. Inert-ish today (bad access-log
telemetry), but ADR 0004 D2 intends definition-affinity routing on exactly this
header — at which point it mis-routes. Needs a per-request header path (or
per-definition client keying) before any pool router ships.

### New — low severity

#### R11. Cache hits return a shared mutable reference — correctness (latent)

> **Status: DONE (this repo, 2026-07-11)** — immutability contract documented on `SolveScheduler.solve()` (ISSUES 116).

`readCache` returns the stored `response` object itself (`solve-scheduler.ts:661`);
`_lastResult` shares it too. Any consumer that mutates a response poisons every
subsequent hit. The app path serializes immediately (safe), but the package is
public API. Document the immutability contract (or `structuredClone` on read if
ever cheap enough — it isn't for 100 MB responses).

#### R12. `stableStringify` canonicalization edge collisions — correctness (edge)

> **Status: FIXED (this repo, 2026-07-11)** — `[undefined]`, sparse arrays, shared refs, Dates/Maps/Sets, and bigint all canonicalize distinctly now (ISSUES 53-55). `NaN`/`Infinity` → `null` is kept deliberately: it matches the wire payload.

`[undefined]` stringifies to `[]` (Array.join drops `undefined`), and
`NaN`/`Infinity` collapse to `null` (`stable-hash.ts:14-27`) — distinct inputs,
identical keys. Unlikely in JSON-derived trees; fix in the SHA-256 canonical
form (explicit sentinels) rather than patching the 32-bit path.

#### R13. F1 key derivation must happen post-transform — correctness (F1)

> **Status: PENDING F1 (selva repo)** — design constraint, no action until F1.

The bundle viewer computes lookup keys client-side without a server. The key
must be derived from the **transformed input tree** (`transformInputParameter`
→ `TreeBuilder`, `solve-pipeline.ts:151-155`), not raw `values` — otherwise
`"1"` vs `1`, defaulted vs explicit values, and clamping produce misses. The
viewer must reuse the exact same transform + canonicalize + hash code path
(argues for the package exporting the whole keying helper, per open question 3).

### Redis notes (for the later L2 — decisions to bank now)

1. **Tiered is forced, not optional** — responses can reach the 300 MB cap;
   Redis wants values ≲ 1 MB. Shape: Redis holds the key index + small/hot
   gzipped envelopes; oversized bodies go to blob storage with a Redis pointer.
   (Answers open question 2.)
2. Store the **gzipped envelope** (R6), stamped with contract version + entry
   schema version.
3. **Single-flight** at L2 (R4): `SET NX PX` lease per key; losers wait on the
   winner or fall through to a live solve after a short bound.
4. `versionId` keying still wants an **eviction budget** (`maxmemory` +
   `allkeys-lru`) — correctness never depends on presence, so LRU pressure is
   free; "no TTL" means no _correctness_ TTL, not unbounded growth. The R9
   per-definition `cachePolicy` is the other half of eviction hygiene: keep
   wide-input-space definitions out of the store entirely instead of letting
   them churn the LRU.
5. One Redis serves this + the audit's B5 rate limiter; keep key prefixes
   (`solve:`, `rl:`) so they can split later.
6. Observability: extend the existing Server-Timing verdicts with an
   `l2_cache` entry next to `selva_cache` so before/after hit rates are
   measurable from the browser, same as today.

### Revised sequence (delta to the table above)

- **New #0 (XS, do first):** strip `algo` from the solve response in the
  pipeline (M3 upgraded — saves multi-MB per response to every browser today).
- **New XS package fixes alongside #1–2:** R2 (fix the misleading errored-solve
  log; caching them stays — decided), R3 (skip queued-but-aborted solves),
  R4a (in-flight coalescing map).
- **#3 (H1+H2) design updated by:** R1 (full-content binary hashing), R6
  (envelope-level entries), R8 (config in key), R9 (per-definition
  `cachePolicy` — non-determinism + wide input spaces; errored solves ARE
  cached per R2's decision).
- **New peer of #3:** R5 — concurrency/backpressure on the shared scheduler;
  at 1000 users this bounds the miss path the way H1 bounds the hit path.
- R7, R10–R13 ride along with whichever item touches their file.

---

## Definition-byte caching — decided design (2026-07-11)

Distinct from everything above: the sections above cache **results**; this
section caches / avoids re-moving the **`.gh` bytes themselves**. Bytes are
deterministic by definition, so none of the R9 `cachePolicy` concerns apply —
the per-definition solve-cache policy must NEVER disable this layer.

**Goal (decided with the user, 2026-07-11):** a solve of a definition that
Rhino.Compute already holds should move **zero** definition bytes — no storage
read, no upload. When bytes ARE needed (Rhino forgot, first solve, render/IO,
schema re-extraction), they come from app memory, not storage.

Target flow per solve:

```
solve request ──► pointer known for versionId?
   ├─ yes ──► pointer-only solve (NO bytes loaded anywhere)
   │            └─ Rhino forgot (miss) ──► lazy-load bytes (byte cache → storage)
   │                                       ──► full upload, learn fresh pointer
   └─ no  ──► lazy-load bytes ──► full upload, learn pointer
```

Today this is impossible in two independent ways: (1) there is no byte cache
for storage-backed definitions (M1), and (2) the learned-pointer map is keyed
by a **content hash**, so the bytes must be loaded and hashed just to discover
that they didn't need to be loaded (`runExecutor` →
`hashDefinition(definition)` at `solve-scheduler.ts:491`), and
`solveByCacheKey(dataTree, cacheKey, definition, config)` demands the fallback
bytes **eagerly** even on the fast path.

### The correctness constraint that decides the key — `versionId`, NOT `fileKey`

`DefinitionService.uploadVersion` (selva) computes the next version number as
**highest existing + 1** — the code comment says "covers gaps from deletions".
Consequence: delete the latest version N, upload again → version number N is
minted a second time → **`fileKey` `versions/vN.gh` is REUSED with different
bytes**. `fileKey` is therefore NOT a content-stable identity. `versionId`
(random UUID per version row, never reused) is.

Every identity-keyed cache in this design — the app byte cache, the scheduler's
learned-pointer map, the L1 result-cache key, and later H1's durable key — MUST
key on `versionId`. (Today's content-hash keying is immune to this trap;
switching to identity keys is what makes the immutability contract
load-bearing.) Remote-URL definitions stay on the existing TTL byte cache for
the same reason — a URL is mutable.

This also answers the selva audit's open research question 5 ("confirm version
blobs are truly immutable per fileKey") — they are **not**; the getIO-result
cache follow-up (audit §2a) must key on `versionId` too.

**Root-cause fix decided (revalidation, 2026-07-11):** in addition to
`versionId` keying, `uploadVersion`'s gap-reuse gets fixed at the source —
version numbers become **monotonic** via a `nextVersionNumber` counter on the
definition record (never decremented on delete). After that, `fileKey` is
genuinely immutable too and the trap class is gone for every future cache;
`versionId` keying remains as belt-and-braces. Pre-first-release, so the
behavior change is free.

### What must happen in `@selvajs/compute` (THIS repo) — the package seam

> **Status (2026-07-11): IMPLEMENTED** — items 1–6 below all shipped (currently
> uncommitted on `beta`): `DefinitionRef` lives in
> `src/features/grasshopper/definition-ref.ts` (exported from the barrel),
> `hashSolveInput`/`hashDefinition` key refs by `r:${key}` with no byte
> hashing, `serverCacheKeys` keys by `ref.key` without materializing,
> `solveByCacheKey` calls `ref.load()` only inside the miss/upload branch, and
> all six pinned tests exist (`solve-scheduler-definition-ref.test.ts`,
> `solve-cachekey.test.ts`). Also landed same day: the `stable-hash`
> collision fixes (ISSUES.md 53–56, 68 — the R1 "canonical inputs are lossy"
> blocker is gone), `CacheOptions.cacheErroredSolves` (ISSUES.md 114), and the
> scheduler abort/supersede/state fixes (ISSUES.md 46, 50–52, 67, 116).

One coherent, backward-compatible API change (publish as minor):

1. **`DefinitionRef`** — a third definition form accepted by
   `SolveScheduler.solve` and threaded through the executors, alongside
   `string | Uint8Array`:
   ```ts
   interface DefinitionRef {
   	/** Identity of IMMUTABLE bytes (e.g. a version UUID). Two different
   	 *  byte contents must never share a key — cache poisoning otherwise. */
   	key: string;
   	/** Materialize the bytes. Called ONLY when an upload is unavoidable. */
   	load: () => Promise<Uint8Array>;
   }
   ```
   Document the immutability contract loudly on the type.
2. **L1 result-cache key from `ref.key`** — `hashSolveInput` gains an
   identity-keyed variant: `hash(ref.key, dataTree)` instead of hashing the
   full definition bytes. This is the "caller-supplied definition identity"
   seam R7 and H2 already asked for, and it removes the per-solve full-`.gh`
   FNV pass (issue 57) from this path entirely.
3. **Pointer map keyed by `ref.key`** — `serverCacheKeys` uses `ref.key`
   instead of `hashDefinition(bytes)`; the lookup happens WITHOUT
   materializing bytes.
4. **Lazy fallback in the cache-key path** — `solveByCacheKey` (and the
   `CacheKeyExecutor` type + the no-known-pointer first-solve path) accept the
   ref and call `ref.load()` only inside the miss/upload branch. `load()` runs
   inside `execute()`, so it counts toward the solve timeout and abort
   semantics unchanged.
5. **Back-compat:** `string | Uint8Array` forms behave exactly as today
   (content-hash keyed). No behavior change for existing callers.
6. **Tests to pin:** pointer-hit solve never calls `load()`; pointer-miss
   calls `load()` exactly once and re-learns the pointer under `ref.key`; L1
   hit for same `(key, tree)` without `load()`; abort during `load()` settles
   as ABORTED; a byte/`Uint8Array` caller still round-trips unchanged.

### What happens app-side (`selva` / `@selvajs/server`)

1. **Byte cache module** in `@selvajs/server` (small injectable interface, per
   audit B5): `versionId → bytes`, LRU evicted by **total byte budget** (not
   entry count — definitions are multi-MB), no TTL (identities are immutable),
   env knob `COMPUTE_DEFINITION_BYTE_CACHE_MB` (0 disables) in
   `resolveComputeLimits`. Expose hit/miss counters.
2. **Solve route/pipeline:** replace the eager `storage.get(version.fileKey)`
   with `DefinitionRef { key: version.id, load: byteCache(version.id, () =>
storage.get(version.fileKey)) }`. Add a Server-Timing entry
   (`def_bytes;desc=hit|miss|skipped`) so the win is measurable next to the
   existing verdicts.
3. **Render path:** `loadForRender`/getIO and schema re-extraction read bytes
   through the same byte cache (they still need real bytes — the byte-less
   path is solve-only).
4. **Later (F1 prewarm variant / user's "pinning" ask):** on publish, touch
   the definition once (seed byte cache + Rhino pointer) so the first real
   user never pays the upload. Rhino's own eviction can't be pinned from our
   side — prewarm is re-warm, not pin. Deferred until the above ships.

### Sequencing

- Package seam (items 1–5 above) and the app byte cache are independently
  shippable; the byte cache alone already kills the per-solve storage fetch
  (M1's original win). Do the package seam in the same pass if possible —
  keying the pointer map by `versionId` while touching the file avoids
  migrating twice.
- B6/R5 (`maxConcurrent`) first or together — it changes the load math.
- H1's durable cache reuses the same `versionId` identity groundwork; nothing
  here blocks on it.
