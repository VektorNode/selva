# Caching simplification — three names, two sizes

> **Status: ✅ SHIPPED 2026-07-30 — all four phases.** Archived; this is the record of what was
> done, not open work.
>
> - **Phase 1** — single-flight decoupled from L2, now unconditional and keyed on the transformed
>   tree. Cancellation is decided by whether a flight is shared, not by cache config.
> - **Phase 2** — memory L2 backend deleted (`memory-solve-cache.ts`, `solve-cache-envelope.ts`,
>   `solve-cache-key.ts`, the pipeline branches, three `SOLVE_CACHE_*` vars). `ISolveResultCache`
>   kept as the Redis seam, with a test backend so it stays proven.
> - **Phase 3** — the three renames landed, old names honoured for one minor version with a boot
>   warning. `.env.example`, `docs/Caching.md` and `architecture.ts` rewritten around the three names.
> - **Phase 4** — hit/miss/eviction counters added to the scheduler, aggregated across warm clients,
>   surfaced as a Caching panel on `/admin/compute`.
>
> Two deviations from the plan as written, both deliberate: the `ComputeLimits` **fields** were
> renamed alongside their env keys (`definitionCacheTtlMs` → `remoteDefinitionCacheTtlMs` was the
> same misleading name the rename existed to fix), and the coalesce key folds in the compute-server
> id, since two servers can run different Rhino versions and return different geometry.
>
> Superseded Phase 5 of [solve-package](./solve-package.md) (unify the three stable hashes) — see
> [§Why not Phase 5](#why-not-phase-5). Absorbed the open code findings of
> [caching-audit-2026-07](./caching-audit-2026-07.md) §F2. §F1 (edge-cache growth) was **independent
> of this plan** and was fixed separately (2026-07-30) — it was a live GPU leak.
>
> **Goal, in the user's words:** _"very simple, very easy to configure… it should always be in the
> name."_ Not "fewer lines" as an end in itself — the line count falls out of collapsing three
> overlapping tiers into one honest one.

## The problem, stated once

Ten caches sit on the solve path. Naming them is the actual problem, not counting them:

| What a person wants to cache | What the code calls it                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| the definition               | definition-byte cache, remote-definition cache, pointer reuse, `DEFINITION_CACHE_TTL_MS` |
| "solved this before?"        | M2, L1, L2, `cachesolve`                                                                 |
| the result to return         | _same as above — it is one lookup, not two_                                              |

Three intents, ten names, none of which say which intent they serve. That is the complaint. Two of
those names are even the same words for different caches: `definition-byte-cache.ts` (uploaded, keyed
by version) and `remote-definition.ts` (URL-sourced, TTL'd) are both "the definition cache", and the
env var named after them governs the second.

**Configuration is worse than the naming.** To enable the durable solve cache an operator must set
`SOLVE_CACHE_PROVIDER=memory` **and** `SOLVE_CACHE_DEFAULT_MAX_ENTRIES` to non-zero **and** be
solving on the live channel with no explicit version pin. Miss any one and nothing happens — no
warning, no log line, no diagnostic. Three gates dressed as three settings. `…MAX_ENTRIES=0` in
particular reads like a size and acts like an off-switch.

**Verified 2026-07-30**, because the plan's shape depends on it:

- `packages/selva/.env` sets **no cache variable at all** — every deployment in this repo runs pure
  defaults, i.e. L2 off.
- The app is `@sveltejs/adapter-node` — a long-lived process. In-process caches genuinely persist
  between requests. This is why L1 and the definition cache work today, and it is the fact that makes
  L2's in-process backend redundant rather than merely unused.

## The three names

Everything user-facing collapses to three, each named for **what it holds**:

| Name                 | Holds                                   | Bound by                                     |
| -------------------- | --------------------------------------- | -------------------------------------------- |
| **Definition cache** | `.gh` bytes — see the two sources below | `COMPUTE_DEFINITION_CACHE_MB` — 256 MB       |
| **Solve cache**      | results, keyed by definition + inputs   | `COMPUTE_SOLVE_CACHE_MB` — 256 MB per server |
| **Viewer cache**     | geometry/textures with live GPU buffers | constants — 256 MiB / 128 MiB / 64           |

`L1` / `L2` / `M2` / `single-flight` / `byte cache` / `envelope` stop being user-facing concepts.
They remain as internal tiers of the three names above; nobody configuring Selva should meet them.

The viewer cache stays unconfigurable on purpose: it is bounded by GPU memory, it holds live
`BufferGeometry`, and it is not a freshness question but an ownership one
([caching-audit §The distinction](./caching-audit-2026-07.md#the-distinction-that-makes-all-of-it-legible)).
Nobody tunes it from a `.env`, and exposing a knob would imply they should.

### The definition cache has two sources, and only one can go stale

Worth stating in the docs as one sentence of nuance rather than a fourth name to learn — a definition
reaches a solve one of two ways, and they cache differently **because their sources differ in
mutability**:

| Source                                    | Keyed on                    | TTL       | Why                                              |
| ----------------------------------------- | --------------------------- | --------- | ------------------------------------------------ |
| **Uploaded** to Selva (`local:<guid>`)    | version id (immutable UUID) | **none**  | a published version's bytes can never change     |
| **Remote URL** (`definitionUrl` is a URL) | the URL                     | **5 min** | whoever owns the URL can swap the file under you |

The uploaded path is `definition-byte-cache.ts` in `@selvajs/solve`; the remote path is
`remote-definition.ts` in `@selvajs/server`, sitting behind the SSRF guard and the size cap, capped at
50 entries and evicting 10 at a time. Both are live: the solve route picks between them at
[`+server.ts:129`](../../packages/selva/src/routes/api/compute/+server.ts#L129) on whether
`definitionUrl` starts with `local:`.

**This is the whole reason `DEFINITION_CACHE_TTL_MS` must be renamed.** Two unrelated caches are
currently both called "the definition cache" and the TTL belongs to the _less_ authoritative-sounding
one. Worse, the one it does not govern is precisely the one where a TTL would be a bug: version ids
are immutable, so expiring those entries would only ever throw away valid work.

The remote fetcher stays where it is. It is inseparable from the SSRF guard and the fetch deadline —
those three are one operation ("safely obtain bytes from an untrusted URL"), not a cache that happens
to live next to a guard.

## Two knobs, both sizes

**Verified 2026-07-30: not one cache variable is set anywhere.** Every cache var in
`packages/selva/.env`, `.env.example`, `templates/.env.example` and `packages/compute/.env.example`
is commented out. The only uncommented solve-path var in the real `.env` is
`MAX_SOLVE_DURATION_MS=300000`, which is a deadline, not a cache.

That kills the _gates_ — the three `SOLVE_CACHE_*` vars have never been exercised and go with the
backend they configure. It does **not** kill the two budgets, which stay:

```bash
COMPUTE_DEFINITION_CACHE_MB=256   # how much .gh data to keep warm
COMPUTE_SOLVE_CACHE_MB=256        # how many solve results to keep warm, per compute server
```

Both default on. `0` disables one. **Every knob is a size; none is a gate.** No provider to select,
no quota that is secretly a switch, no combination lock.

### Why these two stay when the viewer caches don't

The distinction is _whose memory is at risk_, and it is the reason "just make them constants" is the
wrong call for these two:

- **Viewer caches** are bounded by the user's GPU, in the user's browser tab, one tab at a time. An
  operator cannot act on them and has no reason to. Constants, as today.
- **These two are heap on the operator's server**, shared by every concurrent user. And the solve
  cache is **per warm compute client** — worst case 256 MB × 16 clients = **4 GB**
  ([caching-audit §F3](./caching-audit-2026-07.md#f3-l1s-worst-case-is-256-mb--16--4-gb)). That is a
  number a deployment on a small VPS may genuinely need to turn down, and no code change should be
  required to do it.

Un-set-ness is evidence the _defaults are good_, not that the knob is worthless: a memory-pressure
escape hatch is unused right up until the day it is the only thing standing between an operator and
a code fork. Two sizes with sane defaults cost nothing to keep — unlike a gate, which costs a
support conversation every time someone sets it and nothing happens.

### What that removes

| Variable                           | Fate                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| `SOLVE_CACHE_PROVIDER`             | deleted with the L2 backend (Phase 2)                |
| `SOLVE_CACHE_DEFAULT_MAX_ENTRIES`  | deleted with the L2 backend (Phase 2)                |
| `SOLVE_CACHE_MAX_TOTAL_MB`         | deleted with the L2 backend (Phase 2)                |
| `COMPUTE_DEFINITION_BYTE_CACHE_MB` | **kept, renamed** → `COMPUTE_DEFINITION_CACHE_MB`    |
| `COMPUTE_RESPONSE_CACHE_MB`        | **kept, renamed** → `COMPUTE_SOLVE_CACHE_MB`         |
| `DEFINITION_CACHE_TTL_MS`          | **kept, renamed** → `REMOTE_DEFINITION_CACHE_TTL_MS` |

Three of the ten cache-adjacent vars disappear — every one of them a gate. The three survivors are
renamed so each says what it holds. `COMPUTE_REUSE_DEFINITION_CACHE` and
`COMPUTE_SERVER_CACHESOLVE` stay as env vars: they are **flags sent to Rhino.Compute**, not Selva
caches, and `COMPUTE_REUSE_DEFINITION_CACHE` in particular is a genuine compatibility switch — a
stock rhino.compute (rather than the VektorNode fork) silently returns empty geometry on a stale
pointer, so an operator must be able to turn it off. They move under a **Rhino.Compute server**
heading in `.env.example`, away from Selva's own caching.

### The three renames

| Today                              | Becomes                          | Why                                                                        |
| ---------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `COMPUTE_DEFINITION_BYTE_CACHE_MB` | `COMPUTE_DEFINITION_CACHE_MB`    | "byte" described the eviction policy, not the content                      |
| `COMPUTE_RESPONSE_CACHE_MB`        | `COMPUTE_SOLVE_CACHE_MB`         | it caches solves; "response" is the transport's word                       |
| `DEFINITION_CACHE_TTL_MS`          | `REMOTE_DEFINITION_CACHE_TTL_MS` | **it is not about the definition cache** — it TTLs remote-URL fetches only |

The third is the trap worth fixing: two unrelated things are currently both called "the definition
cache," and the one that sounds authoritative is the one that isn't. It survives as a var because
remote fetches are a network concern with a real reason to tune.

The `COMPUTE_*` prefix is kept deliberately — the repo already splits `SELVA_*` (platform identity
and policy: keys, branding, flags, tenancy, providers) from `COMPUTE_*` (everything on the solve
path: concurrency, queueing, rate limits, caps, and these budgets). Caching is solve-path, so the
rename **narrows an existing convention** rather than introducing a third one.

Since nothing sets any of them, migration is trivial: honour the old names for one minor version with
a boot warning, then let them lapse. **No CLI work is needed** — an earlier draft specified a
`renameEnvKeys` helper for `selva migrate`, which is machinery for a population of zero. If
`selva doctor` should mention anything, it is a one-line warning when a deleted or old-name var is
found: a check, not a mutation.

## What gets deleted, and what emphatically does not

### Deleted — the redundant L2 backend (~800 lines)

**The finding that justifies it:** L1 and L2 cache the same thing, in the same process, for the same
lifetime. L1 keys on `(definitionHash, transformedTree)` in a `Map`; L2 keys on
`(org, definition, version, sha256(transformedTree + config))` — and its only shipping backend is
`createMemorySolveResultCache`, also a `Map`, in the same heap, dying at the same restart. L1 is
consulted first, so **L2 can only ever serve what L1 already evicted.** It buys a longer TTL and
per-definition quotas at the cost of a second serialization format and a dual-path pipeline.

Trace of where the ~800 lines went, because it explains why this is worth undoing. One decision — _an
L2 hit should skip re-serialization_ — produced:

- a hand-rolled binary container (4-byte BE length prefix, JSON header, gzipped body) —
  `solve-cache-envelope.ts`;
- optional `SolveEnvelope.result`, which every downstream consumer must now handle;
- a second envelope-construction path (`buildEnvelopeFromCacheEntry`) duplicating header, metric and
  Server-Timing assembly;
- an `inputHash` re-verification layer, because a hash-keyed store collided once and served one
  user's geometry to another.

Removed: `memory-solve-cache.ts` (203), `solve-cache-envelope.ts` (98), `solve-cache-key.ts` (84),
the L2 branches in `solve-pipeline.ts` (~120 incl. `buildEnvelopeFromCacheEntry`),
`solveCache.server.ts`'s backend wiring, and the L2 test suites.

### KEPT — `ISolveResultCache` (the correction to my earlier advice)

I previously said "delete L2." That was **half wrong**, and the half that was wrong is the important
half.

`packages/platform/src/solveCache/interface.ts` is deliberately async-from-day-one, stores opaque
bytes, and is documented as best-effort precisely so a network backend can drop in without any call
site changing shape. That is the one piece of this whole subsystem that is **correct for scaling**,
and it costs nothing to keep — it is an interface plus a `NoopSolveResultCache`.

**Why it matters here:** `adapter-node` means one long-lived process. Scale to N instances behind a
proxy and every in-process cache's hit rate divides by N — a user's second request lands on a
different box and misses everything local. The tier that survives horizontal scaling is the one on
the Rhino VM (`cachesolve`, shared by every instance, already on). When in-process caching genuinely
stops being enough, the answer is Redis behind this interface — one line of wiring, not a redesign.

So: **keep the seam, delete the backend that duplicates L1.** The pipeline hook
(`SolvePipelineCacheHook`) stays too — it is the injection point a Redis backend would use.

### KEPT — single-flight, and made unconditional

Today `solveCacheSingleFlight` is gated on `solveCache != null`, so it is inert in every deployment.
That is backwards: **dogpile protection is most valuable when there is no shared result cache**,
because that is exactly when N identical concurrent solves each hit Rhino.

Two reasons beyond the obvious, both verified:

1. **It currently changes cancellation semantics as a side effect.**
   [`+server.ts:356`](../../packages/selva/src/routes/api/compute/+server.ts#L356) — a coalesced solve
   gets a non-aborting signal so one caller disconnecting can't 499 every waiter. So whether a client
   disconnect cancels the upstream Rhino solve depends on whether a cache happens to be enabled. That
   coupling is wrong regardless of what happens to L2.
2. **It keeps `adaptEnvelopeToEncoding` load-bearing.** I earlier listed that function as
   collateral from L2 — **wrong.** It exists because single-flight hands N waiters one envelope baked
   from the _first_ caller's `Accept-Encoding`; a non-gzip client joining a gzip flight would get bytes
   it cannot decode. That is a single-flight correctness requirement, not an L2 one. It stays.

**Change:** coalesce every solve keyed on `(definition identity, transformed tree)`, not on the raw
`{inputs, values}`. This closes audit §F2 (two adjacent tiers keying the same solve differently) by
deleting one of the two keys rather than reconciling them.

### KEPT — `solveCacheLimit` on the definition record

Per-definition control ("remember the last N solves of this definition") is real product surface and
already lives in the definition editor. **It is also persisted**, which I initially missed:

- `packages/providers/local/src/data/LocalDefinitionStore.ts:226`
- `packages/providers/supabase/src/data/SupabaseDefinitionStore.ts:459,492,517`
- migration `20260713140000_selva_solve_cache_limit.sql`
- `platform/src/definitions/{types,schemas}.ts`, `definitionStoreSuite.ts`
- `DefinitionEditDrawer.svelte`

So it is a **column in two stores plus a shipped Supabase migration** — removing it is a data
migration, not a deletion. It stays as-is and keeps its meaning: with the memory L2 gone it is
dormant until a shared backend is wired, at which point it is exactly the right per-definition knob.
Its field label should say so rather than implying it does something today.

## Why not Phase 5

[solve-package](./solve-package.md) Phase 5 proposes unifying the three stable-hash implementations
(`stableInputKey` M2, `solve-cache-key.ts` L2, `stable-hash.ts` L1) behind one canonicalizer.

**Skip it.** Two reasons:

1. **This plan deletes one of the three.** L2's SHA-256 key derivation goes with the backend, and
   single-flight adopts L1's key. Two remain, in different packages, at different blast radii —
   exactly the split [§C1b](./solve-package.md#c1b-the-schedulers-l1-cache-stays-in-selvajscompute)
   says to preserve.
2. **Merging would hide the finding rather than fix it.** The real problem was never that three
   canonicalizers might disagree (established earlier: no param type produces a `Date` or `bigint`,
   so the divergences are latent). It was that **two tiers cached the same thing**. A shared key
   derivation would have made that redundancy harder to see, not easier.

## Phases

Each phase leaves the tree green and is independently reviewable.

### Phase 1 — decouple single-flight from L2

No deletions. Smallest reviewable unit, and it stands on its own merits.

- Coalesce unconditionally, keyed on `(definition identity, transformed tree)`.
- Decouple the abort-signal choice from cache configuration — decide it from "is this request
  coalesced with others", which is now always potentially true.
- Keep `adaptEnvelopeToEncoding` (now clearly single-flight's, not L2's).

**Risk:** this is the only phase that changes live behaviour on a default deployment. Every solve now
passes through the coalescer. Verify: two identical concurrent solves produce one Rhino call; a
disconnect during a solo solve still cancels upstream.

### Phase 2 — delete the memory L2 backend

- Delete `memory-solve-cache.ts`, `solve-cache-envelope.ts`, `solve-cache-key.ts`.
- Remove the L2 branches from `solve-pipeline.ts`; `SolveEnvelope.result` becomes non-optional again.
- Keep `ISolveResultCache` + `NoopSolveResultCache` + `SolvePipelineCacheHook`.
- Remove `SOLVE_CACHE_PROVIDER`, `SOLVE_CACHE_DEFAULT_MAX_ENTRIES`, `SOLVE_CACHE_MAX_TOTAL_MB`.
- Tests: `solve-cache.test.ts` (262) goes; the `— L2 solve cache` block in `solve-pipeline.test.ts`
  (~146 of 726) goes. The `adaptEnvelopeToEncoding` block (~60) **stays** — re-point its framing from
  "coalesced per-waiter re-key (audit C5)" to single-flight, which is what it always tested.

### Phase 3 — collapse the config surface

- Apply the three renames in `resolveComputeLimits`, honouring the old names for one minor version
  with a boot warning. The two budget fields stay on `ComputeLimits`; only their env keys change.
- `.env.example` (both copies) + `packages/compute/.env.example`: one **Caching** section holding the
  two budgets; keep `REMOTE_DEFINITION_CACHE_TTL_MS` beside
  `REMOTE_DEFINITION_FETCH_TIMEOUT_MS` under remote-definition fetching, where it belongs — same
  subsystem, same prefix. Move `COMPUTE_REUSE_DEFINITION_CACHE` / `COMPUTE_SERVER_CACHESOLVE` under a
  **Rhino.Compute server** heading. Do **not** rename those two — they name a remote system's feature
  and one is a real compatibility switch.
- Document the ×16 worst case beside `COMPUTE_SOLVE_CACHE_MB`, since that multiplier is the reason
  the knob exists.
- Rewrite `docs/Caching.md` around the three names; its settings table shrinks to the two budgets,
  the remote TTL, and the two Rhino flags. Include the two-source split under **Definition cache** —
  one table, not a fourth concept. Fix `docs/security-and-limits.md:66`, which cites two renamed vars.
  Update `packages/website/src/lib/architecture.ts` (12 entries, 5 tiers) — accurate today, stale the
  moment Phase 2 lands; its remote-definition entry at line 216 cites the old env name.
- Optional, one line: `selva doctor` warns if a deleted cache var is present, so an operator who set
  one during the deprecation window learns it is inert. A check, not a mutation — no `migrate`
  changes and no `env.js` helper.

### Phase 4 — make it observable

**The gap in the whole subsystem: there is no way to see whether any of this works.** Every tier
already reports its verdict on `Server-Timing` (`selva_cache`, `def_bytes`, `l2_cache`), but reading
it requires devtools and knowledge of the header format.

Surface hit rates for the two named caches on `/admin/compute`. For a stated goal of "easy to use,"
this is worth more than any env var — a number that moves when you scrub a slider is how an operator
learns the system is on.

## Risks

- **Phase 1 changes default behaviour.** The others are deletions and renames of things that are
  already off. Land Phase 1 alone and watch it before proceeding.
- **`@selvajs/solve` goes major again** (second time this month — Phase 3 of the solve extraction was
  the first). `@selvajs/server` is untouched. Parafa consumes `@selvajs/solve/server`; it does not use
  L2, but confirm before publishing.
- **The seam could rot.** `ISolveResultCache` survives with no production implementation, which is
  how interfaces drift out of usability. Mitigate by keeping the pipeline hook exercised: a test
  backend in the suite, so the injection point stays proven rather than theoretical.
- **Deleting a shipped feature.** L2 works; it is simply redundant with L1 in-process and with
  `cachesolve` cross-instance. If a genuine need for shared caching arrives, the answer is Redis
  behind the kept interface — which is a better answer than what is being deleted.

## Explicitly out of scope

- **§F1 — edge line-geometry cache growth.** ✅ Done separately, 2026-07-30, as this plan intended.
  It was a live GPU leak (unbounded growth across solves), unrelated to configuration; fixed in
  `visualization/render` with a regression suite. Nothing here depends on it.
- **The GPU caches.** Not configurable, not changing.
- **`solve-pipeline.ts`'s remaining size.** It shrinks by ~120 lines here; splitting it further is a
  separate change.
- **The four unprefixed legacy vars** (`MAX_*`, `REMOTE_DEFINITION_FETCH_TIMEOUT_MS`). Out of scope
  beyond the one TTL rename that is actively misleading.
