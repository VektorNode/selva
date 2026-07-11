# Solve Caching — Scaling Findings & Plan

Investigation of the solve caching story (2026-07-11), spanning `@selvajs/compute`
(this repo — scheduler, hashing, cache-key reuse) and its consumer
`@selvajs/selva` (the cloud app — `/api/compute`, client cache, provider stores).
Driver: **evaluate where better caching helps at 1000+ users**, plus two feature
asks — a solution cache that lives longer than the current 5-min in-process one,
and a downloadable "pre-solved" definition format.

Categories: **cache** (caching layer), **perf** (throughput/latency), **correctness**
(collision/poisoning risk), **feature** (new capability), **seam** (missing
extension point). Nothing here is fixed yet.

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

**Why app-layer, not in this package:** the durable key wants `versionId`
(immutable → **no TTL needed**, results valid forever), which the package doesn't
know about. Keeping correctness (collision-safety, status gating, per-org
isolation) next to auth is right. See H2 for the one package change this needs.

### H2. `hashSolveInput` is 32-bit and `@internal` — unsafe as a durable key — correctness/seam

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

`selva/packages/selva/src/routes/api/compute/+server.ts:315` —
`storage.get(version.fileKey)` runs on every local solve. Remote URLs get the
byte cache (baseline); local versions do not. Version blobs are **immutable per
`fileKey`**, so this is a safe cache-forever by key.

**Fix:** small keyed cache of version bytes (`fileKey` → bytes) on the app side.
Trivial, removes a storage round-trip from the hot path. (This is also listed as
a follow-up under audit §2a "the separate getIO-per-fileKey schema cache".)

### M2. Client-side solve session has no result memo — perf

`selva/packages/ui/src/lib/compute/createSolveSession.svelte.ts` — abort-on-newer
exists, but there is no `(inputHash → result)` memo. Dragging a slider back to a
prior value re-hits the server.

**Fix:** small LRU in the solve session. Cheapest user-facing latency win; kills
slider-scrub storms before they leave the browser. Pairs with the scheduler's
existing `latest-wins` mode.

### M3. Strip `algo` before persisting cached results — perf/correctness

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
4. **Status gating** — cache only `published`/`live` versions? Skip errored
   solves (mirror `cacheerroredsolves`)? Per-org isolation in the key to prevent
   cross-tenant reads?
5. **F1 enumeration** — how does an author declare the discrete input space to
   batch-solve? New schema metadata on inputs, or an admin "generate bundle" UI
   that walks enumerable inputs?
6. **Invalidation** — with `versionId` keying, a new version is a new key (no
   invalidation needed). Confirm there's no path that mutates a version's bytes
   under a stable id (would poison the cache).
