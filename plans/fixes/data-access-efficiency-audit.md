# Selva Pre-Scale Audit — Open Items

**Started:** 2026-07-05 (branch `beta`) · **Full re-verification: 2026-07-31**, every open item below re-checked against current source by independent read-only agents (not by trusting prior doc prose). Three items were found to describe deleted architecture (an "L2 solve-result cache" tier removed in an earlier, undocumented cleanup) and are dropped outright rather than carried forward stale. One item's specific bug claim (C10) turned out already fixed. One item's flake claim (Q6) could not be reproduced against current tests. Everything else below is confirmed live in current code, with corrected file:line references where they'd drifted.

**Context:** Full-stack audit run while there is ~1 real user — the cheapest possible moment to fix any of this. Scope: `packages/platform`, `packages/providers/local`, `packages/providers/supabase`, `packages/selva` server code, `packages/server`, `packages/compute`/`packages/solve` solve path, security, data-model irreversibility, test quality, operational readiness, client-side viewer memory, privacy claims, and Rhino.Compute scaling.
**Not in scope:** data-tree parsing and the JS binary-geometry parser in `packages/compute` — see [Not yet audited](#not-yet-audited).
**How to use this doc:** work top to bottom by priority. Status: `☐ open` / `▶ in progress` / `✅ done` / `🧊 deliberately deferred`.

> **Completed and stale items are removed, not archived here.** Full write-ups for landed work live in git history. This doc is the open, currently-real list only.

---

## Priority model

Ranked by **cost of fixing later ÷ cost of fixing now**, not by severity. Three things drive an item up:

1. **Irreversibility** — once rows/links/clients exist, the fix needs a migration or a compat shim. Cheap today, expensive at 100 users.
2. **Correctness with a live failure mode** — it can serve a wrong answer or corrupt state, at any scale.
3. **Load-bearing for scale work** — other planned work sits on top of it.

Everything else is efficiency, hygiene, or a decision to record. Real but not urgent.

---

## Dropped this pass — verify before ever citing again

- **C6 ("L1 hits still pay full serialize+gzip") — DEAD.** Described an early-return in `solve-pipeline.ts` gated on an L2 solve-result cache. That cache tier is gone; `runSolvePipeline` now unconditionally serializes+gzips after every solve call, no cache-hit branch exists anywhere in it. `ISolveResultCache` (`packages/platform/src/solveCache/interface.ts`) is defined but has exactly one implementation, `NoopSolveResultCache`, and is never `.get()`/`.set()`-called on any request path — a real seam for a future Redis-backed cache, not a live gap today.
- **C7 ("L2 collision defense documented, not implemented") — DEAD.** `solve-cache-key.ts` and `solve-cache-envelope.ts` (hence `EnvelopeHeader`) don't exist in any package's `src` — only stale `packages/server/dist/*.js` build artifacts remain. Nothing to fix; the doc it was fixing no longer exists either.
- **Q6 ("order-dependent `vi.mock` flakes in `@selvajs/compute`") — NOT REPRODUCIBLE.** `pnpm --filter @selvajs/compute exec vitest run --sequence.shuffle` run twice against current HEAD (different shuffle seeds): 613/613 passing both times, no failures. Both named test files still exist with the described `vi.mock` shape, but whatever made them order-dependent is gone. If this resurfaces, re-open with a fresh repro, don't restore this write-up.

---

## P2 — Medium priority (real but not urgent)

| Status | ID        | Item                                                                                                                                               | Section                             |
| ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ☐      | **4d**    | Supabase: move profile mutations (star/unstar/recordRun) to a single RPC — lost-update race                                                        | [§4](#4-supabase-provider)          |
| ☐      | **4g**    | Two composite indexes missing (`definitions`+created_at, `audit_events`+id tiebreaker)                                                             | [§4](#4-supabase-provider)          |
| ☐      | **2e**    | Add `countMembers`/`countOrgMembers`; 4 call sites list full rosters just to count                                                                 | [§2](#2-route-handlers)             |
| ▶      | **2f**    | Add `listPlatformProjects()`; stop the serial cross-org walk (quick-win `Promise.all` fix in progress)                                             | [§2](#2-route-handlers)             |
| ☐      | **4c**    | Supabase: drop full event `data` JSONB from the audit list projection                                                                              | [§4](#4-supabase-provider)          |
| ☐      | **C3**    | Input values serialized redundantly per solve — L2-key pass is gone, 4 server + 4 client passes remain                                             | [§C](#c-solve-cycle)                |
| ☐      | **C4**    | 5–7 sequential DB reads per solve (still unmeasured against a live stack); drag DOES 429 across a wide move-spacing band; false rate-limit comment | [§C](#c-solve-cycle)                |
| ☐      | **C9**    | Cache `/io` per definition version — every page load makes a blocking, uncached compute round-trip                                                 | [§C](#c-solve-cycle)                |
| ☐      | **S4**    | Validate `ORIGIN` at boot; consider an Origin allowlist for state-changing API routes                                                              | [§S](#s-security-posture)           |
| ☐      | **D6**    | Confirm intended org-delete semantics (4 tables hard-deleted, restore is lossy)                                                                    | [§D](#d-data-model-irreversibility) |
| ☐      | **Q4**    | Test-quality strengthening (weak assertions, prose-only races) — narrower than previously recorded                                                 | [§Q](#q-test-quality)               |
| ☐      | **O5**    | Backup/export tooling for local-provider data (`keys` rotates with no export hedge)                                                                | [§O](#o-operational-readiness)      |
| ☐      | **O7**    | No lifecycle/dispose seam — `SupabaseSolveMetricSink.close()` exists but nothing ever calls it                                                     | [§O](#o-operational-readiness)      |
| ☐      | **B1–B4** | Scaling roadmap: async solve jobs, compute pooling, ADR 0003 streaming, audit retention                                                            | [§B](#b-scaling-roadmap)            |
| ☐      | **B5-lb** | Decide: accept N× rate-limit drift across instances, or move the limiter to Redis                                                                  | [§B](#b-scaling-roadmap)            |
| ☐      | **LB-1**  | Fix the stale `X-Selva-Definition` header before any affinity router keys on it                                                                    | [§LB](#lb-compute-load-balancing)   |
| ☐      | **2h**    | `/team` + `/team/members` re-list the same org roster (moot once 2e lands)                                                                         | [§2](#2-route-handlers)             |
| ☐      | **4f**    | Supabase auth/storage each `createClient` instead of reusing the data-layer `ClientBundle`                                                         | [§4](#4-supabase-provider)          |
| ☐      | **P-ret** | Privacy: no time-based retention purge on `audit_events` / `solve_metrics`                                                                         | [§P](#p-privacy-claim)              |

---

## P3 — Low priority / cheap cleanups / decisions to record

| Status | ID           | Item                                                                                      | Section                             |
| ------ | ------------ | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| ☐      | **C8**       | Decision note: share-link cap burns on failed solves, never refunded                      | [§C](#c-solve-cycle)                |
| ☐      | **C11**      | `incrementSolveCount`: one unbatched RPC per solve — ship opportunistically, not alone    | [§C](#c-solve-cycle)                |
| ☐      | **Q7**       | Viewer has no DOM signal for rendered geometry; E2E regex-parses a console telemetry line | [§Q](#q-test-quality)               |
| ☐      | **S6**       | Optional magic-byte check on `.gh`/`.ghx` upload (compute already rejects bad files)      | [§S](#s-security-posture)           |
| ☐      | **O6**       | `/api/health` is boot-snapshot by design — decide if a live `/api/ready` is wanted        | [§O](#o-operational-readiness)      |
| 🧊     | **O4-scope** | Decision: browser + CLI packages stay on `console.*` (pino is server-only)                | [§O](#o-operational-readiness)      |
| ▶      | **Q3**       | Delete/slim low-value or duplicated tests (2 done, ≥1 more confirmed still open)          | [§Q](#q-test-quality)               |
| ☐      | **V2**       | Optional: Blob + `createObjectURL` instead of doubled base64 data-URL for large images    | [§V](#v-client-side-viewer)         |
| ☐      | **D7**       | Note only: storage visibility now bucket-routed, not path-prefix-encoded                  | [§D](#d-data-model-irreversibility) |
| ☐      | **V3**       | Note only: server-side `TextureAssetStore` never evicts (Rhino-session scope)             | [§V](#v-client-side-viewer)         |
| 🧊     | —            | Plugin C# runtime quality (lower blast radius, best-tested part of the repo)              | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | Accessibility / i18n                                                                      | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | Docs accuracy drift (e.g. `docs/Caching.md`)                                              | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | License-compliance scan, website package                                                  | [Deferred](#deliberately-deferred)  |

---

# Section detail

## C. Solve cycle

Full trace: input change → debounce → client throttle/memo → `POST /api/compute` → route (auth/rate-limit/DB/byte-cache) → single-flight → pipeline (scheduler hash memo → pointer solve → Rhino `cachesolve`) → serialize/gzip → response → parse → three.js render. **The former "L2 → scheduler L1" two-tier cache framing is gone** — there's one result-shaping pipeline plus an unwired `ISolveResultCache` seam for a possible future Redis backend. Don't reintroduce L1/L2 language when describing this path; it doesn't match the code.

- **C3 — Redundant input-tree serialization. [P2]** The L2-key serialization pass from the old framing no longer exists (its source file is gone). What remains, all confirmed live: coalesce/single-flight key (`packages/selva/src/routes/api/compute/+server.ts:330`, `stableStringify(inputTree)`), scheduler hash (`packages/compute/src/grasshopper/scheduler/stable-hash.ts:148`), wire body (`packages/compute/src/core/compute-fetch/compute-fetch.ts:313`), response `JSON.stringify` (`packages/solve/src/server/solve-pipeline.ts:245`) — 4 server-side passes over a potentially MB-scale tree. Client: memo key twice (`packages/solve/src/client/solve-memo.ts`, `get()` line 90 + `set()` line 104), payload stringify (`packages/selva/src/routes/library/[guid]/+page.svelte:73`), and an **unconditional** `JSON.stringify(values).length` (`+page.svelte:82`) whose only use is the always-printed log line (`:258-259`) — still a full serialize thrown away every solve, still ungated behind any debug flag. Past 256 KB a whale loop re-stringifies every input on top (`:244,250`). **Cheapest win, still available: delete or debug-gate the unconditional size log at `+page.svelte:82`.** The rest: derive one canonical string per boundary and thread it through.
- **C4 — Hot-path reads per solve. [P2 — read count still STATIC, never measured against a live stack]** Confirmed live at corrected lines in `packages/selva/src/routes/api/compute/+server.ts`: `tryResolveShareToken` (`:127`), `definitions.get` (`:193`), `projects.getProject` (`:205`), access check (`:212/217`), `definitions.getVersion` (`:227`), `tryIncrementSolveCount` (`:273`), `resolveServerForOrg` (`:284`) — the last fanning out to `SupabaseComputeServerStore.getConfig` (`:79-93`), which issues its own 4 queries **concurrently via `Promise.all`**, not sequentially (worth correcting in any future write-up that calls the whole chain "sequential" — the top-level awaits are sequential, the fan-out inside `getConfig` is not). Bytes and warm clients are cached; the records are not, so a same-definition slider re-solve pays all of them.

  **Verification caveat stands.** Nobody has diffed `pg_stat_statements` across a real drag. Correct regardless of exact count: request-scoped memoization of records that cannot change within one request. Don't promote this above other P2 work on the read-count number alone.

  **Rate limit still 120 req/100s** (`packages/server/src/compute/limits.ts:280-281`, `COMPUTE_RATE_LIMIT_MAX`/`COMPUTE_RATE_LIMIT_WINDOW_MS`), keyed `user:${id}` or `share:${id}` (`+server.ts:170`). The prior simulation result (drag hits 429 across a ~150ms–830ms move-spacing band, LRU memo is what actually protects normal use, not the throttle) was derived from these same constants and is unchanged — still unconfirmed against a live stack, still the most-corrected finding on this path (two prior static readings were wrong in opposite directions before this one). The fix is a product call (raise the limit, lengthen the debounce, or stop counting slider solves against the same bucket), not a patch.

  **False comment, corrected line:** `+server.ts:169` reads _"Per-key rate limit; runs before DB reads so throttled callers don't burn quota"_ — still false. `tryResolveShareToken` (`:127`) is an awaited DB read before the rate-limit check (`:171`), and it must be, since the rate key at `:170` derives from the resolved share link. Either pre-key on the raw token to make throttled share callers genuinely DB-free, or fix the comment.

- **C9 — Every `/library/{guid}` page load makes a blocking, uncached compute round-trip. [P2]** `loadDefinitionForRender` (`packages/server/src/definitions/load-for-render.ts:121-267`) still calls `client.getIO(definitionSource)` uncached on every invocation (`:183`, inside a `Promise.all` with the schema fetch) — only the schema result is cached (`:179-181`), not the IO response. Invoked from `+page.server.ts:59` on every page load. A definition version's bytes are immutable, so `/io`'s response is deterministic — cache the parsed result on the version row (ADR 0005 pattern), removing the round-trip and letting page render survive compute outages.
- **C10 — Load-path error mapping. [Narrowed — one specific bug already fixed, general note remains]** Current mapping (`packages/selva/src/routes/library/[guid]/+page.server.ts:94-123`): `missing-config`/`connect` → 503, `schema` → 500, `data` → 400 (matches prior description). **The specific bug this item was raised for — a dead/unreachable server at a configured URL landing in the 500 `schema` bucket instead of 503 — is already fixed**: `load-for-render.ts:159-169` wraps the client-construction call in its own try/catch that explicitly throws a `connect`-kind error (→503) when the configured server is unreachable. Nothing actionable remains here; kept as a note in case the `schema` bucket regains a similar conflation later, not as an open task.
- **C11 — `incrementSolveCount` is one unbatched RPC per successful solve. [P3]** Confirmed live: `+server.ts:434` fires `providers.data.definitions.incrementSolveCount` fire-and-forget per solve; `SupabaseDefinitionStore.ts:220-221` issues the `increment_run_count` RPC directly, unbatched. `SupabaseSolveMetricSink.ts:56-172` has a genuine buffer/batch-flush pattern (buffer array, `maxBatchSize`/`flushIntervalMs`, scheduled flush) that this could reuse (~10 lines). Still deliberately parked — ship it when someone is already in this file for another reason.
- **C8 — Decision note: share-cap burns on failed solves. [P3]** Confirmed live: `tryIncrementSolveCount` runs at `+server.ts:273`, before the solve. Scanning the outcome-handling block (`:384-421`): `timeout`, `client_abort`, `too_large`, `shed`, `compute_error` all exit without any decrement/refund call anywhere. `shed` is the sharp edge — an explicitly retryable 503 where the solve never reached compute, so a well-behaved backing-off client pays each retry. **Confirm intended, like D6.**

## B. Scaling roadmap

Assumption: 1000 registered users ⇒ Supabase provider, adapter-node behind a reverse proxy, one+ Rhino.Compute servers. **Verdict unchanged:** web tier + Postgres are fine once the audit items land; the real ceiling is **Rhino.Compute capacity**.

- **B5-lb — Multi-instance rate-limit drift. [P2]** Confirmed live. `packages/server/src/compute/rate-limit.ts` (module doc, lines 1-11) still describes a process-local `Map` limiter where multi-instance deployments see N× the per-key rate, and the seam is still `createComputeRateLimiter` (line 110) — implementation at lines 119-204 remains a plain in-memory `Map`, no shared store. **Decide before the second instance exists.**
- **B1 — Rhino.Compute saturation (the real ceiling). [P2]** Confirmed live, narrowest-wins resolution unchanged: `packages/platform/src/computeServer/utils.ts:66-92` (`resolveServerForOrg`), app wrapper `packages/selva/src/lib/server/compute/resolve.server.ts:41-56` (now additionally fetches the API key only for the winning server — a minor change, resolution order itself unchanged). Missing: queue/backpressure UX; a compute _pool_; cross-instance admission control; per-org metering/quotas.
- **B2 — Auth: GoTrue round-trip per request. [P2, no regression]** Confirmed the earlier fix is intact: `SupabaseAuthProvider.ts` does hybrid JWT verification with a bounded, lazily-swept `lastRevalidatedAt` cache (lines 115-118, 231-279), capping GoTrue round-trips at once per `revalidateMs` per session. Flagged here only as scale-mandatory to revisit under real load.
- **B4 — Database hot spots. [P2]** Missing indexes (4g, unchanged). **Confirmed still true:** no retention/partitioning mechanism exists anywhere in `packages/providers/supabase` migrations for `audit_events` — a later migration comment (`20260716120000_definition_status_and_audit_version.sql:24`) explicitly states "`audit_events` is append-only forever." `recordRun` per solve (4d) becomes required, not nice-to-have, at volume.

**Missing production-grade features (beyond efficiency, unchanged):** async solve jobs; aggregated observability; graceful shutdown / zero-downtime deploys; load testing; backup/DR for storage buckets; abuse surface on public share links.

## LB. Compute load balancing

ADR 0004 covers server identity and affinity design; the LB itself is deliberately unbuilt.

- **LB-1 — `X-Selva-Definition` is stale on warm clients. [P2]** Confirmed live at corrected location: `packages/solve/src/server/client-cache.ts`. `build()` bakes the header into `clientConfig.headers` only at client-construction time (lines 196-200, with an explicit comment: "Baked at client-create time because the scheduler has no per-request header hook"). `getClient()` (lines 258-293) only calls `build(server, opts?.definitionGuid)` on a cache miss (line 275); a cache hit (lines 260-266) returns the existing entry and never re-examines the new `definitionGuid`. Compute-side access logs are actively wrong today. Fix needs a per-request header hook in the scheduler.

**Routing law when the time comes (unchanged):** solves route by definition affinity (hash guid → pool member). Recommendation: app-level pooling over an infra LB.

## S. Security posture

- **S4 — CSRF/Origin. [P2]** Confirmed live. No `csrf` key in `packages/selva/svelte.config.js` (SvelteKit default `checkOrigin: true` applies, form-content-type only). `packages/selva/src/hooks.server.ts:42-45` has an explicit comment stating env validation is left to each provider's `fromEnv()` and no app-level `ORIGIN` check is done. Fix: validate `ORIGIN` at boot; consider an allowlist for state-changing methods.
- **S6 — Upload validated by extension only. [P3]** Confirmed live at `packages/selva/src/routes/api/definitions/+server.ts:31-45` (extension + size only). Mitigant intact: `fetchSchemaFromCompute` (`:90-93`) parses before persistence (`:95`), so non-GH bytes fail there. Optional hardening.

## D. Data-model irreversibility

- **D6 — Org-delete semantics are mixed. [P2]** Confirmed live at `packages/providers/supabase/src/data/SupabaseOrgStore.ts:140-223`: soft-delete cascade (`orgs`, `org_members`, `projects`, `project_members`, `definitions`, lines 147-197) vs. hard-delete (`invites`, `compute_server_org_defaults`, `compute_server_shares`, scoped `compute_servers`, lines 199-220) — code self-documents the split (no `deleted_at` column on those four tables). Restore is knowingly lossy for four tables. **Confirm intended** — if restore is a real requirement, they need `deleted_at`.
- **D7 — Note only, mechanism changed. [P3]** The path-prefix visibility scheme (`branding/` vs `private/`) this item originally described **no longer exists as such**. `SupabaseStorageProvider` now routes to one of two separate buckets (`selva-public` / `selva-private`) via `bucketFor()` (`packages/providers/supabase/src/storage/SupabaseStorageProvider.ts:44-91`), consulting an asset-class registry (`classifyAssetPath`) plus extension checks — not a literal string-prefix scheme. The practical conclusion is unchanged (changing visibility still means moving the object, now between buckets), but don't cite the old "path prefix" mechanism description again.

## 2. Route handlers

- **2e — 4 call sites list full rosters just to count. [P2 — narrowed from 8]** Confirmed live. `IOrgStore` (`packages/platform/src/organizations/interface.ts:10-68`) and `IProjectStore` (`packages/platform/src/projects/interface.ts:10-58`) still have no count method. Confirmed call sites: `packages/selva/src/routes/team/+page.server.ts:21,28`; `admin/organizations/+page.server.ts:21,26`; `team/projects/+page.server.ts:25,30`; `team/reclaim/+page.server.ts:38,43` — each counts via `.items.length` after a capped list (limits 200–1000), silently truncating past the cap. **This is a correctness bug, not just waste** — any org past its page limit already displays a wrong count. Fix: `countMembers(ctx, projectId)` / `countOrgMembers(ctx, orgId)` (SQL `COUNT(*)`).
- **2f — Serial cross-org walk to find platform projects. [P2, quick-win fix in progress]** Confirmed live: `packages/selva/src/routes/admin/api/projects/+server.ts:56-66` and `admin/projects/+page.server.ts:30-40` both `listOrgs(limit:1000)` then a sequential `for...of` loop with `await listProjects(...)` per org — no `Promise.all` — JS-filtering `visibility === 'platform'`. Quick win: wrap in `Promise.all`. Real fix: `listPlatformProjects()`.
- **2h — Duplicate roster fetch. [P2]** Confirmed live: `team/+page.server.ts:21` (`listOrgMembers`, limit 1000) and `team/members/+page.server.ts:40` (`listOrgMembers`, same org, limit 200) — differing limits mean the two aren't interchangeable as-is. Moot once 2e lands.

## 4. Supabase provider

- **4d — Profile mutations are read-modify-write with a known race. [P2]** Confirmed live: `SupabaseUserProfileProvider.ts` `starDefinition` (73-94), `unstarDefinition` (96-114), `recordRun` (116-136) — each still `getProfile` + `update`, 2 round trips. Only `starDefinition` (79-81) has an in-code race comment; `recordRun` fires on every solve with no such note, making it the actual hotspot. Fix: `SECURITY DEFINER` RPC with `array_append`/`array_remove`/dedup+cap in one statement.
- **4g — Two indexes missing. [P2]** Confirmed live. (a) `selva.definitions` (`.../migrations/20260425155514_selva_initial.sql:483-489`) has indexes only on `project_id`, `status`, and a partial `(updated_at)` for pending rows — none on `created_at`, which is `definitionOrderColumn`'s default (`SupabaseDefinitionStore.ts:556-567`). (b) `selva.audit_events` (same migration, lines 1153-1160) has three indexes, none carrying `id` as a tiebreaker, even though `SupabaseAuditQuery.list` orders and keyset-seeks on `occurred_at desc, id desc` (`SupabaseAuditQuery.ts:36-37,66`).
- **4c — Audit list pulls full `data` JSONB. [P2]** Confirmed live: `SupabaseAuditQuery.ts:35` still selects `data` for up to 201 rows per page. Drop from the list projection; fetch lazily on expand.
- **4f — Redundant Supabase clients. [P2]** Confirmed live. A shared `ClientBundle` pattern exists (`packages/providers/supabase/src/data/client.ts:58-149`, used by e.g. `SupabaseUserProfileProvider`), but `SupabaseAuthProvider.ts:129-138` independently `createClient`s three times (admin/db/anon) and `SupabaseStorageProvider.ts:66-68` once more — neither takes a `ClientBundle`. Lowest-impact of the set.

## Q. Test quality

> **Q1 (Supabase untested in CI + dead deny-tests)** remains blocked on [issue #146](https://github.com/VektorNode/selva/issues/146) — a live Supabase test database in CI.

- **Q4 — Tests needing strengthening. [P2 — narrower than previously recorded]** Confirmed still true: `scenarios.test.ts` still uses `.resolves.toBeDefined()` in 4 places (`packages/selva/src/lib/server/__tests__/scenarios.test.ts:85,106,175,224`) instead of asserting the returned identity/project. **Stale sub-claim, drop it:** `upload-schema-gate.test.ts` (`packages/selva/src/routes/api/definitions/__tests__/upload-schema-gate.test.ts:21-23`) now already uses the shared `actAs`/`call`/`freshProviders` fixture helpers — it no longer hand-builds locals/event. `patch-member.test.ts`'s ambiguous cross-tenant case and `bootstrap-admin.test.ts`'s unexercised race were not re-checked this pass.
- **Q7 — No DOM signal that geometry rendered. [P3]** Confirmed live: `packages/ui/src` has zero `data-testid` occurrences repo-wide. `packages/selva/src/routes/library/[guid]/+page.svelte:264` has the `console.log` telemetry line (`mesh=<ms>ms (<count>)`), and `packages/selva/e2e/core-loop.authed.spec.ts:44` regex-parses it (`/mesh=\d+ms \((\d+)\)/`) as its sole rendering signal — the test's own comment (lines 17-19) says so explicitly. Fix is ~one line: stamp `data-mesh-count={meshes.length}` on the viewer container, point the E2E at it.
- **Q3 — Deletable/slimmable tests. [P3, in progress]** Confirmed the 2 previously-claimed deletions are actually done — `SmokeTests.cs` and `JsonSchemaTests.cs` no longer exist anywhere in the repo. Confirmed still open: `definitionStoreSuite.ts:571` still has the `versioning scaffold: liveVersionId/draftVersionId default to null on create` test as originally flagged. The remainder of the original ~10-item list (SchemaMigratorTests overlap, storageProviderSuite.ts, compute-server-encryption.test.ts, HeaderAuthProvider.test.ts, updateCheck/releaseChannel tests, scenarios.test.ts matrices, duplicate createdBy/updatedBy tests) was not re-verified this pass — treat as unconfirmed until next audit touches it.

## O. Operational readiness

- **O4-scope — Browser + CLI packages stay on `console.*`. [P3, recorded decision, not re-verified this pass]**
- **O7 — No lifecycle/dispose seam, so buffered sinks never drain on shutdown. [P2]** Confirmed live: `SupabaseSolveMetricSink.ts:132-136` has a `close()` that flushes the buffer, but `packages/platform/src/data/interface.ts`'s `IDataProvider` has no `dispose()`, and no caller of `.close()` exists anywhere in `packages/platform/src` or the sink's own package. Fix: add a dispose seam to the provider interface, call it from a SIGTERM handler.
- **O5 — No backup/export for local-provider data. [P2]** Confirmed live: `packages/cli/src/commands/` has only `create.js, doctor.js, init.js, keys.js, migrate.js, pm2.js` — no backup/export. `keys.js` (lines 21-22) rotates `SELVA_AT_REST_KEY` with a confirm prompt but no export of the old key beforehand.
- **O6 — `/api/health` is boot-snapshot by design. [P3]** Confirmed live: `bootHealth.server.ts:35,128-137` caches on first run, never invalidated; the file's own comment (124-126) states this is intentional. **Decision to revisit, not a bug.**

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
