# Caching audit — 2026-07-30

> **Status: documentation defects fixed (D1–D3); F1 measured and FIXED 2026-07-30 — it was a live
> GPU leak; F2 remains open (= Phase 5 of [solve-package](./solve-package.md)).** A full read of
> every cache in the solve path, done
> because the topic had become hard to follow. The audit's original conclusion was "**the caches are
> individually sound; the documentation was the problem**" — mostly right, and wrong in one place:
> measuring F1 found a real unbounded GPU leak. Every cache carries an audit label, a stated
> rationale, and usually the name of the bug it prevents. What did not exist was one true map — and
> the one defect that map exposed was an interaction _between_ two individually-sound caches, which
> is precisely the class of bug a per-cache reading cannot find.
>
> Scope: 10 Selva-owned caches (5 browser, 5 server) plus 2 owned by Rhino.Compute. Two real code
> findings — F1 since confirmed as a live GPU leak and fixed
> ([§F1](#f1-the-edge-cache-and-geometry-cache-now-contradict-each-other),
> [§F2](#f2-two-adjacent-tiers-key-the-same-solve-differently)), one operational note
> ([§F3](#f3-l1s-worst-case-is-256-mb--16--4-gb)), three documentation defects ([§D1](#d1-docscachingmd-is-false-in-its-first-two-claims)–[§D3](#d3-three-situations-have-no-eviction-trigger-and-nothing-says-so)).

## Why this was confusing — three sources, three answers

| Source                                                                               | Claims                                                                 | Accurate?           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------- |
| [docs/self-hosting/concepts/caching.md](../../docs/self-hosting/concepts/caching.md) | "**three independent caches**"; "**Nothing is cached in the browser**" | **No**              |
| [architecture.ts](../../packages/website/src/lib/architecture.ts)                    | 12 entries across 5 tiers, each with key/policy/invalidation/files     | Yes, one stale path |
| The code                                                                             | 10 Selva-owned caches + 2 owned by Rhino.Compute                       | —                   |

`Caching.md` is the page a person reads, and both of its headline claims are false. It documents only
the three Rhino.Compute-facing caches and predates the client memo, L2, the definition-byte cache, and
all four browser caches. That is the root cause of the confusion — not the code.

## The distinction that makes all of it legible

**"Cache" means two unrelated things here.** Keeping them apart answers most freshness questions
before they are asked:

- **GPU-resource caches** (geometry, texture, edge line-geometry, edge segments) hold live
  `BufferGeometry` / `Texture` with resident GPU buffers. They exist because the viewer **rebuilds the
  whole scene every solve**. They must dispose on eviction. Freshness is not the concern; ownership is.
- **Solve-result caches** (M2, L1, L2, definition bytes) hold work-products to skip work. These are the
  only ones where "is this stale?" is a meaningful question.

## Inventory

### Browser — 5 caches, all module-level singletons except M2, per tab

| Cache              | File                                 | Keyed on                                        | Bound             | Survives a solve?                                                                                             |
| ------------------ | ------------------------------------ | ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| M2 solve memo      | `session/solve-memo.ts`              | stable key-sorted hash of input values          | 16 entries, LRU   | Yes — cleared on definition change                                                                            |
| Geometry           | `parse/webdisplay/geometry-cache.ts` | **content** — FNV-1a over sampled wire windows  | 256 MiB           | Yes, deliberately                                                                                             |
| Texture            | `parse/webdisplay/texture-cache.ts`  | URL (>256 chars → FNV-1a hashed)                | 64 entries, LRU   | Yes                                                                                                           |
| Edge segments      | `render/edges/extraction.ts:94`      | **content**                                     | 128 MiB           | Yes                                                                                                           |
| Edge line-geometry | `render/edges/cache.ts:82`           | **object identity** (WeakMap) + threshold angle | none — refcounted | No — released by `clearScene` ([§F1](#f1-the-edge-cache-and-geometry-cache-now-contradict-each-other), fixed) |

M2 is the only browser cache that is **per-driver-instance**, not module-level
(`session/drivers/request-response.ts:33`).

### Server — 5, per process

| Cache            | File                           | Keyed on                                       | Bound                                      | Default            |
| ---------------- | ------------------------------ | ---------------------------------------------- | ------------------------------------------ | ------------------ |
| Warm client      | `client-cache.ts`              | compute server `id` (never the URL — ADR 0004) | 16, LRU, no TTL                            | **on**             |
| L1 response      | inside `SolveScheduler`        | 32-bit FNV hash                                | 20 entries / 5 min / 256 MB **per client** | **on**             |
| Definition bytes | `definition-byte-cache.ts`     | version id (immutable UUID)                    | 256 MB, no TTL                             | **on**             |
| L2 durable       | `memory-solve-cache.ts`        | `orgId · definitionId · versionId · inputKey`  | per-def count quota + 512 MB global        | **off**            |
| Single-flight    | `solve-cache-single-flight.ts` | caller-composed (raw `{inputs, values}`)       | settle-driven, none retained               | inert unless L2 on |

**L2 is doubly gated off:** it needs `SOLVE_CACHE_PROVIDER=memory` _and_ a non-zero quota
(`SOLVE_CACHE_DEFAULT_MAX_ENTRIES` defaults to `0`), _and_ only live-channel org-scoped solves with no
explicit version are eligible.

### Rhino.Compute — 2, not ours

The VM's own definition cache (pointer reuse) and `cachesolve` result cache. Owned by the compute
server; Selva only sends flags. Purged via `POST cache/purge`, per child process.

## Key strength scales with blast radius — deliberately

Worth knowing because it looks inconsistent until you see why:

- **L1** uses a 32-bit FNV hash — fine for a 20-entry in-process Map.
- **L2** uses SHA-256 **plus** an `inputHash` re-verified on every read
  (`solve-cache-envelope.ts:29-34`, enforced `solve-pipeline.ts:527`). Two independent layers, because
  `solve-cache-key.ts:4-7` records that a collision serving one user's geometry to another
  **already shipped once**. A corrupt or mismatched entry is treated as a miss and re-solved with a
  warning — _"a silently-poisoned cache would otherwise look like an eternal cold key."_

## Invalidation is almost entirely absent — and that is intentional

Only **two** production invalidation paths exist in the whole system:

1. **M2** clears on definition change (`session/solve-session.ts:158-162` → `driver.clearCache()`).
2. **Warm client** evicts on config change/removal (`evictChangedServers.ts:30,38`). Required, not
   optional: the cache keys on `id`, so a rotated URL or apiKey keeps the same key with stale
   connection details (`client-cache.ts:26-29`, ADR 0004).

Everything else relies on **immutable keys instead of invalidation**:

> "**Version keying = no invalidation.** Publishing mints a new `versionId` → fresh keyspace; rollback
> re-hits old entries; there is nothing to invalidate."
> — `memory-solve-cache.ts:18-20`, `platform/src/solveCache/interface.ts:26-27`

The definition-byte cache is the same story (`definition-byte-cache.ts:26`: "No TTL: version ids are
immutable, so a cached entry can never go stale"), and its `clear()` is a test seam with no production
caller. Same for L2's `clear()`.

Once you know this, most freshness questions answer themselves — which is exactly what `Caching.md`
fails to convey.

## Findings

### F1. The edge cache and geometry cache now contradict each other

**✅ MEASURED AND FIXED 2026-07-30. It was a live GPU leak, not merely latent.** The audit's own
call — "needs measurement, not a speculative fix" — was the right one: measuring turned a suspected
interaction into a confirmed unbounded leak, and the measurement then pinned the fix to four lines.
Original finding preserved below; the outcome follows it.

`render/edges/cache.ts` is identity-keyed (WeakMap on the source `BufferGeometry`), unbounded, and
relies on refcounting plus WeakMap reachability. Its sibling's comment states the assumption
(`extraction.ts:88-89`):

> "The viewer rebuilds every `BufferGeometry` each solve, so identity caches never hit across solves."

**That assumption is now false.** The content-keyed geometry cache returns _the same_
`BufferGeometry` instance across solves (`batch/merge.ts:34,104,166,201`), and `clearScene` skips
disposing cache-tagged geometries (`render/three-helpers.ts:155-158`). So for cached-geometry meshes,
identity **is** preserved, and those edge entries now survive solves — in a cache with **no size
bound**.

Compounding it, `edges/cache.ts:16-18` documents an accepted stranded-refcount path:

> "overlays disposed by whole-scene clears (which bypass removeEdges) just leave a refcount behind on
> an entry that becomes unreachable together with its source geometry"

The "becomes unreachable" premise is what the geometry cache now breaks — a cache-tagged source
geometry is reachable from the geometry cache for up to 256 MiB worth of entries. **Needs
measurement, not a speculative fix.**

#### Outcome — measured 2026-07-30

Both suspicions were confirmed, and they turned out to be two distinct failures:

| Case (8 meshes × 50 solves)     | Live entries        | Total refCount   |
| ------------------------------- | ------------------- | ---------------- |
| Unchanged content, re-solved    | 8 (bounded)         | **400** — leaked |
| Changing content (slider scrub) | **400** — unbounded | 400              |

The scrub row is the real leak: 400 distinct `LineSegmentsGeometry` objects alive after 50 solves,
each holding resident GPU buffers, in a cache with no size bound. The unchanged-content row leaks
only refcounts, but those permanently poison their entries — an entry at refCount 20 absorbs the
next 20 legitimate `removeEdges` calls without ever disposing.

**Root cause, precisely.** `clearScene` never called `removeEdges`; it disposed and detached the
subtree directly, so `releaseEdgeGeometry` never ran and no refcount was decremented. That was
survivable only while the WeakMap key went unreachable each solve — which the geometry cache ended.

**Fix:** a `releaseEdgeGeometryFor(geometry)` hook in `render/edges/cache.ts`, called from
`clearScene` for each mesh geometry it disposes. Four lines plus the hook. The stale premise in
`edges/cache.ts:16-18` is replaced by a docblock recording why it expired, so the next reader does
not re-derive it. Regression tests in `render/__tests__/edges-cache-growth.test.ts`, verified red
without the fix (63 entries vs 3) and green with it, plus two controls covering the normal
`removeEdges` refcount path so an over-eager release cannot pass.

**Rejected: giving this cache its own LRU byte budget.** Built, then cut before landing. It only
bites when something bypasses _both_ `removeEdges` and `clearScene`, and no such path exists in the
code — every attempt to exercise eviction required hand-detaching overlays in a test. It added a
parallel `Map`, strong references to source geometry that partly defeat the WeakMap, and a
skip-if-referenced eviction rule with its own edge case. The justification offered at the time was a
principle ("makes the invariant non-load-bearing"), not a demonstrated failure — which is the
signature of speculative machinery. **If a future path is found that bypasses both, revisit; do not
add the budget pre-emptively.**

### F2. Two adjacent tiers key the same solve differently

Single-flight coalesces on the **raw** `{inputs, values}` (`+server.ts:347-349`), while L2 keys on the
**transformed** input tree (`solve-cache-key.ts:11-14`, R13). Two tiers, one solve, two preimages.

Arguably fine — they guard different things (dogpile vs. result reuse) — but it means two inputs that
are raw-different yet transform-identical coalesce as separate flights and then both hit the same L2
key. There are now **three** stable-hash implementations in the solve path: `stableInputKey` (M2),
`solve-cache-key.ts` (L2), `stable-hash.ts` (compute/L1). This is what
[solve-package.md](./solve-package.md) Phase 5 should reconcile — and it should reconcile
deliberately, not just merge them.

### F3. L1's worst case is 256 MB × 16 = 4 GB

The L1 byte budget (`COMPUTE_RESPONSE_CACHE_MB`, default 256 MB) is **per warm client**, and the warm
client cache holds up to 16. Noted in `limits.ts:220-230`, absent from every operator-facing doc.
Not a defect — a documentation gap with a real memory consequence for a multi-server deployment.

## Documentation defects

### D1. `docs/Caching.md` is false in its first two claims

"There are **three independent caches**" and "**Nothing is cached in the browser**". Both wrong, and
the second is the more harmful — there are four browser caches, one of which (M2) directly affects
whether a user sees a fresh result. Its settings table lists three env vars as if that were the whole
surface. **Rewrite required**, not a patch.

### D2. `architecture.ts` has one stale path

`architecture.ts:159` cites `packages/compute/src/features/visualization/webdisplay/texture-cache.ts:12`
— moved by the visualization refactor to `packages/visualization/src/parse/webdisplay/`. The rest of
the file is accurate and well maintained (the client-memo entry already has post-refactor paths).

### D3. Three situations have no eviction trigger, and nothing says so

Consequences of the version-keying design that are correct but undocumented:

1. **Definition delete** — L2 and byte-cache entries stay resident until they age out under the byte
   budget.
2. **Lowered `solveCacheLimit`** — no eviction; the quota applies to subsequent writes only.
3. **Same-id compute server upgraded to a new Rhino version** — **the risky one.** `computeServerId` is
   folded into the L2 hash (`solve-cache-key.ts:44-50`), so a _different_ server id yields a different
   key. Upgrading Rhino _in place_ on the same server id keeps the key, and L2 can serve geometry
   produced by the old Rhino version. Mitigation today is manual: rotate the server id, or clear the
   cache by restarting the process. Worth an explicit operator note.

## Recommended follow-ups

Ordered by value.

1. ~~**Rewrite `docs/Caching.md`** around the 5 tiers with a "what invalidates this" column. Fixes D1,
   D3.~~ ✅ **DONE** — see the status note below.
2. ~~**Fix the stale path** in `architecture.ts:159`. One line, fixes D2.~~ ✅ **DONE.**
3. ~~**Measure F1** — instrument the edge line-geometry cache's entry count across many solves with
   cached geometry. Fix only if it grows unboundedly.~~ ✅ **DONE 2026-07-30 — it did grow
   unboundedly (400 entries over 50 solves), and is now fixed.** See [§F1's outcome](#outcome--measured-2026-07-30).
   This was the only item that turned out to be a live bug.
4. **Reconcile the three hashes** — [solve-package.md](./solve-package.md) Phase 5, informed by F2.
   ⬜ Still open. Note two of the three now live in the same package (`solve/client` and
   `solve/server`), so the merge is local rather than cross-package.
5. ~~**Document F3's 4 GB worst case** in the operator-facing scaling docs.~~ ✅ **DONE** — covered in
   `Caching.md` twice (the L1 section's ⚠️ note and the "which should I turn on?" table).

### Status re-check — 2026-07-30, after the `@selvajs/solve` extraction

Items 1, 2 and 5 were found already complete when picked up. Re-verified rather than assumed:

- **D1's two false claims are gone** from `docs/Caching.md` (grep: 0 occurrences of either). The page
  is now organized around the 5 tiers, separates GPU-resource from solve-result caches up front, and
  has an "invalidation is almost entirely absent" section.
- **D3's three lingering-entry situations are all documented**, including the risky third one
  (in-place Rhino upgrade under the same server id) with its mitigation.
- **D2's stale path is corrected** — `architecture.ts` now points at
  `packages/visualization/src/parse/webdisplay/texture-cache.ts:12`, which exists.
- **Every number in `Caching.md` re-verified against the code** after the solve extraction moved the
  server-side caches: memo 16 (`solve-memo.ts:86`), L1 20 entries / 5 min
  (`client-cache.ts:241`), warm clients 16 (`client-cache.ts:153`), texture 64
  (`texture-cache.ts:12`), geometry 256 MiB (`geometry-cache.ts:27`), edge segments 128 MiB
  (`options.ts:76`), and all seven env-var defaults in `limits.ts:275-305`. All correct. The
  `limits.ts` link still correctly points into `@selvajs/server` — limits stayed there.

**Three corrections made:**

1. The "caches you don't configure" table in `Caching.md` listed the two edge caches on one row as
   "128 MiB / refcounted", which read as though both were bounded. Split into two rows, with the
   line-geometry cache marked **no size cap** — that is F1's subject, and a reader auditing memory
   should see it in the inventory rather than only in this audit. A short F1 caveat now sits beside
   the GPU-cache explanation, framed as memory-not-correctness and linked back here. _(Superseded
   2026-07-30: F1 is fixed, so both rows now describe bounded caches and the caveat records the
   resolution. The framing above is retained as the record of what the audit found at the time.)_
2. `Caching.md` said the GPU caches all "key on content, so they cannot serve the wrong geometry" —
   true of the conclusion, wrong about the reason now that one of them keys on identity. Reworded to
   claim the guarantee without the inaccurate premise.
3. **The cache count was wrong in this audit and inherited by `Caching.md`.** This document's browser
   section was headed "4 caches" while listing 5, so the totals read "11 Selva-owned" where the
   inventory shows **10** (5 browser + 5 server). Fixed in both places.

**Left alone, flagged rather than guessed:** "5 tiers" comes from `architecture.ts`, which groups by
`layer` and lists 12 cache entries; this audit and `Caching.md` group by 3 locations
(browser / Selva server / Rhino.Compute). Two taxonomies over the same caches, so the counts will keep
looking inconsistent between the three sources. Reconciling them means editing `architecture.ts`'s
grouping, which is a bigger change than a doc pass and was out of scope here.
