# Action Plan — Caching & Audit Issues

Synthesis of `CACHING.md` (strategy + findings, 2026-07-11) and `ISSUES.md`
(four audits, issues 1–116), cross-checked 2026-07-11. Ordered by dependency,
not severity: each phase unblocks or de-risks the next.

## Cross-check results

The overlap table in ISSUES.md ("Caching Re-review" header) is accurate:
R1↔56, R2↔114, R3↔46, R4↔115, R7↔57, R11↔116, R12↔53/68, M3↔58 all check out,
and the errored-solve decision (cache them, default on) is recorded
consistently in both files.

**Gaps neither doc connects — folded into the plan below:**

1. **Issues 50 and 67 are missing from CACHING.md's revised sequence.** Both
   live on the exact scheduler fast path (`solve-scheduler.ts:328-345`) that
   the R3 (abort-queued) and R4a (coalescing) fixes rewrite. If the scheduler
   cluster ships without them, the coalescing change either conflicts with or
   silently re-breaks them. → merged into Phase 2.
2. **Coalescing (115) escalates the shared-reference issue (116).** Today a
   shared mutable cache response is "latent"; once N concurrent identical
   solves share one in-flight promise, N callers hold the _same_ response
   object by design. The immutability contract (or a freeze/clone decision)
   must land in the same change as coalescing, not as a follow-up doc note.
3. **The stable-hash bug family (53, 54, 55, 56, 68) is only half-covered by
   the H2 plan.** CACHING.md R12 says "fix in the SHA-256 canonical form
   rather than patching the 32-bit path" — but the L1 in-process cache keeps
   using the buggy 32-bit path, so 53–56 remain live L1 collision bugs.
   Decision needed in Phase 3: migrate L1 keying onto the new canonical
   serializer (recommended — one serializer, two hash widths), or accept and
   document the residual L1 risk.
4. **R5 (single-queue, `maxConcurrent` = 1, no backpressure) exists only in
   CACHING.md.** It is arguably the biggest 1000-user throughput item and has
   no ISSUES.md number. → file it as issue 117 when starting Phase 4.
5. **Issue 83 (thrown errors pin the full dataTree) intersects H2's
   defense-in-depth** ("store canonical inputs, compare on hit") — storing raw
   canonical inputs per durable entry has the same multi-MB retention shape.
   Store a _second independent hash_ (or truncated canonical form) instead of
   the full inputs when entries are large.

---

## Phase 0 — Quick wins (XS each, independent, ship now)

No design decisions, immediate payoff, all verified findings.

| #   | Item                                                                                                                                        | Refs    | Where                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| 0.1 | ✔ **DONE 2026-07-11** (package side): stripped in `runSolve`, response type updated, regression test added. Selva-pipeline side still open. | M3, 58  | package `solve.ts:207-215` (+ selva pipeline)           |
| 0.2 | Fix misleading "errored solve is NEVER cached" log; add `CacheOptions.cacheErroredSolves` (default **true** — decided 2026-07-11)           | R2, 114 | selva `client-cache.ts:222-224`, package `CacheOptions` |
| 0.3 | Cache local `.gh` blob by `fileKey` (immutable → cache-forever)                                                                             | M1      | selva `+server.ts:213`                                  |
| 0.4 | Client-side `(inputHash → result)` LRU in the solve session                                                                                 | M2      | selva `createSolveSession.svelte.ts`                    |

0.3 also sets up the R7 fix (Phase 2): a stable byte instance per `fileKey`
makes the `WeakMap` definition-hash memo hit every time.

## Phase 1 — Non-caching high-severity bugs (parallel track, start anytime)

Independent of the caching work; all high severity, most hand-verified (✅).

- **Visualization:** ✔ 1 (GTAO DPR), ✔ 2 (per-frame resize loop), ✔ 3 (gizmo
  raycast), ✔ 4 (double JSON parse) — all fixed 2026-07-11.
- **Grasshopper:** ✔ 45 (README rewritten against the real API), ✔ 47
  (`CommonObject.decode` now fed the full envelope; tests un-pinned from the
  bug), 48 (WASM objects never freed — **deferred: needs a disposal API
  design**, not a mechanical fix), ✔ 49 (malformed input now degrades to a
  per-input `MALFORMED_DEFAULT` instead of aborting the fetch).
- **Core:** ✔ 86 (`composeSignal` rewritten — manual composition, cleanup
  detaches on every path, abort reasons forwarded), ✔ 94 (zip-slip — archive
  paths sanitized in both the decode and fetch halves), 92 (`isBase64` —
  **deferred: the real fix is an explicit encoding declaration in the
  definition API**, an interface decision, not a patch to the sniffer).

Fixed items shipped with regression tests (486 passing, tsc clean, 2026-07-11).

Everything else in ISSUES.md (mediums 5–23, 50–66 non-scheduler, 87–99; lows)
is backlog — pull items when touching their file ("R7, R10–R13 ride along with
whichever item touches their file" applies generally).

## Phase 2 — Scheduler hardening (one file, one PR cluster)

All in `scheduler/solve-scheduler.ts`; these interact, so design together:

1. **46/R3** — check `externalSignal.aborted` in `execute()`; attach abort
   listener at enqueue time and prune the queue. (Dead requests burning full
   compute is a load problem at 1000 users, not just a contract bug.)
2. **115/R4a** — in-flight coalescing: `Map<key, Promise>`. Abort semantics: a
   shared execution aborts only when _all_ subscribers have aborted — must be
   designed with (1), same signal plumbing.
3. **50** — cache hit must supersede an in-flight solve in `latest-wins`
   (hit path returns before `enqueue()` today → stale overwrite).
4. **67** — check already-aborted signal _before_ the cache read.
5. **51** — `Date.now()`/`performance.now()` mix in `cancelAll` durations.
6. **52** — late-settling failure clobbers `_lastError` after supersede.
7. **116/R11** — document response immutability (required by coalescing, see
   cross-check #2).
8. **57/R7** — memoize definition hash (`WeakMap<Uint8Array, string>`); kills
   the double full-pass FNV per solve.

Tests: cover every listed gap (abort-queued, executor call count under
coalescing, cache-hit-while-in-flight, `cancelAll` settle hooks + durations,
mutation of a cache-hit response, errored-response IS cached).

**Why before H1:** the durable cache wraps this scheduler at the app layer;
its dogpile and abort behavior inherit whatever the scheduler does. R4a also
removes most of the L2 cold-key stampede pressure before L2 exists.

## Phase 3 — Keying foundation (H2 — the only package change H1 needs)

Build one canonical serializer + public keying export:

- SHA-256 over a canonical form with **explicit sentinels** for `undefined` /
  `NaN` / `Infinity` (fixes 53, R12), **full-content** binary hashing (fixes
  56/R1 — sampling also defeats the compare-on-hit defense), `Date`/`Map`/`Set`
  handling (55), un-mark after subtree so shared refs ≠ `[Circular]` (54),
  two-part `defHash|treeHash` retained (68).
- Export decision (open question 3): export the full keying helper, not just
  `stableStringify` — R13 requires the F1 bundle viewer to reuse the _exact_
  transform + canonicalize + hash path, which argues for one exported helper.
- Decide L1 migration (cross-check #3): recommended — L1 keys via the same
  canonical serializer (keep a fast hash if profiling demands, but over
  lossless input).

## Phase 4 — Durable L2 cache (H1) + backpressure (R5) — the structural win

App-layer (`selva`), hooked inside/around `runSolvePipeline` between tree
build and `scheduler.solve` (`solve-pipeline.ts:168` — NOT the stale
`+server.ts` locations from the first pass).

Design constraints already banked — treat as requirements, not options:

- Key = `versionId` + SHA-256(canonical inputs) **+ solve-affecting config
  subset + `COMPUTE_CONTRACT_VERSION` (+ Rhino version — decide)** (R8).
- Store the **gzipped envelope**, contract-version-stamped, `algo` already
  stripped (R6; near-CPU-free hits, 5–10× smaller entries).
- **Tiered store is forced:** Redis index + small/hot bodies, blob storage for
  oversized bodies with Redis pointer (Redis notes #1; shares the audit-B5
  Redis; prefixes `solve:` / `rl:`).
- **Single-flight lease** at L2: `SET NX PX`, losers wait or fall through
  (R4b).
- **Per-definition `cachePolicy`** off-switch (R9, memory-confirmed want):
  non-determinism + wide input spaces. Selva-side flag; decide placement
  (definition settings UI vs version metadata) — open question 4 remainder.
- Errored solves **are** stored (decided). Per-org isolation in the key —
  confirm requirement (open question 4 remainder).
- Eviction: `maxmemory` + `allkeys-lru`; no correctness TTL (immutable
  `versionId`), but confirm no path mutates version bytes under a stable id
  (open question 6).
- Observability: `l2_cache` Server-Timing verdict next to `selva_cache`;
  measure hit rates before/after.

**Peer item, same phase:** R5 — `maxConcurrent` sized to the Rhino pool,
queue-depth cap with fast shed (503 + Retry-After), queue-wait deadline. H1
bounds the hit path; R5 bounds the miss path. File as ISSUES.md 117.

**Blocking decisions to resolve at phase start** (CACHING.md open questions):
1 (key on `versionId` — confirm draft-channel overwrite mints new id),
2 (answered: tiered), 3 (answered above: export full helper),
4 (per-org isolation? `cachePolicy` placement?), 6 (no in-place blob mutation).

## Phase 5 — F1: pre-solved downloadable bundle (+ prewarm variant)

Pure packaging on top of Phases 3–4:

- Shape `{ manifest, entries: { [key]: gzipped-envelope } }`; keys derived
  **post-transform** via the exported keying helper (R13).
- Scope honestly: exact-match lookup over **enumerable** inputs only, with
  live-solve fallback — not an offline solver.
- Enumeration UX (open question 5): schema metadata vs admin "generate bundle"
  walker — decide with a user in the loop.
- `cachePolicy` interaction: non-cacheable definitions can't bundle;
  wide-space ones bundle only explicit combos.
- **Prewarm variant** ships alongside: same batch solve, sink = L2 instead of
  a file. Cheap once H1 exists.

## Sequence summary

```
Phase 0 (XS×4)  ──┐
Phase 1 (parallel)│
                  ▼
Phase 2 scheduler ──► Phase 3 keying ──► Phase 4 H1+R5 ──► Phase 5 F1
```

Phases 0 and 1 start immediately and in parallel. 2→3→4→5 is a strict
dependency chain: H1 needs H2's key; the L2 wrapper needs the scheduler's
abort/coalescing semantics settled; F1 needs H1's serialization + keying.
H3 (in-package cache seam) stays deferred unless L1 `cachePolicy` honoring
or in-package L2 becomes a requirement (revisit if `selva_cache` telemetry
shows L1 flooding — R9 note).
