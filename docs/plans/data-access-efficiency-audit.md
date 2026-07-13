# Selva Pre-Scale Audit — Open Items

**Started:** 2026-07-05 (branch `beta`) · **Trimmed:** 2026-07-13 (done items removed) · **Re-verified against source:** 2026-07-13 (2d/3d/S5 found already fixed and removed; 4b/4g/S2 found partially fixed and reworded — see git history for full write-ups and completion notes) · **Batch landed 2026-07-13:** 2g, 4e, 4f (cache-control + Zod→Set), S3, V1 — see per-item completion notes below (4f client-reuse still open)
**Context:** Full-stack audit run while there is ~1 real user — the cheapest possible moment to fix any of this. Scope: `packages/platform`, `packages/providers/local`, `packages/providers/supabase`, `packages/selva` server code, security, data-model irreversibility, test coverage/quality, operational readiness, client-side viewer memory, privacy claims, dependency health, and Rhino.Compute scaling.
**Not in scope:** `@selvajs/compute` (separate repo) — see [Not yet audited](#not-yet-audited).
**Related plan:** [Embeddable Server Layer](./embeddable-server-layer.md) — shares code with this audit; D5 (unversioned `/api/compute` contract) and B5 (in-process state vs multi-instance) are deferred into that plan's scope.
**How to use this doc:** Work top to bottom by priority. Status: `☐ open` / `▶ in progress` / `✅ done` / `🧊 deliberately deferred`.

---

## P2 — Medium priority (real but not urgent)

| Status | ID        | Item                                                                                                                              | Section                                      |
| ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| ☐      | **2e**    | Add `countMembers`/`countOrgMembers` to store interfaces (4 pages list-just-to-count)                                             | [§2](#2-route-handlers)                      |
| ☐      | **2f**    | Add `listPlatformProjects()`; stop the sequential cross-org walk                                                                  | [§2](#2-route-handlers)                      |
| ✅     | **2g**    | Parallelize two independent awaits in `admin/projects/[id]`                                                                       | [§2](#2-route-handlers)                      |
| ☐      | **2h**    | `/team` + `/team/members` re-list the same org roster on navigation                                                               | [§2](#2-route-handlers)                      |
| ☐      | **4b**    | Supabase: `listVersions` still drags full `schema` JSONB; `getConfig` still pulls `api_key` unconditionally on the hot solve path | [§4](#4-supabase-provider)                   |
| ☐      | **4c**    | Supabase: drop full event `data` JSONB from the audit list projection                                                             | [§4](#4-supabase-provider)                   |
| ☐      | **4d**    | Supabase: move profile mutations (star/unstar/recordRun) to a single RPC                                                          | [§4](#4-supabase-provider)                   |
| ✅     | **4e**    | Supabase: fold `touchLastLogin` into one conditional UPDATE                                                                       | [§4](#4-supabase-provider)                   |
| ◐      | **4f**    | Supabase: cache-control + Zod→Set landed; client-reuse still open                                                                 | [§4](#4-supabase-provider)                   |
| ☐      | **4g**    | Two composite indexes still missing (`definitions`+created_at, `audit_events`+id tiebreaker) — rest landed                        | [§4](#4-supabase-provider)                   |
| ☐      | **S2**    | Test/lint forbidding ungated `SYSTEM_CONTEXT` calls — RLS half already landed                                                     | [§S](#s-security-posture)                    |
| ✅     | **S3**    | Enforce minimum secret length for `SELVA_HMAC_KEY` — token + session halves both landed                                           | [§S](#s-security-posture)                    |
| ☐      | **S4**    | Validate `ORIGIN` at boot; consider explicit Origin allowlist for state-changing API routes                                       | [§S](#s-security-posture)                    |
| ☐      | **D2**    | Reconcile definition-status enum across DB/TS/Zod (3-line fix, zero rows affected today)                                          | [§D](#d-data-model-irreversibility)          |
| ☐      | **D3**    | Add version/envelope to `audit_events.data` before the table fills                                                                | [§D](#d-data-model-irreversibility)          |
| ☐      | **D4**    | Decide single-org-by-design vs. reserve the `/o/{slug}/` URL shape before external links exist                                    | [§D](#d-data-model-irreversibility)          |
| ☐      | **D5**    | Version the `/api/compute` wire contract + wrap the response in an envelope                                                       | [§D](#d-data-model-irreversibility)          |
| ☐      | **D6/D7** | Confirm intended org-delete semantics (partially lossy today); note on storage-visibility-as-path-prefix                          | [§D](#d-data-model-irreversibility)          |
| ☐      | **Q1**    | Conformance suites: make the deny-direction tests actually run (currently gated off everywhere in CI)                             | [§Q](#q-test-quality)                        |
| ☐      | **Q4/Q5** | Test-quality strengthening + top missing high-value cases                                                                         | [§Q](#q-test-quality)                        |
| ☐      | **O4**    | Structured logging (pino + request-ID) instead of console soup                                                                    | [§O](#o-operational-readiness)               |
| ☐      | **O5**    | Backup/export tooling for local-provider data                                                                                     | [§O](#o-operational-readiness)               |
| ✅     | **V1**    | Call `renderer.forceContextLoss()` on viewer teardown (WebGL context accumulation)                                                | [§V](#v-client-side-viewer-memory)           |
| ☐      | **P1**    | Reword the privacy claim in CLAUDE.md; fix erasure gaps (invites, audit events)                                                   | [§P](#p-privacy-claim)                       |
| ☐      | **B1–B5** | Scaling roadmap: async solve jobs + queue UX, compute pooling, ADR 0003 streaming, audit retention/partitioning, per-org metering | [§B](#b-scaling-roadmap-selva-at-1000-users) |
| ☐      | **B9**    | `solve_metrics`: one unbatched INSERT per solve attempt — buffer + batch flush                                                    | [§B](#b-scaling-roadmap-selva-at-1000-users) |
| ☐      | **LB**    | Compute load-balancing groundwork: write the ADR, send definition-guid as routing header, keep server identity as an id not a URL | [§LB](#lb-rhino-compute-load-balancing)      |

---

## P3 — Low priority / cheap cleanups / deferred

| Status | ID          | Item                                                                                        | Section                                         |
| ------ | ----------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| ☐      | **S6**      | Optional magic-byte check on `.gh`/`.ghx` upload (compute already rejects bad files)        | [§S](#s-security-posture)                       |
| ☐      | **O6**      | `/api/health` is boot-snapshot only — add a short-TTL live check or `/api/ready`            | [§O](#o-operational-readiness)                  |
| ☐      | **Q3**      | Delete/slim ~12 low-value or duplicated tests                                               | [§Q](#q-test-quality)                           |
| ☐      | **V2**      | Optional: Blob+`createObjectURL` instead of doubled base64 data-URL for large image outputs | [§V](#v-client-side-viewer-memory)              |
| ☐      | **V3**      | Note only: server-side `TextureAssetStore` never evicts (Rhino-session scope, not browser)  | [§V](#v-client-side-viewer-memory)              |
| 🧊     | —           | Plugin C# runtime quality (lower blast radius, best-tested part of the repo already)        | [Deliberately deferred](#deliberately-deferred) |
| 🧊     | —           | Accessibility / i18n                                                                        | [Deliberately deferred](#deliberately-deferred) |
| 🧊     | —           | Docs accuracy drift (e.g. `docs/Caching.md`)                                                | [Deliberately deferred](#deliberately-deferred) |
| 🧊     | —           | License-compliance scan, website package                                                    | [Deliberately deferred](#deliberately-deferred) |
| 🧊     | **Compute** | Audit `@selvajs/compute` itself (separate repo — solve client, scheduler, binary parser)    | [Not yet audited](#not-yet-audited)             |

---

## Open research questions

1. **Count methods (→ 2e):** exact interface shape — per-entity `count*` vs a `Page.totalCount` option on existing `list*`?
2. **RLS coverage (→ S2):** which `selva.*` tables currently have policies at all, and do they mirror `access.server.ts` semantics?

---

# Section detail

Terse reference for each open item. Full research narrative for completed items lives in git history (pre-2026-07-13 revisions of this file).

## 2. Route handlers

- **2e** — `team/+page.server.ts`, `admin/organizations/+page.server.ts`, `team/projects/+page.server.ts`, `team/reclaim/+page.server.ts` all fetch full rosters (up to 1000 rows) just to read `.items.length`. Confirmed still open 2026-07-13 — `IOrgStore`/`IProjectStore` have no `countMembers`/`countOrgMembers`. Fix: `countMembers(ctx, projectId)` / `countOrgMembers(ctx, orgId)` on `IProjectStore`/`IOrgStore` (SQL `COUNT(*)`).
- **2f** — `admin/api/projects/+server.ts:54-63`, `admin/projects/+page.server.ts:37-48`: serial per-org `listProjects` + JS-filter to `visibility === 'platform'` (not even `Promise.all`'d). Confirmed still open 2026-07-13. Quick win: `Promise.all`. Real fix: `listPlatformProjects()`.
- **2g** — ✅ **Done 2026-07-13.** `admin/projects/[id]/+page.server.ts`: the three independent reads in the grants block (`listByProject` grants, `listOrgs`, `listUsers`) are now a single `Promise.all` instead of serial awaits. `getDefinitionMeta().listByProject` stays in its own earlier try/catch (independent non-fatal block, different failure semantics).
- **2h** — `/team` and `/team/members` both call `listOrgMembers` for the same org on navigation. A `+layout.server.ts` now exists but only fetches the org record for the header chip, not rosters — confirmed still open 2026-07-13. Hoist into the layout + `parent()`, or moot once 2e lands.

## 4. Supabase provider

- **4b** — ~~`select('*')`~~ eliminated everywhere (confirmed 2026-07-13, repo-wide grep clean) — but the two named worst offenders remain: `listVersions` (`SupabaseDefinitionStore.ts:245-261`) uses an explicit column list that still includes `schema` (the JSONB) — fetch `schema` only in `getVersion`. `SupabaseComputeServerStore.getConfig` (lines 53-65) still selects `api_key` unconditionally, and it's on the hot solve-resolution path (`resolve.server.ts:42`).
- **4c** — `SupabaseAuditQuery.ts:35` pulls full `data` JSONB per row (up to 200/page). Confirmed still open 2026-07-13. Drop from list projection, fetch lazily on expand.
- **4d** — `SupabaseUserProfileProvider.ts:73-136` `starDefinition`/`unstarDefinition`/`recordRun`: read-modify-write, 2 round-trips + documented lost-update race (code comment at lines 79-81 acknowledges it). Confirmed still open 2026-07-13. Fix: `SECURITY DEFINER` RPC with `array_append`/`array_remove`/dedup+cap in one statement.
- **4e** — ✅ **Done 2026-07-13.** `touchLastLogin` is now a single `UPDATE ... .eq(user_id).or('last_login_at.is.null,last_login_at.lt.{cutoff}')` — the select + conditional write collapsed into one round-trip; the debounce cutoff is computed client-side (`Date.now() - 60_000`) and the WHERE clause no-ops recent writes. One SQL statement per login instead of two.
- **4f** — Partial. ✅ **cacheControl** landed: `put` now sets `cacheControl: '31536000'` on upload (objects are content-addressed/immutable → year-long CDN+browser cache). ✅ **Zod→Set** landed: `filterValid` now checks a module-level `Set(ALL_PLATFORM_PERMISSIONS)` via `.has()` instead of `safeParse` per string per row. ☐ **Still open — client-reuse:** Auth/storage providers each `createClient` independently instead of reusing the data-layer `ClientBundle` (lowest-impact of the three, clients are lazy; left for a follow-up).
- **4g** — Re-checked against migrations 2026-07-13: GIN on `platform_permissions`, `org_members(user_id, deleted_at)`, `projects(org_id, deleted_at)` + unique `(org_id, slug)`, and unique `token_hash` on both share_links/invites all **landed**. Still missing: `definitions` partial index has `project_id` but not `created_at` (so ORDER BY created_at still sorts unindexed), and `audit_events` has `occurred_at desc` + secondary `type`/`actor_id` indexes but no `id` tiebreaker — the keyset cursor (`SupabaseAuditQuery.ts:36-37`) pages on `(occurred_at desc, id desc)` without full index backing.

## B. Scaling roadmap (Selva at 1000 users)

Assumption: 1000 registered users ⇒ Supabase provider, adapter-node behind reverse proxy, one+ Rhino.Compute servers. Realistic concurrency ~50–150 active sessions, slider-scrubbing solve storms as peak load. **Verdict:** web tier + Postgres handle it fine once audit items land; the real constraint is **Rhino.Compute capacity**.

- **B1 — Rhino.Compute saturation (the real ceiling).** Existing mitigations good (client throttle, rate limit, cachesolve, pointer reuse). Missing: queue/backpressure UX (users see hangs not "#4 in queue"); compute pool (server selection is per-org single config — one busy org saturates its one server); scheduler is per-app-instance (multi-instance ⇒ oversubscription); no per-org metering/quotas.
- **B2 — Auth: GoTrue round-trip per request.** At 1000 users this is a latency floor + Supabase auth rate-limit outage risk. (Already fixed for the request path per §1b; flagged here as a scale-mandatory item, revisit revocation-latency design under real load.)
- **B3 — Memory: base64 solve payloads through the Node heap.** Up to 200-300MB/solve, fully buffered; V8 ~512MB string wall documented in `computeLimits.ts`. Ten concurrent large solves ⇒ OOM risk. **ADR 0003 (stream large outputs out-of-band via storage) becomes mandatory** at scale. Also: revert TEMP dev caps in `computeLimits.ts` (50→300MB upload, 210→300MB body) before any production release.
- **B4 — Database hot spots.** Missing indexes (see 4g), especially `share_links.token_hash` (hit on every unauthenticated share solve). Audit events unbounded growth — need retention/partitioning before admin audit page + inserts degrade. `definition_versions.schema` JSONB bloat (see 4b). `recordRun` per solve (see 4d) — RPC fix becomes needed, not nice-to-have, at volume.
- **B5 — Multi-instance drift (in-process state).** Per-instance rate-limit buckets, per-instance remote-definition/getIO caches, ensureUser/first-run flags (harmless, idempotent). Decide: accept N× semantics, or move rate limiter to Redis (caches are fine per-instance). Both rate-limiter `Map`s never evict dead keys — slow leak, add periodic sweep.
- **B9 — `solve_metrics`: one unbatched INSERT per solve attempt.** `SupabaseSolveMetricSink.ts:18-33` — confirmed still open 2026-07-13, fire-and-forget but one row per attempt, no batching/queue. Slider scrubbing (~100 active users) ⇒ hundreds of inserts/sec against the same Postgres serving auth. Fix: buffer + periodic batch flush behind `ISolveMetricSink`, or sample non-error metrics under load (keep failures unsampled — they feed alerting).

**Missing production-grade features (beyond efficiency):** async solve jobs (100s solves die at proxy/platform timeouts + on deploy — need job-queue/polling or SSE); aggregated observability (latency percentiles, queue depth, compute utilization, error-rate alerting); graceful shutdown/zero-downtime deploys; load testing (nothing exercises concurrent solve load — k6/artillery scenario needed); backup/DR posture for storage buckets (Postgres PITR covered, blobs are not); abuse surface on public share links (per-IP limits, CAPTCHA/turnstile at scale).

## LB. Rhino-Compute load balancing

Today: resolution returns exactly ONE `ComputeServerConfig` (definition pin → org default → global default). A naive HTTP LB (nginx round-robin) would actively hurt this system — the definition-pointer cache and `cachesolve` result cache are both per-VM, so round-robin divides hit rate by N and can trigger the silent-empty-geometry failure mode (`computeLimits.ts:138-144`).

**Routing law: solves must route by definition affinity** (hash definition guid → pool member) — both caches key on the definition.

**Already future-proof:** pins/org-defaults/shares reference a server **id**, never a URL — pooling can happen later without touching stored references.

**Ground to lay now:**

1. Write the ADR: routing law = definition-guid affinity; server identity = id (URLs are resolution detail); pool membership is an additive `ComputeServerConfig` change later.
2. Send definition guid as a header (`X-Selva-Definition`) on every solve/getIO request — one line, enables any future LB to do affinity without parsing the POST body.
3. Keep per-server health probing (`admin/api/compute/status`) — becomes pool-member liveness source.

**Defer:** the LB itself, autoscaling, cross-instance admission control, queue service. **Recommendation when the time comes:** app-level pooling over an infra LB (app already holds per-server schedulers with queue-depth awareness; API-key-per-server model doesn't fit a shared LB URL; per-org quotas want to live at the same decision point).

## S. Security posture

- **S2 — App-layer gates are the only defense on service-role paths.** `packages/providers/supabase/src/data/client.ts:81-98` `forRequest(ctx)` returns the RLS-bypassing `serviceClient` whenever `ctx.system === true`. No concrete hole found (admin routes gate before every `SYSTEM_CONTEXT` call), but one missing `require*` gate = full cross-tenant breach with no RLS backstop. **Re-checked 2026-07-13: (a) RLS policies now landed on every `selva.*` table** (`20260425155514_selva_initial.sql` — orgs, org_members, projects, project_members, definitions, definition_versions, invites, compute_servers/shares/defaults, share_links, user_profiles, audit_events). Still open: (b) test/lint asserting no route handler passes `SYSTEM_CONTEXT` without a preceding gate — no such rule or test exists; (c) regression-pin the fail-closed anon default in `client.ts`.
- **S3 — Secret strength enforced.** ✅ **Done 2026-07-13.** `LocalAuthProvider.fromEnv` now rejects `SELVA_HMAC_KEY` shorter than 32 chars (local `MIN_HMAC_SECRET_LENGTH = 32`, same error copy + `openssl rand -base64 32` hint as `createTokenCodec`). Constant is inlined rather than imported because the local provider has no `@selvajs/server` dependency. Token half was already done via `createTokenCodec` (`MIN_TOKEN_SECRET_LENGTH = 32`); `SELVA_AT_REST_KEY` already enforced 32 bytes. All three secret classes now have a strength floor.
- **S4 — CSRF/Origin.** No `csrf` override in `svelte.config.js` — SvelteKit's built-in Origin check applies but only covers form content types; JSON POSTs on cookie-authed API routes have no explicit server-side Origin assertion. CSP/frame-ancestors deliberately deferred for iframe embedding, removing a layer. Confirmed still open 2026-07-13 (no boot-time `ORIGIN` validation, no allowlist). Fix: validate `ORIGIN` at boot; consider explicit Origin allowlist for state-changing API methods.
- **S6 — Definition upload validated by extension only.** `api/definitions/+server.ts:31-45` — `.gh`/`.ghx` extension + size only; content validation effectively delegated to compute (schema extraction fails upload for non-GH bytes). Confirmed still open 2026-07-13. Optional hardening: magic-byte check before the compute round-trip.

## D. Data-model irreversibility

All items in this section confirmed still open 2026-07-13 (source re-checked line-by-line against the original claims).

- **D2 — Definition status enum drift.** DB CHECK allows 5 values (`pending,draft,review,published,archived`, `20260425155514_selva_initial.sql:476`); TS type (`definitions/types.ts:28`) has 4 (missing `review`); Zod (`definitions/schemas.ts:7`) has 3 (missing `pending`,`review`). Reconcile while zero rows use the divergent values — decide first whether `pending`/`review` are real states (widen TS+Zod) or dead (tighten CHECK).
- **D3 — Audit event payload unversioned.** `audit_events.data` is the raw `DomainEvent` union with no envelope/version (table still `id, type, actor_id, occurred_at, data jsonb` — no `event_version` column). Append-only forever-table — add `{ v: 1, ... }` or an `event_version` column now while nearly empty, or document `data` as opaque/non-queryable.
- **D4 — Single-org membership baked into bootstrap.** DB is multi-org-ready (composite PK on `org_members`), but `buildContext`/`findUserMembership` still collapses to ONE org and `ctx.actingOrgId` has no switch mechanism; no `/o/[slug]/` route segment exists anywhere. Decide now: single-org by design, or reserve the URL shape before external links exist.
- **D5 — `/api/compute` contract unversioned.** `ComputeRequest` (`api/compute/+server.ts:36-47`) still has no version field; response is still a raw envelope/`JSON.stringify` with no version wrapper. Add a version marker (`/api/v1/compute` or `v` field) + response envelope while there's only one client.
- **D6/D7 — Smaller decisions.** `SupabaseOrgStore.deleteOrg` (`:140-217`) still mixes soft-delete (org/projects/members) with hard-delete (invites, compute server org-defaults/shares/scoped-servers) — now has a comment justifying it, but restore is still lossy for those four tables; confirm intended. Storage visibility encoded in path prefix (`branding/` vs `private/`) — changing visibility means moving the object (low likelihood, note only).

## T/Q. Test quality

- **Q1 — Deny-direction of store conformance suites never runs.** Shared suites in `packages/platform/src/testing/suites/` have proper cross-org/cross-user rejection tests, gated behind `ctxIsolation: true` — which is set **nowhere** in the repo (re-verified 2026-07-13: none of the 4 real conformance call sites in local or Supabase providers pass it; no Supabase CI job exists — `test.yml` still self-skips Supabase conformance for lack of a live stack). Dead in both providers. Fix: CI job with `supabase start` + migrations + `.env.test`, pass `ctxIsolation: true` from Supabase conformance invocations, make `readEnv` throw (not silently skip) when `SUPABASE_URL` is set but the client can't construct, convert capability-absent silent returns to `it.skip`.
- **Q4 — Tests needing strengthening.** `scenarios.test.ts` `.resolves.toBeDefined()` assertions should assert the returned identity/project like their stronger siblings. `patch-member.test.ts` cross-tenant case is self-admittedly ambiguous — give the actor permission in their own org and assert the cross-org 403 still holds. `upload-schema-gate.test.ts` hand-builds locals/event instead of the shared `call()`/`actAs()` path. `bootstrap-admin.test.ts` describes the concurrent first-signin race in prose but never exercises it.
- **Q5 — Top missing high-value cases (ranked by blast radius):**
  1. Endpoint-level share-cap enforcement — a share-token solve AT `maxSolves` must be rejected by `/api/compute` itself (units pass individually; handler wiring unverified).
  2. Concurrent `tryIncrementSolveCount` against a capped link (`Promise.all` ×N) — local's whole-file read-modify-write likely over-counts under contention. Same class: two concurrent `addOrgMember` (lost-update).
  3. Rate-limit key selection at the endpoint — nothing verifies anonymous share solves key on `share:{linkId}` vs `user:{userId}`.
  4. `hmac.ts` direct tests: tampered signature, tampered payload, expired token, length-mismatch. Plus `fsJson.ts` direct tests: crash-safety, missing-file fallback isolation.
  5. Privilege-escalation direction in member PATCH untested (admin granting owner-only perms to self/peer admin).
  6. Pagination cursor stability under insertion (raw offset cursor — insert-between-pages skips/duplicates). Honorable mention: unicode case-folding drift (JS `toLowerCase()` vs Postgres `lower()`).
  7. Product's core loop has zero E2E: authed user → upload → set input → solve → binary geometry → render. Related: `BinaryGeometryWriterTests.cs` verifies against a C#-reimplemented decoder, not the shipping JS parser.
  8. `SchemaMigrator` hostile input untested (`schemaVersion: "abc"` throws unguarded `FormatException`); golden fixtures stop at v2.4.0, real 2.9.0/2.10.0 transformations have no full-pipeline fixture. Feeds the D1 decision directly.
- **Q3 — Deletable/slimmable tests:** `.NET`: `Plugin/Selva.Drawing.Tests/SmokeTests.cs` (`Assert.True(true)`, delete); `Plugin/Selva.Tests/JsonSchemaTests.cs` (strict subset of `SchemaValidatorTests`, delete); `SchemaMigratorTests:181` overlaps `:160` (merge). TS: `definitionStoreSuite.ts` "versioning scaffold" test restates factory defaults (delete); `storageProviderSuite.ts` `getPublicUrl` pair (keep one of three); `compute-server-encryption.test.ts` "preserves servers with no apiKey" (duplicated, delete); `HeaderAuthProvider.test.ts` "reads custom header names" (redundant, slim); `updateCheck.test.ts`/`releaseChannel.test.ts` implementation-detail pins (fold/drop); `scenarios.test.ts` pure-rule matrices (relocate to `@selvajs/platform`); three identical `create populates createdBy/updatedBy` tests across suites (one shared helper).

## O. Operational readiness

- **O4 — Logging is unstructured console soup.** Re-checked 2026-07-13: still ~191 `console.*` calls repo-wide, no `pino` dependency anywhere, no request-ID correlation. Introduce pino + request-ID in hooks; keep prefixes as `component`.
- **O5 — Local-provider data has no backup/export tooling.** Confirmed still open 2026-07-13 — CLI only has `init, doctor, start, stop, restart, logs, update, migrate, keys`; `migrate` only rewrites deployment config, not a data export. No `selva backup`/export command; no local→supabase migration path for graduating deployments.
- **O6 — `/api/health` is boot-snapshot only.** Confirmed still open 2026-07-13 — `bootHealth.server.ts` explicitly documents it never auto-refreshes (restart required). LB-facing probe stays 200 after DB/compute die post-boot. Reuse the admin-gated live checks with a short-TTL cache in `/api/health` or a separate `/api/ready`.

## V. Client-side viewer memory

Headline: hot path is safe (per-solve disposal, teardown, WS ring buffer all correct — see prior audit for detail).

- **V1 — `renderer.forceContextLoss()` on teardown.** ✅ **Done 2026-07-13.** `Viewer.svelte`'s `onMount` now captures `init.renderer` and calls `renderer.forceContextLoss()` after `init.dispose()` in cleanup, releasing the GL context on every `{#key}` definition switch instead of leaving it for GC to reclaim (browsers cap live contexts at ~16). Still worth upstreaming into the library's own `dispose()` so every consumer gets it — tracked separately.
- **V2 — Base64 image outputs transiently doubled in heap.** Confirmed still open 2026-07-13 — `ImageOutput.svelte:27-35` still string-concats base64 into a `data:` URL. Churn, not a leak. Optional: decode to Blob + `createObjectURL` with revocation if image payloads grow.
- **V3 — Note only.** Server-side `TextureAssetStore` (content-addressed `ConcurrentDictionary`) has no eviction — lives for the Rhino session. Client side it's upside (hash-keyed URLs, HTTP-cache dedupe). Flag only for long-lived plugin sessions with many distinct textures.

## P. Privacy claim

**Verdict:** the CLAUDE.md "zero exposure to EU data regulations, credentials, or company user records" claim overclaims (confirmed verbatim in CLAUDE.md:199, 2026-07-13) — lives only in CLAUDE.md (`docs/providers.md` is already appropriately hedged).

- **P1 fixes:** Reword CLAUDE.md — drop "zero exposure"/"exclusively"/"only", state what IS stored per provider and that the operator is the data controller responsible for retention/erasure. Erasure: `SupabaseDataProvider.onUserDeleted` (`:216-218`) is still a no-op ("FK cascade handles it", confirmed 2026-07-13, no actual scrubbing of `audit_events`/invites) — make it scrub the user's `audit_events` rows and invites by email; purge accepted/expired invites by age. Retention: `pg_cron` (or documented manual) purge policy for `audit_events` + `solve_metrics` (dovetails with B4). Optional: HMAC the IP before using it as the rate-limit key.

**Contradictions found (context for the reword):** Selva IS the auth provider in local mode (`auth-users.json` stores email + PBKDF2 hash) — "credentials owned exclusively by the auth provider" is misleading when Selva ships that provider. "Stores only tokens + id + perms" is incomplete — also persists display names, invite emails, audit-event payloads with emails, solve telemetry. No right-to-erasure guarantee — invite rows keep email forever, Supabase `audit_events` never purges (`onUserDeleted` is a no-op). IPs processed by login rate limiter but transient/in-memory/≤15min/never persisted (lowest risk).

---

# Not yet audited

- **`@selvajs/compute`** — separate repo (catalog `^3.1.0-beta.1`), contains the solve client, `SolveScheduler`, data-tree parsing, JS binary-geometry parser. Two real production bugs already traced there (pointer-cache silent-empty-geometry; TreeBuilder flattening geometry trees). Deserves the same pass this repo got. Caching sub-audit partially done — see `selva-compute/CACHING.md` and `selva-compute/ISSUES.md` 114–116 for filed package bugs. Two findings live in _this_ repo from that pass:
  - **Per-server solve serialization, no backpressure (B1-adjacent):** shared scheduler defaults `maxConcurrent` to 1 per compute server per app instance — one slow solve stalls everyone behind it; queue wait is unbounded and invisible (`timeoutMs` starts at execution, not enqueue); a disconnected client's queued request still runs to completion (`selva-compute` issue 46).
  - **Stale `X-Selva-Definition` header on shared clients (LB/ADR 0004 D2):** header is baked at client _build_ time from whichever definition first touches that server; later definitions on the same warm client send the wrong guid. Inert today (bad access-log telemetry) but mis-routes the moment a definition-affinity pool router keys on it.

## Deliberately deferred

- **Plugin C# runtime quality** (WebSocket server thread safety, Rhino document interaction, memory) — runs on user machines, lower blast radius, best-tested part of the repo already.
- **Accessibility / i18n** — revisit when selling into orgs that require it.
- **Docs accuracy drift** (e.g. `docs/Caching.md`) — fold into whichever fix touches each area.
- **License-compliance scan, website package** — low risk.
