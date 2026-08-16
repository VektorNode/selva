# Selva Pre-Scale Audit — Open Items

**Tracked in [#203](https://github.com/VektorNode/selva/issues/203)** — sub-issues cover the cheap wins only; the P2/P3 tail below is promoted on demand.

**Started:** 2026-07-05 (branch `beta`) · **Re-verified 2026-07-31** by three independent read-only agents reading current source directly, not trusting prior doc prose. Result: almost everything below is still live and accurate, mostly with small file:line drift from unrelated edits. Two items had their status corrected (2f, Q3 — "in progress" was stale, no work had actually landed), one citation was wrong (S4), and one "not reproducible" verdict was itself wrong (Q6 — see below). C10 is closed out entirely: its bug is fixed and there's nothing left to track.

**Context:** Full-stack audit run while there is ~1 real user — the cheapest possible moment to fix any of this. Scope: `packages/platform`, `packages/providers/local`, `packages/providers/supabase`, `packages/selva` server code, `packages/server`, `packages/compute`/`packages/solve` solve path, security, data-model irreversibility, test quality, operational readiness, client-side viewer memory, privacy claims, and Rhino.Compute scaling.
**Not in scope:** data-tree parsing and the JS binary-geometry parser in `packages/compute` — see [Not yet audited](#not-yet-audited).
**How to use this doc:** the four items with issue links are filed and tracked there. Everything still marked ☐ is the **unfiled backlog** — it lives only in this document, by choice: filing 25 issues nobody will pick up buries the four that matter. Promote an item to an issue when you commit to it, and link it here.

> **Completed and stale items are removed, not archived here.** Full write-ups for landed work live in git history. This doc is the open, currently-real list only.

---

## Priority model

Ranked by **cost of fixing later ÷ cost of fixing now**, not by severity. Three things drive an item up:

1. **Irreversibility** — once rows/links/clients exist, the fix needs a migration or a compat shim. Cheap today, expensive at 100 users.
2. **Correctness with a live failure mode** — it can serve a wrong answer or corrupt state, at any scale.
3. **Load-bearing for scale work** — other planned work sits on top of it.

Everything else is efficiency, hygiene, or a decision to record. Real but not urgent.

---

## Dropped or closed this pass

- **C6, C7 — DEAD, confirmed gone again.** Both described an "L2 solve-result cache" tier that no longer exists in source (only stale `dist/*.js` build artifacts remain for C7). `solve-cache-single-flight.ts:4-9` now explicitly documents that the old L2 was deleted. `ISolveResultCache`/`NoopSolveResultCache` remain as an unwired seam, not a live gap.
- **C10 — CLOSED, bug already fixed.** The specific failure (dead/unreachable compute server landing in the 500 `schema` bucket instead of 503) is fixed: `load-for-render.ts:159-169` wraps client construction in its own try/catch that throws a `connect`-kind error → 503. No open task remains.
- **Q6 — CORRECTED, do not re-drop.** Previously marked "not reproducible" based on running `vitest --sequence.shuffle` twice with no failures. That test doesn't isolate the actual trigger: `packages/compute/vitest.config.ts:9-16` explicitly warns order-dependent `vi.mock` failures are masked by per-file `isolate: true`, which shuffle doesn't disable. The two flagged files (`solve-scheduler-hash-memo.test.ts:14-20`, `grasshopper-response-processor.test.ts:15-17`) still use module-level `vi.mock`. Correct status: **CANNOT VERIFY without a run at `isolate: false`** — kept open below, not dropped.

---

## P2 — Medium priority (real but not urgent)

| Status                                                 | ID        | Item                                                                                                  | Section                             |
| ------------------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ☐                                                      | **4d**    | Supabase: move profile mutations (star/unstar/recordRun) to a single RPC — lost-update race           | [§4](#4-supabase-provider)          |
| [#205](https://github.com/VektorNode/selva/issues/205) | **4g**    | Two composite indexes missing (`definitions`+created_at, `audit_events`+id tiebreaker)                | [§4](#4-supabase-provider)          |
| [#204](https://github.com/VektorNode/selva/issues/204) | **2e**    | Add `countMembers`/`countOrgMembers`; 4 call sites list full rosters just to count (correctness bug)  | [§2](#2-route-handlers)             |
| [#207](https://github.com/VektorNode/selva/issues/207) | **2f**    | Add `listPlatformProjects()`; stop the serial cross-org walk — **no fix has landed, not in progress** | [§2](#2-route-handlers)             |
| ☐                                                      | **4c**    | Supabase: drop full event `data` JSONB from the audit list projection                                 | [§4](#4-supabase-provider)          |
| [#206](https://github.com/VektorNode/selva/issues/206) | **C3**    | Input values serialized redundantly per solve — 4 server + 4 client passes                            | [§C](#c-solve-cycle)                |
| ☐                                                      | **C4**    | 5–7 sequential-await DB reads per solve (unmeasured against a live stack); false rate-limit comment   | [§C](#c-solve-cycle)                |
| ☐                                                      | **C9**    | Cache `/io` per definition version — every page load makes a blocking, uncached compute round-trip    | [§C](#c-solve-cycle)                |
| ☐                                                      | **S4**    | Validate `ORIGIN` at boot; consider an Origin allowlist for state-changing API routes                 | [§S](#s-security-posture)           |
| ☐                                                      | **D6**    | Confirm intended org-delete semantics (4 tables hard-deleted, restore is lossy)                       | [§D](#d-data-model-irreversibility) |
| ☐                                                      | **Q4**    | Test-quality strengthening (weak assertions in `scenarios.test.ts`)                                   | [§Q](#q-test-quality)               |
| ☐                                                      | **Q6**    | Order-dependent `vi.mock` in `@selvajs/compute` — unverified under `isolate: false`, not disproven    | [§Q](#q-test-quality)               |
| ☐                                                      | **O5**    | Backup/export tooling for local-provider data (`keys` rotates with no export hedge)                   | [§O](#o-operational-readiness)      |
| ☐                                                      | **O7**    | No lifecycle/dispose seam — `SupabaseSolveMetricSink.close()` exists but nothing but a test calls it  | [§O](#o-operational-readiness)      |
| ☐                                                      | **B1–B4** | Scaling roadmap: compute pooling/backpressure, GoTrue cache (no regression), audit retention          | [§B](#b-scaling-roadmap)            |
| ☐                                                      | **B5-lb** | Decide: accept N× rate-limit drift across instances, or move the limiter to Redis                     | [§B](#b-scaling-roadmap)            |
| ☐                                                      | **LB-1**  | Fix the stale `X-Selva-Definition` header before any affinity router keys on it                       | [§LB](#lb-compute-load-balancing)   |
| ☐                                                      | **2h**    | `/team` + `/team/members` re-list the same org roster (moot once 2e lands)                            | [§2](#2-route-handlers)             |
| ☐                                                      | **4f**    | Supabase auth/storage each `createClient` instead of reusing the data-layer `ClientBundle`            | [§4](#4-supabase-provider)          |
| ☐                                                      | **P-ret** | Privacy: no time-based retention purge on `audit_events` / `solve_metrics`                            | [§P](#p-privacy-claim)              |

---

## P3 — Low priority / cheap cleanups / decisions to record

| Status | ID           | Item                                                                                   | Section                             |
| ------ | ------------ | -------------------------------------------------------------------------------------- | ----------------------------------- |
| ☐      | **C8**       | Decision note: share-link cap burns on failed solves, never refunded                   | [§C](#c-solve-cycle)                |
| ☐      | **C11**      | `incrementSolveCount`: one unbatched RPC per solve — ship opportunistically, not alone | [§C](#c-solve-cycle)                |
| ✅     | **Q7**       | Viewer has no DOM signal for rendered geometry — **done**, `data-mesh-count` shipped   | [§Q](#q-test-quality)               |
| ☐      | **S6**       | Optional magic-byte check on `.gh`/`.ghx` upload (compute already rejects bad files)   | [§S](#s-security-posture)           |
| ☐      | **O6**       | `/api/health` is boot-snapshot by design — decide if a live `/api/ready` is wanted     | [§O](#o-operational-readiness)      |
| 🧊     | **O4-scope** | Decision: browser + CLI packages stay on `console.*` (pino is server-only)             | [§O](#o-operational-readiness)      |
| ☐      | **Q3**       | Delete/slim low-value tests — 2 prior deletions confirmed done, 1 more confirmed open  | [§Q](#q-test-quality)               |
| ☐      | **V2**       | Optional: Blob + `createObjectURL` instead of doubled base64 data-URL for large images | [§V](#v-client-side-viewer)         |
| ☐      | **D7**       | Note only: storage visibility now bucket-routed, not path-prefix-encoded               | [§D](#d-data-model-irreversibility) |
| ☐      | **V3**       | Note only: server-side `TextureAssetStore` never evicts (Rhino-session scope)          | [§V](#v-client-side-viewer)         |
| 🧊     | —            | Plugin C# runtime quality (lower blast radius, best-tested part of the repo)           | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | Accessibility / i18n                                                                   | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | Docs accuracy drift (e.g. `docs/Caching.md`)                                           | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | License-compliance scan, website package                                               | [Deferred](#deliberately-deferred)  |

---

# Section detail

## C. Solve cycle

Full trace: input change → debounce → client throttle/memo → `POST /api/v1/compute` → route (auth/rate-limit/DB/byte-cache) → single-flight → pipeline (scheduler hash memo → pointer solve → Rhino `cachesolve`) → serialize/gzip → response → parse → three.js render. There's one result-shaping pipeline plus an unwired `ISolveResultCache` seam for a possible future Redis backend — don't describe this path in old "L1/L2" terms, it doesn't match the code.

- **C3 — Redundant input-tree serialization. [P2]** Confirmed live: coalesce/single-flight key (`packages/selva/src/lib/server/compute/solve.server.ts`, `stableStringify(inputTree)`), scheduler hash (`packages/compute/src/grasshopper/scheduler/stable-hash.ts:148`), wire body (`packages/compute/src/core/compute-fetch/compute-fetch.ts:313`), response `JSON.stringify` (`packages/solve/src/server/solve-pipeline.ts:245`) — 4 server-side passes over a potentially MB-scale tree. Client: memo key twice (`packages/solve/src/client/solve-memo.ts` get() line 90 + set() line 104), payload stringify (`packages/selva/src/routes/library/[guid]/+page.svelte:73`), and an **unconditional** `JSON.stringify(values).length` (`+page.svelte:82`) whose only use is the always-printed log line — a full serialize thrown away every solve, ungated behind any debug flag. Past 256 KB a whale loop re-stringifies every input on top (`:244,250`). **Cheapest win, still available — but it MOVED, it was not fixed:** the unconditional size log now lives at `packages/solve/src/client/compute-fetch-solve-fn.ts:98`, still ungated. Delete or debug-gate it there. The rest: derive one canonical string per boundary and thread it through.
- **C4 — Hot-path reads per solve. [P2 — read count still STATIC, never measured against a live stack]** Confirmed live in `packages/selva/src/lib/server/compute/solve.server.ts` (the route body moved out of `api/v1/compute/+server.ts` in the API v1 redesign; the sequence is unchanged): `tryResolveShareToken` (`:127`), `definitions.get` (`:193`), `projects.getProject` (`:205`), access check (`:212/217`), `definitions.getVersion` (`:227`), `tryIncrementSolveCount` (`:273`), `resolveServerForOrg` (`:284`) — the last fanning out to `SupabaseComputeServerStore.getConfig` (`:79-93`), which issues its own 4 queries concurrently via `Promise.all`, not sequentially. Bytes and warm clients are cached; the records are not, so a same-definition slider re-solve pays all of them. **Nobody has diffed `pg_stat_statements` across a real drag** — correct regardless of exact count: request-scoped memoization of records that cannot change within one request.

  **Rate limit still 120 req/100s** (`packages/server/src/compute/limits.ts:280-281`), keyed `user:${id}` or `share:${id}` (`+server.ts:170`). Whether a real drag actually 429s across a plausible move-spacing band remains unconfirmed against a live stack — a product decision (raise the limit, lengthen the debounce, or stop counting slider solves against the same bucket), not a patch.

  **False comment:** `+server.ts:169` reads _"Per-key rate limit; runs before DB reads so throttled callers don't burn quota"_ — still false. `tryResolveShareToken` (`:127`) is an awaited DB read before the rate-limit check (`:171`), and it must be, since the rate key at `:170` derives from the resolved share link. Either pre-key on the raw token to make throttled share callers genuinely DB-free, or fix the comment.

- **C9 — Every `/library/{guid}` page load makes a blocking, uncached compute round-trip. [P2]** `loadDefinitionForRender` (`packages/server/src/definitions/load-for-render.ts:121-267`) still calls `client.getIO(definitionSource)` uncached on every invocation (`:182-185`, inside a `Promise.all` with the schema fetch) — only the schema result is cached (`:179-181`), not the IO response. Invoked from `+page.server.ts:59` on every page load. A definition version's bytes are immutable, so `/io`'s response is deterministic — cache the parsed result on the version row, removing the round-trip and letting page render survive compute outages.
- **C11 — `incrementSolveCount` is one unbatched RPC per successful solve. [P3]** Confirmed live: `+server.ts:434` fires `providers.data.definitions.incrementSolveCount` fire-and-forget per solve; `SupabaseDefinitionStore.ts:221` issues the `increment_run_count` RPC directly, unbatched. `SupabaseSolveMetricSink.ts` has a genuine buffer/batch-flush pattern (`maxBatchSize`/`flushIntervalMs`, scheduled flush) this could reuse (~10 lines). Deliberately parked — ship it when someone is already in this file for another reason.
- **C8 — Decision note: share-cap burns on failed solves. [P3]** Confirmed live: `tryIncrementSolveCount` runs at `+server.ts:273`, before the solve. The outcome-handling block (`:384-421`) — `timeout`, `client_abort`, `too_large`, `shed`, `compute_error` — all exit without any decrement/refund call. `shed` is the sharp edge: an explicitly retryable 503 where the solve never reached compute, so a well-behaved backing-off client pays each retry. **Confirm intended, like D6.**

## B. Scaling roadmap

Assumption: 1000 registered users ⇒ Supabase provider, adapter-node behind a reverse proxy, one+ Rhino.Compute servers. **Verdict unchanged:** web tier + Postgres are fine once the audit items land; the real ceiling is **Rhino.Compute capacity**.

- **B5-lb — Multi-instance rate-limit drift. [P2]** Confirmed live: `packages/server/src/compute/rate-limit.ts` (module doc lines 1-11, impl at `createComputeRateLimiter` line 110 through ~204) is still a plain in-memory `Map`, no shared store, multi-instance deployments see N× the per-key rate. **Decide before the second instance exists.**
- **B1 — Rhino.Compute saturation (the real ceiling). [P2]** Confirmed live: `packages/platform/src/computeServer/utils.ts:66-92` (`resolveServerForOrg`), app wrapper `packages/selva/src/lib/server/compute/resolve.server.ts:41-56`. Missing: queue/backpressure UX; a compute _pool_; cross-instance admission control; per-org metering/quotas.
- **B2 — Auth: GoTrue round-trip per request. [P2, no regression]** Confirmed the earlier fix is intact: `SupabaseAuthProvider.ts` does hybrid JWT verification with a bounded, lazily-swept `lastRevalidatedAt` cache (declared ~line 121, revalidation logic ~218-285), capping GoTrue round-trips at once per `revalidateMs` per session. Flagged only as scale-mandatory to revisit under real load.
- **B4 — Database hot spots. [P2]** Missing indexes (4g, unchanged). No retention/partitioning mechanism exists for `audit_events` — a migration comment (`20260716120000_definition_status_and_audit_version.sql:24`) states verbatim "`audit_events` is append-only forever." `recordRun` per solve (4d) becomes required, not nice-to-have, at volume.

**Missing production-grade features (beyond efficiency, unchanged):** async solve jobs; aggregated observability; graceful shutdown / zero-downtime deploys; load testing; backup/DR for storage buckets; abuse surface on public share links.

## LB. Compute load balancing

ADR 0004 covers server identity and affinity design; the LB itself is deliberately unbuilt.

- **LB-1 — `X-Selva-Definition` is stale on warm clients. [P2]** Confirmed live: `packages/solve/src/server/client-cache.ts`. `build()` bakes the header into `clientConfig.headers` only at client-construction time (lines 196-200, with an explicit comment that this is a scheduler limitation). `getClient()` (lines 258-293) only calls `build()` on a cache miss; a cache hit (lines 260-266) returns the cached entry keyed only by `server.id` and never re-examines a new `definitionGuid`. Compute-side access logs are actively wrong today. Fix needs a per-request header hook in the scheduler.

**Routing law when the time comes (unchanged):** solves route by definition affinity (hash guid → pool member). Recommendation: app-level pooling over an infra LB.

## S. Security posture

- **S4 — CSRF/Origin. [P2 — corrected citation]** Confirmed: no `csrf` key in `packages/selva/svelte.config.js` (SvelteKit default `checkOrigin: true` applies, form-content-type only), and no app-level `ORIGIN` allowlist exists anywhere. **The prior citation was wrong** — `hooks.server.ts:42-45` is about env-validation ownership, not CSRF/origin; there is no origin-check comment in that file at all. Fix: validate `ORIGIN` at boot; consider an allowlist for state-changing methods.
- **S6 — Upload validated by extension only. [P3]** Confirmed live at `packages/selva/src/routes/api/v1/definitions/+server.ts:71-74`, delegating to the extension allowlist in `lib/server/api/v1/route.ts:151-152`. Mitigant intact: `fetchSchemaFromCompute` (`:90-93`) parses before persistence (`:95`), so non-GH bytes fail there. Optional hardening.

## D. Data-model irreversibility

- **D6 — Org-delete semantics are mixed. [P2]** Confirmed live at `packages/providers/supabase/src/data/SupabaseOrgStore.ts:140-223`: soft-delete cascade (`orgs`, `org_members`, `projects`, `project_members`, `definitions`, ~147-196) vs. hard-delete (`invites`, `compute_server_org_defaults`, `compute_server_shares`, scoped `compute_servers`, ~199-220) — code self-documents the split (no `deleted_at` column on those four tables). Restore is knowingly lossy for four tables. **Confirm intended** — if restore is a real requirement, they need `deleted_at`.
- **D7 — Note only, mechanism changed. [P3]** `SupabaseStorageProvider` routes to one of two buckets (`selva-public` / `selva-private`) via `bucketFor()` (`packages/providers/supabase/src/storage/SupabaseStorageProvider.ts:86-91`), consulting an asset-class registry (`classifyAssetPath`) plus extension checks — not the old path-prefix scheme. Practical conclusion unchanged (changing visibility still means moving the object, now between buckets).

## 2. Route handlers

- **2e — 4 call sites list full rosters just to count. [P2]** Confirmed live. `IOrgStore` (`packages/platform/src/organizations/interface.ts:10-68`) and `IProjectStore` (`packages/platform/src/projects/interface.ts:10-58`) still have no count method. Call sites: `team/+page.server.ts:21,28`; `admin/organizations/+page.server.ts:21,26`; `team/projects/+page.server.ts:25,30`; `team/reclaim/+page.server.ts:36-46` — each counts via `.items.length` after a capped list (limits 200–1000). **This is a correctness bug, not just waste** — any org past its page limit already displays a wrong count. Fix: `countMembers(ctx, projectId)` / `countOrgMembers(ctx, orgId)` (SQL `COUNT(*)`).
- **2f — Serial cross-org walk to find platform projects. [P2 — status corrected: no fix has landed]** Confirmed live at `admin/projects/+page.server.ts:37-48`: `listOrgs(limit:1000)` then a sequential `for...of` loop with `await listProjects(...)` per org (no `Promise.all`). **Half this item is gone:** the second site, `admin/api/projects/+server.ts`, no longer exists — the API v1 redesign removed that directory, so only the page load remains. **The doc previously said a quick-win `Promise.all` fix was "in progress"; it was not — nothing has changed here.** Quick win: wrap in `Promise.all`. Real fix: `listPlatformProjects()`.
- **2h — Duplicate roster fetch. [P2]** Confirmed live: `team/+page.server.ts:21` (`listOrgMembers`, limit 1000) vs `team/members/+page.server.ts:42` (`listOrgMembers`, same org, limit 200) — differing limits mean the two aren't interchangeable as-is. Moot once 2e lands.

## 4. Supabase provider

- **4d — Profile mutations are read-modify-write with a known race. [P2]** Confirmed live: `packages/providers/supabase/src/userProfile/SupabaseUserProfileProvider.ts` `starDefinition` (73-94), `unstarDefinition` (96-114), `recordRun` (116-136) — each `getProfile` + `update`, 2 round trips. Only `starDefinition` (79-81) has an in-code race comment; `recordRun` fires on every solve with no such note, making it the actual hotspot. Fix: `SECURITY DEFINER` RPC with `array_append`/`array_remove`/dedup+cap in one statement.
- **4g — Two indexes missing. [P2]** Confirmed live. `selva.definitions` (migration `20260425155514_selva_initial.sql:483-489`) has indexes only on `project_id`, `status`, and a partial `(updated_at)` — none on `created_at`, the default order column. `selva.audit_events` (same migration, 1153-1160) has three indexes, none carrying `id` as a tiebreaker, despite `SupabaseAuditQuery.list` ordering/keyset-seeking on `occurred_at desc, id desc` (`SupabaseAuditQuery.ts:36-37,66`).
- **4c — Audit list pulls full `data` JSONB. [P2]** Confirmed live: `SupabaseAuditQuery.ts:35` selects `data` for up to 201 rows per page. Drop from the list projection; fetch lazily on expand.
- **4f — Redundant Supabase clients. [P2]** Confirmed live. A shared `ClientBundle` pattern exists (`packages/providers/supabase/src/data/client.ts:58-149`), but `SupabaseAuthProvider.ts` independently `createClient`s three times (lines 129/132/136 — admin/db/anon) and `SupabaseStorageProvider.ts:66` once more — neither takes a `ClientBundle`. Lowest-impact of the set.

## Q. Test quality

> **Q1 (Supabase untested in CI + dead deny-tests)** remains blocked on [issue #146](https://github.com/VektorNode/selva/issues/146) — a live Supabase test database in CI.

- **Q4 — Tests needing strengthening. [P2]** Confirmed live: `scenarios.test.ts` still uses `.resolves.toBeDefined()` at lines 85, 106, 175, 224 instead of asserting the returned identity/project. `upload-schema-gate.test.ts` now confirmed to already use the shared `actAs`/`call`/`freshProviders` fixture helpers (lines 17-23) — that sub-claim is dropped for good, not just stale this pass.
- **Q6 — Order-dependent `vi.mock` in `@selvajs/compute`. [P2 — reopened, corrected]** See [Dropped or closed](#dropped-or-closed-this-pass) above: the prior "not reproducible" verdict used `--sequence.shuffle`, which doesn't disable the `isolate: true` that `vitest.config.ts:9-16` names as the actual masking mechanism. Still using module-level `vi.mock` in `solve-scheduler-hash-memo.test.ts:14-20` and `grasshopper-response-processor.test.ts:15-17`. Needs a run at `isolate: false` to actually confirm either way.
- **Q7 — No DOM signal that geometry rendered. [P3 — DONE, verified 2026-08-16]** Fixed as proposed: `Viewer.svelte:359` carries `data-testid` and `data-mesh-count`, `e2e/core-loop.authed.spec.ts:101-104,127-130` reads the attribute instead of regex-parsing telemetry, and the `console.log` is gone.
- **Q3 — Deletable/slimmable tests. [P3 — status corrected: no longer "in progress"]** Confirmed: `SmokeTests.cs` and `JsonSchemaTests.cs` no longer exist anywhere in the repo (both prior deletions landed). Confirmed still open: `definitionStoreSuite.ts:607`, the `versioning scaffold: liveVersionId/draftVersionId default to null on create` test. The rest of the original list was not re-verified this pass — treat as unconfirmed until next audit touches it.

## O. Operational readiness

- **O4-scope — Browser + CLI packages stay on `console.*`. [P3, recorded decision, not re-verified this pass]**
- **O7 — No lifecycle/dispose seam, so buffered sinks never drain on shutdown. [P2]** Confirmed live: `SupabaseSolveMetricSink.ts:132-136` has a `close()` that flushes the buffer, but `IDataProvider` (`packages/platform/src/data/interface.ts`) has no `dispose()`. The only caller of `.close()` anywhere is a test (`solve-metric-sink-batching.test.ts:187`) — nothing in production code calls it. Fix: add a dispose seam to the provider interface, call it from a SIGTERM handler.
- **O5 — No backup/export for local-provider data. [P2]** Confirmed live: `packages/cli/src/commands/` has only `create.js, doctor.js, init.js, keys.js, migrate.js, pm2.js` — no backup/export. `keys.js` rotates `SELVA_AT_REST_KEY` (logic at 32-81, confirm prompt 49-56) with no export of the old key beforehand.
- **O6 — `/api/health` is boot-snapshot by design. [P3]** Confirmed live: `bootHealth.server.ts:35` caches on first run, `:128-137` never invalidates; the file's own comment (124-126) states this is intentional. **Decision to revisit, not a bug** — and half-addressed since: `api/health/ready/+server.ts` now exists with tests, giving a live readiness signal alongside the boot snapshot. Note the path is `/api/health/ready`, not `/api/ready`. What remains open is only whether the boot snapshot itself should refresh.

## V. Client-side viewer

Hot path is safe: per-solve disposal, teardown, and the WS ring buffer are all correct.

- **V2 — Base64 image outputs transiently doubled in heap. [P3]** Confirmed live: `packages/ui/src/lib/components/preview/ImageOutput.svelte:32,34` string-concats into a data URL. Churn, not a leak. Optional: Blob + `createObjectURL`.
- **V3 — Note only. [P3]** Confirmed live: `Plugin/Selva.GH/Features/Display/Services/TextureAssetStore.cs:31-32,49` — static `ConcurrentDictionary<string, Asset>`, entries added via `TryAdd`, no eviction path; the file's own comment (line 20) says entries live for the Rhino session.

## P. Privacy claim

Deletion-triggered erasure is done (`onUserDeleted` scrubs `audit_events`, `invites`, redacts embedded emails, anonymizes `solve_metrics`) — see git history. What's still open:

- **P-ret — No time-based retention. [P2]** Confirmed live: no `pg_cron`, retention, purge, or TTL mechanism exists anywhere in `packages/providers/supabase` migrations or `src/data/*` touching `audit_events` or `solve_metrics` — the only lifecycle hook is user-erasure related. Rows persist forever until a subject is erased. Add a `pg_cron` (or documented manual) age-based purge.

---

# Not yet audited

- **`packages/compute` — data-tree parsing and the JS binary-geometry parser.** Unchanged from the prior pass — remains the highest-value unaudited surface. Not touched this re-verification.

## Deliberately deferred

- **Plugin C# runtime quality** — runs on user machines, lower blast radius, best-tested part of the repo.
- **Accessibility / i18n** — revisit when selling into orgs that require it.
- **Docs accuracy drift** (e.g. `docs/Caching.md`) — fold into whichever fix touches each area.
- **License-compliance scan, website package** — low risk.
