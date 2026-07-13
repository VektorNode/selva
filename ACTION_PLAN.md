# Action Plan — Caching & Audit Issues

Synthesis of `CACHING.md` (strategy + findings, 2026-07-11) and the former
issue tracker's four audits (issues 1–116; all fixed and the file removed
2026-07-12 — issue numbers below still identify the original findings),
cross-checked 2026-07-11. Ordered by dependency, not severity: each phase
unblocks or de-risks the next.

> **2026-07-12 update:** every package-level _bug_ this plan tracked (Phase 0
> item 0.1/0.2, all of Phase 1, all of Phase 2 except item 2, and Phase 3's
> stable-hash bug family) is now fixed in `@selvajs/compute` — see the
> per-phase notes below. What's left in this plan is **app-side work in
> `selva`** (Phase 0.3/0.4, Phase 4, Phase 5), **one package item closed by
> design instead of shipped** (115/R4a, in-flight coalescing — decided
> app-side, Phase 2 item 2), and **Phase 3's two design decisions that were
> never actually bugs** (whether to add SHA-256, and what to export from the
> package barrel) — both still open, see the rewritten Phase 3 below.

## Cross-check results

The overlap table in the former issue tracker's "Caching Re-review" header was accurate:
R1↔56, R2↔114, R3↔46, R4↔115, R7↔57, R11↔116, R12↔53/68, M3↔58 all check out,
and the errored-solve decision (cache them, default on) is recorded
consistently in both files.

**Gaps neither doc connects — original analysis below, current status noted:**

1. **✔ RESOLVED.** Issues 50 and 67 were merged into Phase 2 and are fixed
   (see Phase 2 items 3–4 above) alongside 46/R3; no conflict materialized
   since 115/R4a ended up out of scope for this package.
2. **✔ RESOLVED, differently than planned.** Coalescing (115) stayed
   app-side (closed by design, not shipped in this package), so it never
   escalated the shared-reference issue here. 116's immutability contract
   was still documented on its own merits (Phase 2 item 7) — worth
   revisiting once `selva` actually implements coalescing, since N callers
   sharing one in-flight promise's result is exactly the scenario that
   contract exists for.
3. **✔ RESOLVED — premise updated.** 53–56 and 68 are fixed directly on the
   existing FNV-1a path (not deferred to a future SHA-256 canonical form),
   so there is no residual L1 collision bug and no L1-migration decision to
   make. See the rewritten Phase 3 above for what's still actually open
   there (SHA-256's remaining justification, the export decision).
4. **Partly resolved (2026-07-13).** R5's _queue-bounds_ half now ships in the
   package scheduler: `maxQueueDepth` sheds the newest call with
   `QUEUE_FULL` (`statusCode: 503`, context `{queueDepth, maxQueueDepth}`) and
   `queueWaitMs` sheds a stale queued call with `QUEUE_TIMEOUT` (also 503) —
   both opt-in, both no-ops in `latest-wins`, regression-tested in
   `solve-scheduler.test.ts`. What's still app-side (Phase 4, issue 117):
   sizing `maxConcurrent` to the Rhino pool and mapping these 503-shaped errors
   to an actual HTTP `503 + Retry-After` at the transport layer.
5. **No longer applies.** Issue 83 is fixed (2026-07-12): thrown errors now
   carry a small `inputSummary` (`{param, items, bytes}[]`), never the full
   `dataTree` — see `client/grasshopper-client.ts`. The multi-MB retention
   risk this item warned about is gone on the package side regardless of
   what Phase 4's durable-cache entry shape ends up storing.

---

## Phase 0 — Quick wins (XS each, independent, ship now)

No design decisions, immediate payoff, all verified findings.

| #   | Item                                                                                                                                                                                                                              | Refs    | Where                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| 0.1 | ✔ **DONE 2026-07-11** (package side): stripped in `runSolve`, response type updated, regression test added. Selva-pipeline side still open.                                                                                       | M3, 58  | package `solve.ts:207-215` (+ selva pipeline)           |
| 0.2 | ✔ **Package side DONE 2026-07-11**: `CacheOptions.cacheErroredSolves` shipped (default **true**), both behaviors test-pinned. Selva's misleading log line is still open (lives in the `selva` repo, out of this package's scope). | R2, 114 | selva `client-cache.ts:222-224`, package `CacheOptions` |
| 0.3 | Cache local `.gh` blob by `fileKey` (immutable → cache-forever)                                                                                                                                                                   | M1      | selva `+server.ts:213`                                  |
| 0.4 | Client-side `(inputHash → result)` LRU in the solve session                                                                                                                                                                       | M2      | selva `createSolveSession.svelte.ts`                    |

0.3 also sets up the R7 fix (Phase 2): a stable byte instance per `fileKey`
makes the `WeakMap` definition-hash memo hit every time.

## Phase 1 — Non-caching high-severity bugs (parallel track, start anytime)

Independent of the caching work; all high severity, most hand-verified (✅).

- **Visualization:** ✔ 1 (GTAO DPR), ✔ 2 (per-frame resize loop), ✔ 3 (gizmo
  raycast), ✔ 4 (double JSON parse) — fixed 2026-07-11.
- **Grasshopper:** ✔ 45 (README rewritten against the real API), ✔ 47
  (`CommonObject.decode` now fed the full envelope; tests un-pinned from the
  bug), ✔ 48 (**DONE, before 2026-07-12**: `disposeRhinoObjects()` +
  `GetValuesResult.dispose()` shipped, alias-safe, idempotent, pinned), ✔ 49
  (malformed input now degrades to a per-input `MALFORMED_DEFAULT` instead of
  aborting the fetch).
- **Core:** ✔ 86 (`composeSignal` rewritten — manual composition, cleanup
  detaches on every path, abort reasons forwarded), ✔ 94 (zip-slip — archive
  paths sanitized in both the decode and fetch halves), ✔ 92 (**DONE
  2026-07-12**: `detectBase64Payload` — normalize per forgiving-base64,
  require ≥64 data chars + a canonical round-trip; shipped as a stricter
  heuristic rather than the encoding-declaration API change originally
  envisioned here, with the residual ambiguity documented and test-pinned).

All of Phase 1 is now fixed (764 tests passing repo-wide, tsc clean,
2026-07-12 — supersedes the 486/2026-07-11 count below).

Everything else that used to be in the issue tracker (mediums 5–23,
50–66 non-scheduler, 87–99; lows) was also fixed in the 2026-07-12 pass —
see the git history for `git rm ISSUES.md` for the full findings-to-fix
record. Nothing package-side remains backlog from that tracker; only the
app-side (`selva`) and Phase 4/5 items below are still open.

## Phase 2 — Scheduler hardening (one file, one PR cluster)

All in `scheduler/solve-scheduler.ts`. **Status 2026-07-12: everything below
is done except item 2, which was decided to live app-side instead.**

1. **46/R3 — ✔ DONE.** Queued-phase abort listener settles the item as
   ABORTED, removes it from the queue, fires `onSettle`; regression-tested.
2. **115/R4a — CLOSED BY DESIGN, app-side.** In-flight coalescing
   (`Map<key, Promise>`) was decided to belong in `selva` next to the L2
   lookup, not in this package's scheduler — see `CACHING.md` revalidation
   amendment 4. **This is the one item from this phase still open, and it's
   not a package change.**
3. **50 — ✔ DONE.** A latest-wins cache hit now supersedes the pending/
   in-flight solve (`supersedeCurrent`); regression-tested.
4. **67 — ✔ DONE.** Already-aborted signal rejects ABORTED before the cache
   is consulted; `cancelAll` fires `onSettle` for queued/pending items too.
5. **51 — ✔ DONE.** `cancelAll` measures `Date.now() - startedAt` (same
   clock as `startedAt`); sanity-tested.
6. **52 — ✔ DONE.** Last-result state goes through seq-guarded
   `writeLastState`; a late settle can no longer clobber newer state.
7. **116/R11 — ✔ DONE.** Response immutability contract documented on
   `SolveScheduler.solve()` (cached responses are shared objects; mutating
   one poisons later hits).
8. **57/R7 — ✔ DONE.** Definition hashed exactly once per `solve()`
   (`hashDefinition` call at entry), threaded through `PendingItem
.definitionHash` into `runExecutor` — no second pass. Verified in
   `solve-scheduler.ts:367-368, 590-601`.

Tests: all the listed gaps are covered (abort-queued, cache-hit-while-
in-flight, `cancelAll` settle hooks + durations, mutation of a cache-hit
response, errored-response IS cached, definition-hash-once).

**Why before H1:** the durable cache wraps this scheduler at the app layer;
its dogpile and abort behavior inherit whatever the scheduler does. Item 2
(app-side coalescing) still needs designing before H1, since it removes most
of the L2 cold-key stampede pressure — that work just isn't in this package.

## Phase 3 — Keying foundation (H2 — the only package change H1 needs)

**Status 2026-07-12: the bug family this phase was going to fix along the way
is already closed on the existing FNV-1a path** (`stable-hash.ts`) —
explicit `undefined`/`NaN`/`Infinity` sentinels (53), full-content binary
hashing not sampled (56), `Date`/`Map`/`Set` via `toJSON` (55), scoped
cycle-guard so shared refs don't collide with `[Circular]` (54), two-part
`defHash|treeHash` key retained (68) — all test-pinned. **L1 does not need
migrating; it already keys off the lossless canonical form.**

**Still genuinely open — this phase's actual remaining scope:**

- SHA-256 canonical form was never built; `stable-hash.ts` still hashes with
  32-bit FNV-1a throughout (`fnv1a`/`fnv1aBytes`). Whether SHA-256 is still
  wanted is now a **narrower question than originally framed** — it was
  motivated by the L1 collision bugs, which are fixed; the remaining case for
  it is birthday-collision risk at scale and F1's need for a stable public
  hash. Revisit whether FNV-1a's current collision profile (bounded L1 size)
  is acceptable before building a second hash path.
- Export decision (open question 3) — ✔ **RESOLVED 2026-07-13.**
  `stableStringify`, `hashDefinition`, and `hashSolveInput` are now exported
  from both barrels (`src/features/grasshopper/index.ts` and
  `src/grasshopper.ts`), along with the `DefinitionRef`/`SolveDefinition`/
  `isDefinitionRef` surface those signatures need. The FNV plumbing
  (`fnv1a`/`fnv1aBytes`) and the pre-hashed fast path
  (`hashSolveInputForDefinition`) stay `@internal` and are stripped from the
  emitted `.d.ts`. The key-parity contract (a durable/bundle key must
  canonicalize identically to the scheduler's) is documented on
  `stable-hash.ts`. R13/F1 can now reuse the exact hash path. This unblocks
  Phase 4's blocking decision 3.

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

**Peer item, same phase:** R5 — the scheduler mechanism (queue-depth cap with
fast shed, queue-wait deadline) **landed package-side 2026-07-13**
(`maxQueueDepth` / `queueWaitMs` → `QUEUE_FULL` / `QUEUE_TIMEOUT`, both 503-
shaped). Remaining app-side under issue 117: `maxConcurrent` sized to the Rhino
pool, and translating the scheduler's 503-shaped errors to a real HTTP
`503 + Retry-After`. H1 bounds the hit path; R5 bounds the miss path.

**Blocking decisions to resolve at phase start** (CACHING.md open questions):
1 (key on `versionId` — confirm draft-channel overwrite mints new id),
2 (answered: tiered), 3 (**✔ resolved 2026-07-13** — keying helpers exported
from the barrel, see Phase 3's export-decision item above),
4 (per-org isolation? `cachePolicy` placement?), 6 (no in-place blob mutation).

## Phase 5 — F1: pre-solved downloadable bundle (+ prewarm variant)

Pure packaging on top of Phases 3–4:

- Shape `{ manifest, entries: { [key]: gzipped-envelope } }`; keys derived
  **post-transform** via the exported keying helper (R13) — blocked on
  Phase 3's still-open export decision.
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
