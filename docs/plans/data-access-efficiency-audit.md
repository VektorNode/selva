# Selva Pre-Scale Audit — Open Items

**Started:** 2026-07-05 (branch `beta`) · **Last full re-verification:** 2026-07-16 — every open item below was re-checked line-by-line against current source. Shipped 2026-07-17: B5's memory half (surviving half re-scoped as B5-lb) and O4 (server path; browser/CLI scope recorded as O4-scope). Q6 was widened after O4 surfaced a second flaky file. Shipped 2026-07-18: Q5's last item (core-loop E2E) — Q5 closed, P1 empty.
**Context:** Full-stack audit run while there is ~1 real user — the cheapest possible moment to fix any of this. Scope: `packages/platform`, `packages/providers/local`, `packages/providers/supabase`, `packages/selva` server code, `packages/server`, `packages/compute` solve path, security, data-model irreversibility, test quality, operational readiness, client-side viewer memory, privacy claims, and Rhino.Compute scaling.
**Not in scope:** data-tree parsing and the JS binary-geometry parser in `packages/compute` — see [Not yet audited](#not-yet-audited).
**How to use this doc:** work top to bottom by priority. Status: `☐ open` / `▶ in progress` / `✅ done` / `🧊 deliberately deferred`.

> **Completed items are removed, not archived here.** Full write-ups for everything already landed live in git history. This doc is the open list only.

---

## Priority model

Ranked by **cost of fixing later ÷ cost of fixing now**, not by severity. Three things drive an item up:

1. **Irreversibility** — once rows/links/clients exist, the fix needs a migration or a compat shim. Cheap today, expensive at 100 users.
2. **Correctness with a live failure mode** — it can serve a wrong answer or corrupt state, at any scale.
3. **Load-bearing for scale work** — other planned work sits on top of it.

Everything else is efficiency, hygiene, or a decision to record. Real but not urgent.

---

## P0 — Do before the next release

**P0 is closed as of 2026-07-16** (B3, C1, P1-reword+erasure, D2, D3, D4, S2, X1 all shipped — see git history). Nothing currently open at this tier.

---

## P1 — High priority (correctness + load-bearing)

**P1 is closed as of 2026-07-18** (Q5's final item — the core-loop E2E — shipped; see §Q and git history). Nothing currently open at this tier.

---

## P2 — Medium priority (real but not urgent)

| Status | ID        | Item                                                                                        | Section                             |
| ------ | --------- | ------------------------------------------------------------------------------------------- | ----------------------------------- |
| ☐      | **4d**    | Supabase: move profile mutations (star/unstar/recordRun) to a single RPC — lost-update race | [§4](#4-supabase-provider)          |
| ☐      | **4g**    | Two composite indexes missing (`definitions`+created_at, `audit_events`+id tiebreaker)      | [§4](#4-supabase-provider)          |
| ☐      | **2e**    | Add `countMembers`/`countOrgMembers`; 8 call sites list full rosters just to count          | [§2](#2-route-handlers)             |
| ☐      | **2f**    | Add `listPlatformProjects()`; stop the serial cross-org walk                                | [§2](#2-route-handlers)             |
| ☐      | **4c**    | Supabase: drop full event `data` JSONB from the audit list projection                       | [§4](#4-supabase-provider)          |
| ☐      | **C3**    | Input values serialized ~5× server-side and ~4× client-side per solve                       | [§C](#c-solve-cycle)                |
| ☐      | **C4**    | 5–7 sequential DB reads per solve; a comment claims a rate-limit ordering that is false     | [§C](#c-solve-cycle)                |
| ☐      | **C9**    | Cache `/io` per definition version — every page load makes a blocking compute round-trip    | [§C](#c-solve-cycle)                |
| ☐      | **S4**    | Validate `ORIGIN` at boot; consider an Origin allowlist for state-changing API routes       | [§S](#s-security-posture)           |
| ☐      | **D6**    | Confirm intended org-delete semantics (4 tables hard-deleted, restore is lossy)             | [§D](#d-data-model-irreversibility) |
| ☐      | **Q6**    | Order-dependent `vi.mock` flakes in compute — **2 files**, one asserting nothing            | [§Q](#q-test-quality)               |
| ☐      | **Q4**    | Test-quality strengthening (weak assertions, hand-built fixtures, prose-only races)         | [§Q](#q-test-quality)               |
| ☐      | **O5**    | Backup/export tooling for local-provider data (`keys` rotates with no export hedge)         | [§O](#o-operational-readiness)      |
| ☐      | **B1–B4** | Scaling roadmap: async solve jobs, compute pooling, ADR 0003 streaming, audit retention     | [§B](#b-scaling-roadmap)            |
| ☐      | **B5-lb** | Decide: accept N× rate-limit drift across instances, or move the limiter to Redis           | [§B](#b-scaling-roadmap)            |
| ☐      | **LB-1**  | Fix the stale `X-Selva-Definition` header before any affinity router keys on it             | [§LB](#lb-compute-load-balancing)   |
| ☐      | **2h**    | `/team` + `/team/members` re-list the same org roster (moot once 2e lands)                  | [§2](#2-route-handlers)             |
| ☐      | **4f**    | Supabase auth/storage each `createClient` instead of reusing the data-layer bundle          | [§4](#4-supabase-provider)          |
| ☐      | **P-ret** | Privacy: no time-based retention purge on `audit_events` / `solve_metrics`                  | [§P](#p-privacy-claim)              |

---

## P3 — Low priority / cheap cleanups / decisions to record

| Status | ID           | Item                                                                                   | Section                             |
| ------ | ------------ | -------------------------------------------------------------------------------------- | ----------------------------------- |
| ☐      | **C8**       | Decision note: share-link cap burns on failed solves, never refunded                   | [§C](#c-solve-cycle)                |
| ☐      | **C6**       | L1 cache hit still pays full stringify + gzip (draft / quota-0 solves)                 | [§C](#c-solve-cycle)                |
| ☐      | **C10**      | Load path maps non-connection compute failures to 500 where "compute down" is 503      | [§C](#c-solve-cycle)                |
| ☐      | **Q7**       | Viewer has no DOM signal for rendered geometry; E2E parses a console telemetry line    | [§Q](#q-test-quality)               |
| ☐      | **S6**       | Optional magic-byte check on `.gh`/`.ghx` upload (compute already rejects bad files)   | [§S](#s-security-posture)           |
| ☐      | **O6**       | `/api/health` is boot-snapshot by design — decide if a live `/api/ready` is wanted     | [§O](#o-operational-readiness)      |
| 🧊     | **O4-scope** | Decision: browser + CLI packages stay on `console.*` (pino is server-only)             | [§O](#o-operational-readiness)      |
| ▶      | **Q3**       | Delete/slim ~12 low-value or duplicated tests (2 of ~12 done)                          | [§Q](#q-test-quality)               |
| ☐      | **V2**       | Optional: Blob + `createObjectURL` instead of doubled base64 data-URL for large images | [§V](#v-client-side-viewer)         |
| ☐      | **D7**       | Note only: storage visibility encoded as a path prefix                                 | [§D](#d-data-model-irreversibility) |
| ☐      | **V3**       | Note only: server-side `TextureAssetStore` never evicts (Rhino-session scope)          | [§V](#v-client-side-viewer)         |
| 🧊     | —            | Plugin C# runtime quality (lower blast radius, best-tested part of the repo)           | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | Accessibility / i18n                                                                   | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | Docs accuracy drift (e.g. `docs/Caching.md`)                                           | [Deferred](#deliberately-deferred)  |
| 🧊     | —            | License-compliance scan, website package                                               | [Deferred](#deliberately-deferred)  |

---

## Open research questions

1. **Count methods (→ 2e):** per-entity `count*` vs a `Page.totalCount` option on existing `list*`? Current calls silently truncate at their page limit, so today's counts are already wrong past 200/1000 — the fix is a correctness fix, not only an efficiency one.
2. **RLS parity (→ S2):** policies now exist on every `selva.*` table, but do they _mirror_ `access.server.ts` semantics? Untested in either direction (see [issue #146](https://github.com/VektorNode/selva/issues/146)).
3. **Draft-channel caching (→ C6):** should drafts get a short-TTL L2 rather than a bespoke envelope cache in front of L1?
4. **Does a real slider drag cost what we think? (→ C4)** Every §B/§C priority on the solve path is derived from code reading, never measured. The static trace turned up a likely user-facing contradiction — the 150ms slider debounce permits ~6.6 solves/sec while the rate limit allows 1.2/sec sustained — plus ~8 uncached DB reads per solve and single-flight coalescing that is inert whenever `SOLVE_CACHE_PROVIDER=off` (the default). **B9 (solve-metric batching, shipped 2026-07-17) is the cautionary tale: it was ranked P1 from exactly this kind of reasoning and the subsequent end-to-end trace put it ~5th on the path.** Measure one real drag before prioritizing the rest — see [verify-slider-drag-solve-path.md](./verify-slider-drag-solve-path.md).

---

# Section detail

## C. Solve cycle

Full trace: input change → debounce → client throttle/memo → `POST /api/compute` → route (auth/rate-limit/DB/byte-cache) → single-flight → pipeline (L2 → scheduler L1 → pointer solve → Rhino `cachesolve`) → serialize/gzip → response → parse → three.js render.

**Verdict:** the cache layering is sound and consistently keyed (immutable version ids, org-scoped L2, `algo`-stripped responses, lazy `DefinitionRef`, latest-wins client throttle). Worth keeping: async gzip off the event loop, gzip-at-rest L2 hits that skip stringify entirely, streamed size-capped remote fetch, definition hashed once per solve, error contexts that summarize instead of pinning multi-MB trees. The items below are the gaps.

- **C3 — Redundant input-tree serialization. [P2]** Server, per fresh solve: coalesce key (`api/compute/+server.ts:336`), L2 key (`solve-cache-key.ts:78` via `solve-pipeline.ts:246`), scheduler hash (`stable-hash.ts:148`), wire body (`compute-fetch.ts:797`), plus response `JSON.stringify` (`solve-pipeline.ts:325`) — 5 linear passes over a potentially MB-scale tree. Client adds 4: memo key twice (`solveMemo.ts:17`, get + set), payload stringify (`library/[guid]/+page.svelte:72`), and an **unconditional** `JSON.stringify(values).length` whose only use is a log line (`:81` → `:238`, `:253`) — a full serialize thrown away every solve. Past 256 KB a whale loop re-stringifies every input on top (`:243-246`). **Cheapest win: delete the unconditional size log** (or gate it behind the debug flag). The rest: derive one canonical string per boundary and thread it through — the L2 key and scheduler hash already share `stableStringify` and parity is a stated requirement, so reuse is safe by design.
- **C4 — Hot-path reads per solve. [P2]** **5 sequential awaited DB reads** on the common logged-in path, 7 with a share link: `tryResolveShareToken` (`:140`), `definitions.get` (`:201`), `projects.getProject` (`:209`), access check (`:217`/`:222`), `definitions.getVersion` (`:232`), `tryIncrementSolveCount` (`:274`), `resolveServerForOrg` (`:285`). Bytes and warm clients are cached; the records are not — so a same-definition slider re-solve pays all of them. (`resolveServerForOrg` is now two cheap reads rather than a decrypt-everything scan — see 4b in git history — but it is still uncached.)
  **Also a false comment:** `:177` reads _"Per-key rate limit; runs before DB reads so throttled callers don't burn quota"_ — but `tryResolveShareToken` (`:140`) is an awaited DB read ~37 lines earlier, and it must be, since the rate key at `:178` derives from `sharedAccess.link.id`. Either pre-key on the raw token to make throttled share callers genuinely DB-free, or fix the comment.
- **C6 — L1 hits still pay full serialize + gzip. [P3]** `solve-pipeline.ts:349` gates the skip on `willCache = args.solveCache != null`; the early return at `:253-261` needs L2. So a **scheduler-L1 hit with no L2 hook** (draft channel, quota-0) skips Rhino but still runs `JSON.stringify` (`:325`) and gzip (`:354`) per request. `settle.fromCache` is available but only read afterwards for telemetry (`:382`). The L2 path proves it's avoidable.
- **C7 — L2 collision defense is documented, not implemented. [P3]** `solve-cache-key.ts:7-8` promises the entry stores the canonical preimage "so a hit can compare it byte-for-byte (defense-in-depth)", and `:53-55` types `SolveCacheInputKey.canonical` for exactly that. But `EnvelopeHeader` (`solve-cache-envelope.ts:22-36`) has no `canonical` field, `solve-pipeline.ts:246` discards the preimage at derivation, and the hit check (`:472`) compares `inputHash` to `inputKey` — digest to digest, tautological against the storage key. SHA-256 collisions aren't a real threat, so **fix the doc, not the code** — and drop the dead `canonical` field from the return type.
- **C9 — Every `/library/{guid}` page load makes a blocking compute round-trip. [P2 — found 2026-07-18 while building the Q5 E2E]** `loadDefinitionForRender` (`packages/server/src/definitions/load-for-render.ts:182`) calls `client.getIO()` (`POST /io`) on **every** page load — the in-code comment says it is "always needed to merge compute default values into the schema, cached or not" — and a cold client pays the `GET /` liveness probe first. Two consequences: (1) **latency** — page render waits on compute even when the schema is cached on the version row; (2) **availability** — if compute is down, the user gets an error page instead of a degraded tool page with a "compute offline" notice; the E2E's first failure was exactly this (fake lacked `/io` → page 500'd before any solve was attempted). A definition version's bytes are immutable, so its `/io` response is deterministic — cache it on the version row next to the schema (ADR 0005 pattern, same staleness rule), which removes the round-trip _and_ makes page render survive compute outages. Note the `/io` response's `default` DataTrees are what get merged — cache the parsed result, not just the raw body. Related: §C's original transport trace covered only `/grasshopper` + `/grasshopper/schema`; `/io` was a blind spot (recorded in the Q5 write-up).
- **C10 — Load-path error mapping: the `schema` bucket conflates two operator stories. [P3]** Scope: the **page-load** path only (`library/[guid]/+page.server.ts:92-122`), which maps `DefinitionLoadError` kinds `missing-config`/`connect` → 503, `schema` → 500, `data` → 400. **Explicitly NOT in scope: the solve path's 500 on a Grasshopper solution reporting `errors` (COMPUTATION_ERROR on `POST /api/compute`) — that mapping is deliberate and stays.** The nuance: `schema` covers both "compute genuinely answered but IO/schema extraction failed" (a fair 500) and "the thing at the configured URL is not a working compute" — a proxy 404 fronting a dead server, a wrong host (observed: `Endpoint not found: …/io` → HTTP 500). The second shape is operationally the same operator-must-act condition as `connect` and should read 503. Cheap; dovetails with C9 (which removes most of the exposure).
- **C8 — Decision note: share-cap burns on failed solves. [P3]** `tryIncrementSolveCount` runs before the solve (`:272-283`) and is refunded on no failure path — `timeout`, `client_abort`, `too_large`, `shed`, `compute_error` all error out without decrementing. Defensible, but `shed` is the sharp edge: it's an explicitly retryable 503 where the solve never reached compute, so a well-behaved client backing off and retrying pays each time. **Confirm intended, like D6.** Related: local's whole-file read-modify-write means a concurrent `revoke` racing an increment can be _lost_ entirely, not just over-counted — characterized in `providers/local/src/data/__tests__/concurrent-writes.test.ts` (Q5.2).

## B. Scaling roadmap

Assumption: 1000 registered users ⇒ Supabase provider, adapter-node behind a reverse proxy, one+ Rhino.Compute servers. Realistic concurrency ~50–150 active sessions, slider-scrubbing solve storms as peak load. **Verdict:** web tier + Postgres are fine once the audit items land; the real ceiling is **Rhino.Compute capacity**.

- **B5-lb — Multi-instance rate-limit drift. [P2, surviving half of B5]** The memory half of B5 shipped 2026-07-17 (bucket eviction — see git history); every in-process Map is now bounded. What remains is the decision the original item paired with it: buckets are per-instance, so N instances behind a load balancer allow N× the intended per-key rate (acknowledged at `rate-limit.ts:8-11`). Moot at one instance. **Decide before the second instance exists:** accept N× and size the cap accordingly, or move the limiter to Redis. The state lives behind `createComputeRateLimiter` precisely so a shared-store implementation can slot in without touching call sites.
- **B1 — Rhino.Compute saturation (the real ceiling). [P2]** Selection is one config per org, narrowest-wins: definition pin → org default → global default (`platform/src/computeServer/utils.ts:66-86`, app wrapper `resolve.server.ts:37-47`). Mitigations are good (client throttle, rate limit, `cachesolve`, pointer reuse). Missing: queue/backpressure UX; a compute _pool_ (one busy org saturates its single server); cross-instance admission control; per-org metering/quotas.
- **B2 — Auth: GoTrue round-trip per request. [P2]** Fixed for the request path already; flagged here as scale-mandatory — revisit revocation-latency design under real load.
- **B4 — Database hot spots. [P2]** Missing indexes (4g). Audit events grow unbounded — need retention/partitioning before the admin audit page and inserts degrade. `recordRun` per solve (4d) becomes required, not nice-to-have, at volume.

**Missing production-grade features (beyond efficiency):** async solve jobs (long solves die at proxy timeouts and on deploy); aggregated observability (latency percentiles, queue depth, compute utilization, error-rate alerting); graceful shutdown / zero-downtime deploys; load testing (k6/artillery scenario needed); backup/DR for storage buckets (Postgres PITR covered, blobs are not); abuse surface on public share links (per-IP limits, CAPTCHA at scale).

## LB. Compute load balancing

ADR 0004 (Accepted, `docs/adr/0004-compute-server-identity-and-lb-affinity.md`) covers server identity and affinity design; the LB itself is deliberately unbuilt. One gap remains:

- **LB-1 — `X-Selva-Definition` is stale on warm clients. [P2]** The header is baked in `build(server, definitionGuid)` (`client-cache.ts:212-214`), which runs only on a cache **miss** (`:295`); a hit returns the existing entry and ignores `opts.definitionGuid`. So the header freezes to the first definition to touch that server and is then stamped on every later solve for every other definition on that client — compute-side access logs are actively wrong today, and it will mis-route the moment an affinity router keys on it. Fix needs a per-request header hook in the scheduler.

**Routing law when the time comes:** solves route by definition affinity (hash guid → pool member). Both the pointer cache and `cachesolve` key on the definition, so naive round-robin divides hit rate by N and can trigger the silent-empty-geometry failure mode (`computeLimits.ts:138-144`). Recommendation: app-level pooling over an infra LB.

## S. Security posture

- **S2(b) — No test/lint asserts route handlers gate before `SYSTEM_CONTEXT`. [P1, remaining half]** The only `no-restricted-properties` rule (`eslint.config.js:60`) is about `process.env`. No concrete hole found today (admin routes gate before every call), but one missed `require*` = cross-tenant read. (S2(a) — fail-closed anon default — is done, pinned by `client-fail-closed.test.ts`.)
- **S4 — CSRF/Origin. [P2]** No `csrf` override in `packages/selva/svelte.config.js`, so SvelteKit's default `csrf_check_origin: true` applies — but it only covers form content types; JSON POSTs on cookie-authed API routes get no explicit Origin assertion. No boot-time `ORIGIN` validation in app code. Fix: validate `ORIGIN` at boot; consider an allowlist for state-changing methods.
- **S6 — Upload validated by extension only. [P3]** `api/definitions/+server.ts:30-45` — extension + size, no magic bytes. Partial mitigant: `fetchSchemaFromCompute` (`:89`) parses before any persistence, so non-GH bytes fail there. Optional hardening.

## D. Data-model irreversibility

- **D6 — Org-delete semantics are mixed. [P2]** `SupabaseOrgStore.deleteOrg:140` soft-deletes `orgs`, `org_members`, `projects`, `project_members`, `definitions` but **hard-deletes** `invites`, `compute_server_org_defaults`, `compute_server_shares`, and scoped `compute_servers` (`:203-220`, rationale at `:201-204`: those tables have no `deleted_at`). Restore is knowingly lossy for four tables. Confirm that's intended — if restore is a real requirement, they need `deleted_at`.
- **D7 — Note only. [P3]** Storage visibility is encoded in the path prefix (`branding/` vs `private/`), so changing an object's visibility means moving it. Low likelihood; recorded, not actioned.

## 2. Route handlers

- **2e — 8 call sites list full rosters just to count. [P2]** `IOrgStore` and `IProjectStore` have no count method. Sites: `team/+page.server.ts:21-22,28-29`; `admin/organizations/+page.server.ts:21,26-27`; `team/projects/+page.server.ts:25,30-31`; `team/reclaim/+page.server.ts:36-38,43-46`.
  **This is a correctness bug, not just waste:** counts silently truncate at the page limit, so any org past 200 members already displays a wrong number. Fix: `countMembers(ctx, projectId)` / `countOrgMembers(ctx, orgId)` (SQL `COUNT(*)`).
- **2f — Serial cross-org walk to find platform projects. [P2]** `admin/api/projects/+server.ts:54-63` and `admin/projects/+page.server.ts:37-48` both `listOrgs(limit: 1000)` then loop `await listProjects(...)` per org — sequential, no `Promise.all` — and JS-filter `visibility === 'platform'`. Quick win: `Promise.all`. Real fix: `listPlatformProjects()`.
- **2h — Duplicate roster fetch. [P2]** `team/+page.server.ts:21` (`limit: 1000`) and `team/members/+page.server.ts:42` (`limit: 200`) both `listOrgMembers` for the same org. Differing limits mean the two calls aren't interchangeable as-is. Likely moot once 2e lands.

## 4. Supabase provider

- **4d — Profile mutations are read-modify-write with a known race. [P2]** `SupabaseUserProfileProvider.ts` `starDefinition`, `unstarDefinition`, `recordRun` — each is `getProfile` + `update`, 2 round-trips. The lost-update race is acknowledged in-code for `starDefinition` only; `recordRun` has the same exposure with no note, and fires on every solve, making it the actual hotspot. Fix: `SECURITY DEFINER` RPC with `array_append`/`array_remove`/dedup+cap in one statement.
- **4g — Two indexes missing. [P2]**
  - **`definitions` has no index covering `created_at`**, which is the **default** list order (`definitionOrderColumn:544-556`) — so the common `listDefinitions` path sorts unindexed.
  - **`audit_events` has no `id` tiebreaker.** `SupabaseAuditQuery.list` orders by `occurred_at desc, id desc` and keyset-seeks on it, but no index carries `id desc`.
- **4c — Audit list pulls full `data` JSONB. [P2]** `SupabaseAuditQuery.ts:35` selects `data` for up to 201 rows per page. Drop `data` from the list projection; fetch lazily on expand.
- **4f — Redundant Supabase clients. [P2]** `SupabaseAuthProvider.ts` and `SupabaseStorageProvider.ts` each `createClient` instead of reusing the data-layer `ClientBundle`. Lowest-impact of the set (clients are lazy).

## Q. Test quality

> **Q1 (Supabase untested in CI + dead deny-tests) moved to [issue #146](https://github.com/VektorNode/selva/issues/146)** — it is blocked on a prerequisite this doc can't resolve: a live Supabase test database in CI. Nothing about the deny-direction can be _verified_ without real Postgres + RLS to run against.

- **Q5 — Missing high-value cases. ✅ Closed 2026-07-18 — items 1–6 + 8 shipped 2026-07-17, item 7 (core-loop E2E) shipped 2026-07-18.**

  **Item 7 write-up (the core-loop E2E):** `packages/selva/e2e/core-loop.authed.spec.ts` drives the full loop in a real browser — authed admin → register compute server → upload a genuine UI Builder `.gh` through the real dialog (schema-extraction gate included) → `/library/{guid}` → solve → SLVA binary geometry decoded by the shipping JS parser → three.js render → slider change re-solves. It runs in two modes: **hermetic by default** (`e2e/helpers/fake-compute.ts` fakes Rhino.Compute at the HTTP transport seam — `GET /`, `POST /grasshopper/schema`, `POST /io`, `POST /grasshopper` — replaying schema/IO fixtures captured from a live VektorNode Compute and emitting real SLVA v3 blobs whose mesh count is a function of the `Count` input, so the test proves the input value crossed browser → server → compute → parser → render), and **live** via `E2E_COMPUTE_URL`/`E2E_COMPUTE_KEY`, where the same spec passed against a real Rhino.Compute — which also partially covers the C#-writer-vs-JS-parser drift concern in [Not yet audited](#not-yet-audited) (live mode only; the hermetic fake's encoder is TS, so CI alone still doesn't pin the C# end). "Rendered" is asserted via the page's own per-solve telemetry line (`mesh=<ms>ms (<count>)`) plus a visible non-zero canvas. Discovered along the way: the page-load path (`loadDefinitionForRender`) requires `POST /io` on the compute server — an endpoint the earlier §C transport trace missed because it only covered the solve route.

  **Shipped (see git history for the write-ups).** Each new test was mutation-checked — the guard it claims to enforce was broken deliberately and the test observed to fail. Writing them turned up **three real bugs**, all fixed:
  - **`writeJsonFile` was not concurrency-safe** (found via item 2). Every writer staged through a single shared `${filePath}.tmp`: the first `rename` moved it away and the rest died with **ENOENT**. Measured: **19 of 20** concurrent `tryIncrementSolveCount` calls threw. The audit predicted over-counting; the reality was a crash. Each write now stages through its own random temp name. Pinned by `providers/local/src/data/__tests__/concurrent-writes.test.ts` + `fsJson.test.ts`.
  - **`paginate` served the list tail on a negative cursor** (found via item 6). `parseInt('-5') || 0` kept `-5`, which reached `Array.slice(-5)` — a caller asking for page 1 got the last five rows. Offset is now clamped at 0.
  - **`SchemaMigrator.MigrateJson` threw a raw `FormatException`** on a malformed `schemaVersion` (item 8). Now an `IncompatibleSchemaException`, matching `ValidateCompatibility` — which the caller already renders as a clean "Incompatible schema" message.

  Two behaviors are recorded as **characterization tests** rather than asserted away: the local provider's read-modify-write still loses updates and can over-admit a share cap under concurrency (Supabase's RPC is the backend that actually provides atomicity), and the offset cursor still duplicates on insert / skips on delete. Both are documented single-node tradeoffs; if either is ever fixed, those tests turn red and should become guarantees.

  Items 1/3 needed a seam: the rate limiter gained `count(key)` (`@selvajs/server`) plus `resetComputeRateLimit` on the app binding, so a test can assert _which_ bucket a solve charged — the `share:{linkId}` vs `user:{userId}` choice is a security property an allow/deny verdict can't express.

  **Not covered:** the unicode case-folding drift noted as item 6's honorable mention (JS `toLowerCase()` vs Postgres `lower()`) — it needs a live Postgres, so it belongs with [issue #146](https://github.com/VektorNode/selva/issues/146). The .NET tests for item 8 **compile but were never executed**: `Selva.Tests` targets net8.0 and only the .NET 10 runtime is installed here.

- **Q6 — Order-dependent `vi.mock` flakes in `@selvajs/compute`. [P2 — broader than first recorded]** Two files, same root cause (a `vi.mock` whose spy is bypassed depending on module-init order), both passing in isolation and failing in a full-package run:
  1. `grasshopper-response-processor.test.ts` — the two file-download tests (the originally recorded case).
  2. **`scheduler/__tests__/solve-scheduler-hash-memo.test.ts`** — all three tests, failing with `expected "hashDefinition" to be called 1 times, but got 0 times`: the spy is never wired, so the assertion measures nothing. Found 2026-07-17 while landing O4 — an unrelated timing change in a _different package_ was enough to flip it into failing in default order.
     **Verified pre-existing, not caused by O4:** on a clean tree with all O4 work stashed, `vitest run --sequence.shuffle` fails 2 and 5 tests across consecutive runs. `packages/compute` has no dependency on `@selvajs/server` or `@selvajs/platform`, so there is no import-graph path by which O4 could reach it — the ordering is simply nondeterministic and default order happened to be lucky.
     **Why this outranks its P2 slot in one respect:** a `toHaveBeenCalledTimes` assertion against an unwired spy fails loudly here, but the same race in an assertion written the other way (`not.toHaveBeenCalled`, or any "no side effect happened" check) would pass **vacuously and silently** — a green test pinning nothing. Worth grepping the package for that shape while fixing. Fix: hoist the mocked imports, or make the seams non-lazy in tests. Repro: `pnpm --filter @selvajs/compute exec vitest run --sequence.shuffle` (several runs).
- **Q7 — No DOM signal that geometry rendered. [P3 — found 2026-07-18 while building the Q5 E2E]** `packages/ui` contains zero `data-testid` attributes, the viewer shows no mesh count, and the solving indicator is delay-gated (never shows for solves <200ms). The only machine-readable "N meshes rendered" signal is the page's `console.log` telemetry line (`mesh=<ms>ms (<count>)`, `library/[guid]/+page.svelte:258`), which the core-loop E2E regex-parses — so an innocent rewording of that log line breaks the E2E's central assertion. Fix is ~one line: stamp a `data-mesh-count={meshes.length}` attribute on the viewer container (or equivalent) and point the E2E at it; keep the log line as telemetry, not as a test seam.
- **Q4 — Tests needing strengthening. [P2]** `scenarios.test.ts` `.resolves.toBeDefined()` should assert the returned identity/project like its stronger siblings. `patch-member.test.ts`'s cross-tenant case is self-admittedly ambiguous. `upload-schema-gate.test.ts` hand-builds locals/event instead of the shared `call()`/`actAs()` path. `bootstrap-admin.test.ts` describes the concurrent first-signin race in prose but never exercises it.
- **Q3 — Deletable/slimmable (~12, 2 done). [P3]** Done: .NET `Selva.Drawing.Tests/SmokeTests.cs` (`Assert.True(true)`) deleted; `Selva.Tests/JsonSchemaTests.cs` + its `valid_schema.json` fixture deleted (confirmed strict subset of `SchemaValidatorTests.Fixture_ValidFile_PassesValidationWithNoErrors`, which already runs every fixture under `TestFiles/schemas/`). Still open — each needs a judgment call on which assertions to keep, not a mechanical delete: `SchemaMigratorTests:181` overlaps `:160` but covers a different legacy-vs-1.0.0 starting state (merge, don't just drop one). TS: `definitionStoreSuite.ts` "versioning scaffold" (delete); `storageProviderSuite.ts` `getPublicUrl` (keep one of three); `compute-server-encryption.test.ts` duplicate case (delete); `HeaderAuthProvider.test.ts` (slim); `updateCheck.test.ts`/`releaseChannel.test.ts` implementation-detail pins (fold/drop); `scenarios.test.ts` pure-rule matrices (relocate to `@selvajs/platform`); three identical `create populates createdBy/updatedBy` tests across suites (one shared helper).

## O. Operational readiness

- **O4-scope — Browser + CLI packages stay on `console.*`. [P3, successor to O4]** O4 shipped 2026-07-17 for the **server path only** (see git history): an `ILogger` seam in `@selvajs/platform`, pino behind it in `@selvajs/server`, request-id correlation in `hooks.server.ts`, and ~56 call sites converted across `packages/selva` server code, `packages/server` and the providers. Left deliberately unconverted: `packages/ui`, `packages/plugin-ui` and `packages/compute` (browser bundles — pino is a Node logger and has no business there), `packages/cli` (stdout **is** the product's UX, not a log stream), and `packages/website`. `SentryErrorReporter`'s two `console.error` calls also stay: they're the fallback for when the logging stack itself is broken. **This is a recorded decision, not a gap** — revisit only if a browser-side log-shipping story ever appears.
  **Retrospective on the P1 ranking:** O4 was ranked P1 as "load-bearing for B1/B4 observability", and that framing held up — but nothing was serving a wrong answer, so by this doc's own priority model it was groundwork, not correctness. The genuinely urgent thing turned out to be hiding _inside_ it (the PII leak below), and nobody had ranked that at all. Worth remembering when the next "hygiene" item gets a priority.
- **O7 — No lifecycle/dispose seam, so buffered sinks never drain on shutdown. [P2]** `SupabaseSolveMetricSink` buffers solve metrics and exposes `close()` to flush the last partial batch, but **nothing calls it** — there is no provider lifecycle hook anywhere for it to hang off. Consequence today is small (a hard kill loses ≤2s of telemetry, ≤100 rows), but it compounds: any future buffered/batched sink inherits the same gap, and `IDataProvider` has no `dispose()` for a graceful-shutdown story to build on. Dovetails with the graceful-shutdown item below and with B9's deferred half (sampling non-error metrics under load, still unimplemented). Fix: add a dispose seam to the provider interface, call it from a SIGTERM handler.
- **O5 — No backup/export for local-provider data. [P2]** `packages/cli/src/commands/` has `create, doctor, init, keys, migrate, pm2` — no backup/export. `keys.js` **rotates `SELVA_AT_REST_KEY`** (renders encrypted data unreadable) with no export path to hedge it. Also no local→supabase path for graduating deployments.
- **O6 — `/api/health` is boot-snapshot by design. [P3]** `bootHealth.server.ts` caches on first run by conscious design. Consequence: an operator who fixes a key via `/admin/compute` still gets 503 until restart. **Decision to revisit, not a bug** — if a live probe is wanted, add `/api/ready` with admin-gated live checks behind a short TTL and leave `/api/health` alone.

## V. Client-side viewer

Hot path is safe: per-solve disposal, teardown, and the WS ring buffer are all correct.

- **V2 — Base64 image outputs transiently doubled in heap. [P3]** `ImageOutput.svelte:32,34` string-concats into a data URL. Churn, not a leak. Optional: Blob + `createObjectURL` with revocation if image payloads grow.
- **V3 — Note only. [P3]** Server-side `TextureAssetStore` (content-addressed `ConcurrentDictionary`) never evicts — lives for the Rhino session. Flag only for long-lived plugin sessions with many distinct textures.

## P. Privacy claim

Deletion-triggered erasure is done (`onUserDeleted` scrubs `audit_events`, `invites`, redacts embedded emails, anonymizes `solve_metrics`) — see git history for the 2026-07-16 write-up. What's still open:

- **P-ret — No time-based retention. [P2]** `audit_events` and `solve_metrics` rows live forever until a subject is erased. Add a `pg_cron` (or documented manual) age-based purge (dovetails with B4 and D3). Optional: HMAC the IP before using it as a rate-limit key.

> **Closed 2026-07-17 — emails were being written to stdout.** Found incidentally while converting log calls for O4: `SupabaseEventSink` logged the entire `event` object on both of its failure paths (`console.error('[SupabaseEventSink] insert failed:', error.message, { event })`). Per the `DomainEvent` union, an `invite.created` payload embeds the invitee's **email address** — so an audit-insert failure copied that email into the process log. **This defeated the erasure work above:** `onUserDeleted` redacts the email out of the `audit_events` row, but has no reach into stdout, which by then may have shipped to a collector and been indexed by a third party. Now logs `eventType` + `actorId` only. Two lessons worth keeping: (1) the erasure story is only as good as the places data _escapes to_, and logs are an escape hatch no DB-side redaction can follow — worth a sweep if any other sink ever logs a payload wholesale; (2) nobody wrote `{ event }` intending to leak PII, which is exactly why the pino redaction backstop (`packages/server/src/logging/PinoLogger.ts`, `REDACTED_PATHS`) earns its keep — but note it scrubs by **field name**, so it would NOT have caught this one (the email was nested inside `event.data`). Field-name redaction is a backstop, not a substitute for not logging the object.

---

# Not yet audited

- **`packages/compute` — data-tree parsing and the JS binary-geometry parser.** The 2026-07-16 trace covered the solve client, `SolveScheduler`, caches, and compute-fetch transport line-by-line (§C). The parsers remain unread. `BinaryGeometryWriterTests.cs` verifies the C# writer against a C#-reimplemented decoder, not the shipping JS parser — so the format's two ends could drift while both suites stay green. Highest-value remaining unaudited surface.

## Deliberately deferred

- **Plugin C# runtime quality** (WebSocket thread safety, Rhino document interaction, memory) — runs on user machines, lower blast radius, best-tested part of the repo.
- **Accessibility / i18n** — revisit when selling into orgs that require it.
- **Docs accuracy drift** (e.g. `docs/Caching.md`) — fold into whichever fix touches each area.
- **License-compliance scan, website package** — low risk.
