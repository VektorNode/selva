# Selva Pre-Scale Audit — Master Tracker

**Started:** 2026-07-05 (branch `beta`) · **Last restructured:** 2026-07-05
**Context:** Full-stack audit run while there is ~1 real user — the cheapest possible moment to fix any of this. Scope: `packages/platform`, `packages/providers/local`, `packages/providers/supabase`, `packages/selva` server code, security, data-model irreversibility, test coverage/quality, operational readiness, client-side viewer memory, privacy claims, dependency health, and Rhino.Compute scaling.
**Not in scope yet:** `@selvajs/compute` (separate repo — solve client, `SolveScheduler`, binary geometry parser). Flagged as the single biggest remaining unaudited surface — see "Not yet audited" at the bottom.
**How to use this doc:** Work the **P0 → P3 table** top to bottom. Each row links to its full write-up further down (unchanged content, just re-homed under a stable ID). Mark the Status column as you go — `☐ open` / `▶ in progress` / `✅ done` — so this stays a living tracker instead of a report you read once.
**Related plan:** [Embeddable Server Layer](./embeddable-server-layer.md) — structural extraction of the compute server stack into a published package. Kept separate on purpose (this doc converges to done; that one is roadmap work), but they share code: audit fixes ✅2a/✅2b landed in the files that plan moves, its S2 store migration is the natural moment to also fix §4b's `select('*')`, and D5 (unversioned `/api/compute` contract) + B5 (in-process state vs multi-instance) are deferred _into_ that plan's scope.

**Validation pass (2026-07-05):** all P0–P2 findings were re-checked against current source on `beta` via a fan-out of file-level verifiers. Result: ~37 of ~40 spot-checked findings confirmed accurate against live line numbers. Corrections folded in-place (each tagged "verified/Correction 2026-07-05"): §3c is a **live** bug only in `LocalInviteStore` (latent in `LocalComputeServerStore`); T1's CI is three jobs not one (load-bearing claim intact); Q1's deny-direction tests are dead in **both** providers (`ctxIsolation: true` set nowhere), not Supabase-only; the privacy "zero exposure" wording lives **only** in CLAUDE.md, not `docs/providers.md`; §2e row caps vary (200 vs 1000); D2 drift is DB=5 / TS=4 / Zod=3. S1 (plaintext Supabase compute API keys) and D1 (unmigrated stored UISchema blobs) re-confirmed as the top security and data-model risks respectively.

---

## Status legend

| Symbol | Meaning                                        |
| ------ | ---------------------------------------------- |
| ☐      | Open — not started                             |
| ▶      | In progress                                    |
| ✅     | Done                                           |
| 🧊     | Deliberately deferred (not now, revisit later) |

---

## P0 — Blockers (do these first; everything else is safer/faster after)

These two make every subsequent fix verifiable. Nothing below should be worked without at least the first one in flight.

| Status | ID     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why P0                                                                                                    |
| ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ✅     | **T1** | Re-enabled `@selvajs/selva` tests in CI. The described teardown race no longer reproduces (5/5 + cold runs exit 0, no unhandled-rejection markers); the only real blocker was `setup.ts` mock drift — `getOrgAssetService` (added in `e4b40626`) wasn't forwarded, tripping the `mock-surface` drift guard. Fixed the mock, added both filters to `test.yml`.                                                                                                                                                                                                                                                                                         | Every safety net for the code the rest of this list touches exists on disk but doesn't gate PRs right now |
| ✅     | **O1** | Added a pluggable `IErrorReporter` (platform interface + `NoopErrorReporter`, mirrors `ISolveMetricSink`). Sentry-backed impl (`@sentry/node`, optionalDependency, dynamic-imported) activates only when `SENTRY_DSN` is set — no-op otherwise, so self-host stays dependency-free. Wired into `handleError` (fall-through path only) + process `unhandledRejection`/`uncaughtException` hooks. **Compute solve failures are NOT reported by design**: the compute route returns them as `apiError(500)` → `HttpError`, which short-circuits in `handleError` before the reporter. Pinned by `error-reporting.test.ts`. Documented in `.env.example`. | Without this you can't tell whether any fix below regressed in production                                 |

---

## P1 — High priority (security holes, data loss risk, or the hottest perf paths)

| Status | ID       | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Section                                                                                              |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ✅     | **S1**   | Done. Promoted `secretCrypto` (AES-256-GCM `enc:v1:` envelope) + `SecretVerification*` types from local-provider to `@selvajs/platform` (`computeServer/secrets`); local re-exports for compat. `SupabaseComputeServerStore` now encrypts `api_key` on write / decrypts on read (tolerant, mirrors local) + implements `verifySecrets()`; keyed via `SELVA_AT_REST_KEY`, now **required** in `SupabaseDataProvider.fromEnv`. Added optional `verifySecrets?()` to `IComputeServerStore`; boot-health + admin health route switched from `instanceof LocalComputeServerStore` to a structural check so **both** providers get the secret check. CI-runnable unit test proves the DB never sees plaintext (+ round-trip + plaintext/key-mismatch flags). Supabase package added to CI. `.env.example` updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [S1](#s1-supabase-compute-server-api-keys-stored-in-plaintext--high-verified)                        |
| ✅     | **1**    | Done (incl. 1a + 1d). The hook's 4 independent per-request reads (`ensureUser`, `getProfile`, `getFor`, `findUserMembership` — all keyed only by `user.id`) now run in one `Promise.all`; latency ≈ slowest read, not the sum. `buildContext` refactored to a pure function of `(user, token, platformPermissions, membership)` so the dependent `listOrgs` admin-fallback stays sequential inside it. **1a**: `ensureUserOnce` memoizes ensured user ids in a module-level `Set` (same one-way-flag idiom as `firstRunResolved`) → `Set.has` after first request. Verified the brand-new-user race is safe (all reads fail-soft to empty, the correct new-user state). **1d**: corrected the misleading "already cached by the auth flow" comment. Applied to both the gated and public-page attach paths. Exported `buildContext` + added a direct test (incl. a drift guard vs the fixture's `actAs` reimplementation, per T2/Q4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | [§1](#1-the-auth-hook--every-authenticated-request-pays-this)                                        |
| ✅     | **1b**   | Done (hybrid, per user decision). **Research resolved:** the Supabase SDK already ships `auth.getClaims()`, which verifies the JWT LOCALLY against the cached JWKS when the project uses asymmetric signing keys (the default since 2025) and transparently falls back to a network verify for legacy HS256 — so no `jose`/JWKS hand-rolling (the docs warn against verifying the legacy secret manually; it breaks under rotation) and zero new deps. `SupabaseAuthProvider.verifyToken` now: local `getClaims` on every request → reads `sub`/`user_metadata.disabled` from claims; plus a per-session GoTrue recheck at most once per `SUPABASE_REVALIDATE_MS` (default 60s) to catch post-issue sign-out/`disabled` flips, bounding revocation lag. `SUPABASE_TOKEN_VERIFICATION=strict` restores per-request `getUser`. Bounded+swept recheck map. 6 CI-runnable unit tests (local-only verify within window, recheck-rejection denies, disabled-in-claims denies, bad-sig denies, strict mode). `.env.example` documented.                                                                                                                                                                                                                                                                                                                                                                                                  | [§1b](#1b-supabase-verifytoken-is-a-network-round-trip-to-gotrue-per-request)                        |
| ✅     | **1c**   | Done. Removed `touchLastLogin` from `LocalAuthProvider.verifyToken` — it's now read-only (one cached `findById`, zero writes). Was costing a second full `auth-users.json` read+parse per request just to (usually) decide not to write. `lastLoginAt` is still stamped at real login in `verifyLogin`; verified the only consumers use it as a has-ever-signed-in flag (admin/team "invited" vs "active"), so nothing observable changes. Added a regression test (T4/Q5#4) pinning that `verifyToken` never rewrites the file (content + mtime unchanged across 5 calls) and that `verifyLogin` still stamps it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [§1c](#1c-local-verifytoken-writes-a-file-during-session-validation)                                 |
| ✅     | **2a**   | Done (client-cache half). Extracted the solve endpoint's per-server client+scheduler LRU into `lib/server/compute/clientCache.server.ts` (`getClient`); the render path (`loadForRender`) now reuses it instead of `GrasshopperClient.create()` per page load. Cache stays keyed by `(serverUrl, apiKey)` so **per-definition compute-instance pinning is preserved** — a definition pinned to a different server transparently gets that server's own client, and a solved definition renders from the same warm client. Staleness handled by key+LRU (rotated key/URL → new key → fresh client; old ages out). 4 CI unit tests pin the keying (same server reuses; different server / rotated key / changed URL → fresh client). **Not done here:** the separate `getIO`-per-`fileKey` schema cache the audit also lists under 2a — version blobs are immutable so it's a safe add, tracked as a follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | [§2a](#2a-definition-viewer-re-creates-the-compute-client-on-every-page-load--high)                  |
| ✅     | **2b**   | Done. Added optional pre-loaded `project` to `requireCanSolve` and `{ project, definition }` to `requireCanEditDefinition`; the solve endpoint (which already loaded both to read orgId/pin) passes them in, eliminating the gate's re-fetch of project (+ definition on the edit path). Also made `requireEditableDefinition` return the `project` it loads for the gate, and the definition-upload endpoint (`POST /api/definitions/[guid]`) reuses it instead of re-fetching. `contentCheck` confirmed to be a pass-through (no throttle), so hoisting the fetches is semantically identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | [§2b](#2b-solve-endpoint-fetches-the-project-twice-per-solve--high)                                  |
| ✅     | **2c**   | Done. Replaced the per-project access N+1 on `/library` with the `/projects` batched pattern: org-member row once per org into a Map, all `getProjectMember` in one `Promise.all`, platform grants batched for platform-visibility projects only, then no-I/O `canView(projectAccessInputFromRows(...))`. **Also fixed a latent bug**: the old code treated `public` projects as always-visible, ignoring the cross-org gate — `canView` correctly requires an org-member row when `ALLOW_CROSS_ORG_PUBLIC=false`, and gives instance admins platform-project visibility, matching `/projects` and the Permissions model. Follow-up noted: neither `/library` nor `/projects` has a page-load integration test (the underlying `canView` deny-direction is covered in platform's scenarios).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [§2c](#2c-library-per-project-access-n1--high-main-landing-page)                                     |
| ✅     | **3a**   | Done. Added a load-once write-through cache (same idiom as `LocalOrgStoreLoader`) to both hot stores: `auth-users.json` (`createLocalAuthUserStore`) and `user-data.json` (`createLocalUserDataStore`). Reads become a `Set`/array lookup on the cached object; writes mutate the cached object AND persist via temp+rename (sole-writer in single-process local mode → cache is authoritative). **Coherence fix required first:** both files were accessed via multiple store instances on one path (auth: provider + fixtures; user-data: data provider + permission + profile stores), which with caching would run divergent caches. Made both accept an injected shared store — `LocalAuthProvider` exposes `userStore` (fixtures use it), `LocalDataProvider` injects ONE `LocalUserDataStore` into all three views. Cross-view coherence pinned by a new test (permission write visible to profile view; cold provider reads from disk).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [§3a](#3a-no-cache-for-the-two-hottest-files--high-hot-path)                                         |
| ✅     | **3c**   | Done. Replaced the shared-mutable `const EMPTY` with a fresh-object `empty()` factory in `LocalInviteStore` (the **live bug** — `create` pushed into the shared constant, bleeding into later empty reads) and `LocalComputeServerStore` (latent hardening). Regression test verifies a fresh store on a new dir sees `[]` after another store created an invite; confirmed the test FAILS against the old code and passes with the fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | [§3c](#3c-shared-mutable-empty-fallback--correctness-bug-fix-regardless)                             |
| ☐      | **4a**   | Supabase: stop N+1-ing the Auth admin API for instance-admin checks; add GIN index on `platform_permissions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | [§4a](#4a-instance-admin-checks-n1-the-auth-admin-api--high)                                         |
| ☐      | **B6**   | One in-flight solve per compute server: the warm-client scheduler runs `mode: 'queue'` with no `maxConcurrent` → defaults to **1**, serializing ALL solves through a server while its Rhino.Compute VM idles N-1 children. One-line fix (pass a concurrency knob); thread per-request telemetry in the same change. **Do before the CACHING.md work — it changes the load math.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | [B6](#b6-app-side-solve-serialization-one-in-flight-solve-per-compute-server--high-found-2026-07-11) |
| ✅     | **D1**   | **Done (2026-07-11), [ADR 0005](../adr/0005-uischema-version-and-disposable-schema-cache.md):** ownership model = stored schema is a **disposable cache** — re-extract from compute (which runs the C# migrator) on version mismatch, never migrate in TS. `schemaVersion` is REQUIRED on `UISchema` (format 2.11.0 → 2.12.0: `ui-schema.json` required-list, C# `MigrateTo_2_12_0`, generated `UI_SCHEMA_VERSION` constant; changeset `schema-version-required`). **Web-side enforcement landed before the K4 extraction, as required:** the render loader uses the cached schema only when `schema.schemaVersion === UI_SCHEMA_VERSION`, else re-extracts + best-effort `setVersionSchema` persist-back (current-version only, so an outdated compute plugin can't thrash the cache) — now lives in [`@selvajs/server/definitions` load-for-render](../../packages/server/src/definitions/load-for-render.ts) with the app as a thin binding. The related upload gap is closed too: `assertSupportedSchemaVersion` rejects newer-than-app schema formats with a "server supports ≤ X" 422 at upload and a classified error at render. Note: a `schema_version` **GENERATED** column was added ([migration](../../packages/providers/supabase/supabase/migrations/20260711120000_selva_definition_schema_version.sql)) — derived from the blob, zero write-path involvement, ops queries only; drop it if even that is unwanted. | [D1](#d1-stored-uischema-blobs-are-never-migrated-on-the-web-side--rank-1)                           |
| ☐      | **O2**   | Self-update endpoint: add audit events, persist log outside `/tmp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | [O2](#o2-self-update-endpoint-under-observable--high)                                                |
| ☐      | **O3**   | Add app↔DB schema-version handshake (self-update never checks/applies Supabase migrations)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | [O3](#o3-no-appdb-schema-handshake--high)                                                            |
| ✅     | **Dep1** | Done — `pnpm audit --prod` now reports **0 vulnerabilities** (was 6). Bumped `svelte` → 5.56.4, `@sveltejs/kit` → 2.69.1. **The audit's "two catalog edits" was wrong**: the versions were hard-pinned via `pnpm.overrides` + `peerDependencyRules` in root `package.json` (which override the catalog) — updated those too. The audit's "kit ≥2.60.1 pulls the fixed cookie" was also off: kit still declares `cookie: ^0.6.0`, so added a `cookie@<0.7.0` → `^0.7.2` override to clear the last (low) advisory. Validated with a real `pnpm build` of selva + plugin-ui (a major svelte/kit bump). **Also fixed an S1 regression this build surfaced:** promoting `secretCrypto` into the platform ROOT barrel dragged `node:crypto` into the client bundle (client `.svelte` imports the barrel) → build failure. Moved the crypto FUNCTIONS to the server-only `@selvajs/platform/computeServer` subpath (report types stay in the root barrel, erased at build); updated the ~4 provider import sites. S1's tests passed but didn't run a production build — added to the lesson.                                                                                                                                                                                                                                                                                                                                            | [Dependency vulnerabilities](#dependency-vulnerabilities-checked-2026-07-05)                         |

---

## P2 — Medium priority (real but not urgent — do in normal course of work)

| Status | ID        | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Section                                                                                                                                                          |
| ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ☐      | **2d**    | Admin users page: replace per-user `getOrgMember` with one `listOrgMembers` + Map                                                                                                                                                                                                                                                                                                                                                                                       | [§2d](#2d-per-user-getorgmember-on-admin-users-page--api)                                                                                                        |
| ☐      | **2e**    | Add `countMembers`/`countOrgMembers` to store interfaces (4 pages fetch full rosters just to count)                                                                                                                                                                                                                                                                                                                                                                     | [§2e](#2e-counting-by-listing--needs-a-store-interface-addition)                                                                                                 |
| ☐      | **2f**    | Add `listPlatformProjects()`; stop the sequential cross-org walk                                                                                                                                                                                                                                                                                                                                                                                                        | [§2f](#2f-sequential-cross-org-walk-for-platform-projects)                                                                                                       |
| ☐      | **2g**    | Minor: parallelize two independent awaits in `admin/projects/[id]`                                                                                                                                                                                                                                                                                                                                                                                                      | [§2g](#2g-minor-sequential-awaits)                                                                                                                               |
| ☐      | **2h**    | `/team` + `/team/members` re-list the same org roster on navigation                                                                                                                                                                                                                                                                                                                                                                                                     | [§2h](#2h-navigation-redundancy-in-team)                                                                                                                         |
| ✅     | **3b**    | Done. Added the same load-once write-through cache to `LocalDefinitionStore` (all I/O already routed through `readConfig`/`writeConfig`, so it was a clean two-method change). No coherence refactor needed — the store is constructed once and the share-link store gets the SAME instance injected, so the public share-solve path shares the one cache. Covered by the existing 28 definition-conformance round-trip tests + the selva share-link suite (all green). | [§3b](#3b-definitions-config-re-read-per-getlist--medium-warm--public-path)                                                                                      |
| ☐      | **3d**    | `listPublic` in-memory N+1 (low cost, cheap to fix if touching the file anyway)                                                                                                                                                                                                                                                                                                                                                                                         | [§3d](#3d-listpublic-in-memory-n1--low)                                                                                                                          |
| ☐      | **4b**    | Supabase: replace `select('*')` with explicit column lists (worst: `listVersions` drags full schema JSONB)                                                                                                                                                                                                                                                                                                                                                              | [§4b](#4b-select-on-list-paths--medium-high)                                                                                                                     |
| ☐      | **4c**    | Supabase: drop full event `data` JSONB from the audit list projection                                                                                                                                                                                                                                                                                                                                                                                                   | [§4c](#4c-audit-list-pulls-full-event-data-jsonb--medium)                                                                                                        |
| ☐      | **4d**    | Supabase: move profile mutations (star/unstar/recordRun) to a single RPC (removes 2-round-trip race)                                                                                                                                                                                                                                                                                                                                                                    | [§4d](#4d-profile-mutations-are-read-modify-write-with-a-documented-race--medium)                                                                                |
| ☐      | **4e**    | Supabase: fold `touchLastLogin` into one conditional UPDATE                                                                                                                                                                                                                                                                                                                                                                                                             | [§4e](#4e-touchlastlogin-debounce-still-reads-every-login--low-medium)                                                                                           |
| ☐      | **4f**    | Supabase: minor client-reuse, cache-control, Zod→Set cleanups                                                                                                                                                                                                                                                                                                                                                                                                           | [§4f](#4f-low--notes)                                                                                                                                            |
| ☐      | **4g**    | Verify/add speculative missing indexes against actual migrations                                                                                                                                                                                                                                                                                                                                                                                                        | [§4g](#4g-speculative-missing-indexes--verify-against-migrations)                                                                                                |
| ☐      | **S2**    | RLS defense-in-depth on `selva.*` tables + a test forbidding ungated `SYSTEM_CONTEXT` store calls                                                                                                                                                                                                                                                                                                                                                                       | [S2](#s2-app-layer-gates-are-the-only-defense-on-service-role-paths--high-architectural)                                                                         |
| ☐      | **S3**    | Enforce minimum secret length for `SELVA_HMAC_KEY` et al. (same rigor as `SELVA_AT_REST_KEY`)                                                                                                                                                                                                                                                                                                                                                                           | [S3](#s3-secret-strength-not-enforced--medium)                                                                                                                   |
| ☐      | **S4**    | Validate `ORIGIN` at boot; consider explicit Origin allowlist for state-changing API routes                                                                                                                                                                                                                                                                                                                                                                             | [S4](#s4-csrf--origin--medium)                                                                                                                                   |
| ☐      | **S5**    | Make invite acceptance an atomic check-and-consume                                                                                                                                                                                                                                                                                                                                                                                                                      | [S5](#s5-invite-acceptance-is-not-atomic--medium-low)                                                                                                            |
| ☐      | **D2**    | Reconcile definition-status enum across DB/TS/Zod (3-line fix, zero rows affected today)                                                                                                                                                                                                                                                                                                                                                                                | [D2](#d2-definition-status-enum-drift--rank-2-3-line-fix)                                                                                                        |
| ☐      | **D3**    | Add version/envelope to `audit_events.data` before the table fills                                                                                                                                                                                                                                                                                                                                                                                                      | [D3](#d3-audit-event-payload-unversioned--rank-3)                                                                                                                |
| ☐      | **D4**    | Decide single-org-by-design vs. reserve the `/o/{slug}/` URL shape before external links exist                                                                                                                                                                                                                                                                                                                                                                          | [D4](#d4-single-org-membership-baked-into-bootstrap--rank-4)                                                                                                     |
| ☐      | **D5**    | Version the `/api/compute` wire contract + wrap the response in an envelope                                                                                                                                                                                                                                                                                                                                                                                             | [D5](#d5-apicompute-contract-unversioned--rank-5)                                                                                                                |
| ☐      | **D6/D7** | Confirm intended org-delete semantics (partially lossy today); note on storage-visibility-as-path-prefix                                                                                                                                                                                                                                                                                                                                                                | [D6/D7](#d6d7-smaller-decisions)                                                                                                                                 |
| ☐      | **Q1**    | Conformance suites: make the deny-direction tests actually run (currently gated off everywhere in CI)                                                                                                                                                                                                                                                                                                                                                                   | [Q1](#q1-the-deny-direction-of-the-store-conformance-suites-never-runs--top-finding)                                                                             |
| ☐      | **Q4/Q5** | Test-quality strengthening + top missing high-value cases (share-cap enforcement at the endpoint, concurrent solve-count increments, HMAC tamper tests, privilege-escalation PATCH case, etc.)                                                                                                                                                                                                                                                                          | [Q4](#q4-tests-needing-strengthening), [Q5](#q5-top-missing-high-value-cases-merged-ranked-by-blast-radius)                                                      |
| ☐      | **O4**    | Structured logging (pino + request-ID) instead of console soup                                                                                                                                                                                                                                                                                                                                                                                                          | [O4](#o4-logging-is-unstructured-console-soup--medium)                                                                                                           |
| ☐      | **O5**    | Backup/export tooling for local-provider data                                                                                                                                                                                                                                                                                                                                                                                                                           | [O5](#o5-local-provider-data-has-no-backupexport-tooling--medium)                                                                                                |
| ☐      | **V1**    | Call `renderer.forceContextLoss()` on viewer teardown (WebGL context accumulation on repeated navigation)                                                                                                                                                                                                                                                                                                                                                               | [V](#v-client-side-viewer-memory-audit-point-3--executed)                                                                                                        |
| ☐      | **P1**    | Reword the privacy claim in CLAUDE.md / `docs/providers.md`; fix the erasure gaps (invites, audit events)                                                                                                                                                                                                                                                                                                                                                               | [P](#p-privacy-claim-audit-point-4--executed)                                                                                                                    |
| ☐      | **B1–B5** | Scaling roadmap: async solve jobs + queue UX, compute pooling groundwork, ADR 0003 streaming, audit retention/partitioning, per-org metering                                                                                                                                                                                                                                                                                                                            | [Mind game section](#mind-game-selva-at-1000-users--will-it-scale)                                                                                               |
| ☐      | **B7–B9** | Solve-path bottlenecks (found 2026-07-11): unbounded queue wait outside the solve deadline (package change), `gzipSync`+`stringify` event-loop stalls, unbatched per-solve metric inserts                                                                                                                                                                                                                                                                               | [B7](#b7-queue-wait-is-unbounded-and-doesnt-count-toward-the-solve-deadline--medium-high)–[B9](#b9-solve_metrics-one-unbatched-insert-per-solve-attempt--medium) |
| ☐      | **LB**    | Compute load-balancing groundwork: write the ADR, send definition-guid as a routing header, keep server identity as an id not a URL                                                                                                                                                                                                                                                                                                                                     | [LB](#rhino-compute-load-balancing--lay-the-ground-now-build-later)                                                                                              |

---

## P3 — Low priority / cheap cleanups / deferred

| Status | ID          | Item                                                                                        | Section                                                             |
| ------ | ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| ☐      | **S6**      | Optional magic-byte check on `.gh`/`.ghx` upload (compute already rejects bad files)        | [S6](#s6-definition-upload-validated-by-extension-only--low)        |
| ☐      | **O6**      | `/api/health` is boot-snapshot only — add a short-TTL live check or `/api/ready`            | [O6](#o6-apihealth-is-boot-snapshot-only--low)                      |
| ☐      | **Q3**      | Delete/slim ~12 low-value or duplicated tests (list in section Q3)                          | [Q3](#q3-deletable--slimmable-tests-small-list--little-dead-weight) |
| ☐      | **V2**      | Optional: Blob+`createObjectURL` instead of doubled base64 data-URL for large image outputs | [V](#v-client-side-viewer-memory-audit-point-3--executed)           |
| ☐      | **V3**      | Note only: server-side `TextureAssetStore` never evicts (Rhino-session scope, not browser)  | [V](#v-client-side-viewer-memory-audit-point-3--executed)           |
| 🧊     | —           | Plugin C# runtime quality (lower blast radius, best-tested part of the repo already)        | [Deliberately deferred](#deliberately-deferred-fine-for-now)        |
| 🧊     | —           | Accessibility / i18n                                                                        | [Deliberately deferred](#deliberately-deferred-fine-for-now)        |
| 🧊     | —           | Docs accuracy drift (e.g. `docs/Caching.md`)                                                | [Deliberately deferred](#deliberately-deferred-fine-for-now)        |
| 🧊     | —           | License-compliance scan, website package                                                    | [Deliberately deferred](#deliberately-deferred-fine-for-now)        |
| 🧊     | **Compute** | Audit `@selvajs/compute` itself (separate repo — solve client, scheduler, binary parser)    | [Not yet audited](#not-yet-audited--remaining-known-gaps)           |

---

## Open research questions (resolve before implementing the related item)

1. **JWT local verification (→ 1b):** which signing scheme (HS256 secret vs JWKS)? Is `user_metadata.disabled` present in token claims? What revocation latency is acceptable — hybrid (local verify + periodic `getUser`)?
2. **`ensureUser` memoization (→ 1a):** multi-instance deployments — the `Set` is per-process (fine, idempotent) — confirm no cross-instance invariant depends on the call.
3. **Count methods (→ 2e):** exact interface shape — per-entity `count*` vs a `Page.totalCount` option on existing `list*`?
4. **`disabled` denormalization (→ 4a):** which trigger currently mirrors auth users into `user_profiles`, and can it carry `disabled`? Migration + backfill plan.
5. **`getIO` cache per fileKey (→ 2a):** confirm version blobs are truly immutable per `fileKey` (incl. draft overwrites).
6. **Test teardown race (→ T1):** confirm the sharp-transcode-promise hypothesis before landing the fix — don't just suppress it.
7. **UISchema cache-vs-migrate (→ D1):** ~~confirm re-extraction from compute is cheap enough to serve as the migration path~~ **Resolved 2026-07-11** — decided for re-extraction (one compute round-trip per stale definition, once, then re-cached via `setVersionSchema`; the solve route's schema-backfill bridge already proves the cost is acceptable in practice). See the D1 progress note.
8. **RLS coverage (→ S2):** which `selva.*` tables currently have policies at all, and do they mirror `access.server.ts` semantics?

---

---

# Full write-ups

Everything below is the original research, unchanged, kept as the reference material the tables above link into.

## 1. The auth hook — every authenticated request pays this

`packages/selva/src/hooks.server.ts` runs 5 sequential data-layer round-trips before any route handler:

1. `providers.auth.verifyToken(token)` (line ~249)
2. `providers.data.ensureUser(SYSTEM_CONTEXT, user.id)` (line ~310)
3. `providers.data.userProfile.getProfile(...)` (line ~314)
4. `buildContext` → `permissions.getFor(...)` (line ~91)
5. `buildContext` → `orgs.findUserMembership(...)` (line ~97)

Steps 2–5 are all keyed only by `user.id` with **no data dependency between them** — a single `Promise.all` cuts hook latency to roughly the slowest call instead of the sum. The `listOrgs({limit:1})` fallback (line ~106) genuinely depends on 4+5 and must stay sequential, but only fires for instance admins without a membership row.

### 1a. `ensureUser` runs on every request as an idempotent guard

- Local provider: full read+parse of `user-data.json` per request just to discover the row exists.
- Fix: module-level `Set<string>` of already-ensured user ids (same pattern as the existing `firstRunResolved` one-way flag in the same file). Correct because `ensureUser` is defined idempotent and rows don't disappear mid-process.

### 1b. Supabase: `verifyToken` is a network round-trip to GoTrue per request

- `packages/providers/supabase/src/auth/SupabaseAuthProvider.ts:116-125` calls `this.anon.auth.getUser(token)` — a POST to `/auth/v1/user` on every non-public request, serially before any data query.
- Supabase access tokens are signed JWTs → **verify locally** (JWT secret HS256, or JWKS for asymmetric keys) and extract `sub`/`exp`/`user_metadata.disabled` from claims. Zero round-trips.
- Research needed: revocation semantics (local verify won't see server-side sign-outs until token expiry — decide acceptable TTL), which signing scheme our projects use, whether `disabled` is in claims or needs the profile row.
- Fallback option: short-TTL in-memory LRU keyed by token, TTL bounded by `exp`.

### 1c. Local: `verifyToken` WRITES a file during session validation

- `packages/providers/local/src/auth/LocalAuthProvider.ts:107-115` — after the pure-crypto HMAC check (fine), it calls `findById` (full read of `auth-users.json`) **and** `touchLastLogin`, which read-modify-rewrites the whole users file. Debounced to 60s, but still a full read+parse+serialize cycle to decide not to write; across users it genuinely rewrites on the request path.
- Fix: remove `touchLastLogin` from `verifyToken` entirely — `lastLoginAt` is a login-time concern, belongs in `verifyLogin` only. If per-request freshness is wanted, in-memory `Map<userId, stamp>` flushed lazily.

### 1d. Misleading comment

- `hooks.server.ts:302-303` claims local reads of `users.json` are "already cached by the auth flow" — **no such cache exists**. Correct the comment (or make it true, see §3a).

---

## 2. Route handlers — N+1s and redundant fetches

### Hot paths

#### 2a. Definition viewer re-creates the compute client on every page load — HIGH

- `packages/selva/src/lib/server/definitions/loadForRender.server.ts:109-122` calls `GrasshopperClient.create({serverUrl, apiKey})` fresh per view (called from `routes/library/[guid]/+page.server.ts:58`).
- The solve endpoint `routes/api/compute/+server.ts:88-213` already maintains a per-server `clientCache`/`SolveScheduler` LRU — the render path bypasses it, doing a full client handshake + `getIO` against Rhino.Compute per navigation.
- Fix: extract the client cache into a shared module (e.g. `compute/clientCache.server.ts`); additionally cache the `getIO`/schema result per `fileKey` (version blobs are immutable).

#### 2b. Solve endpoint fetches the project twice per solve — HIGH

- `routes/api/compute/+server.ts:413` does `getProject` for orgId/pin, then `requireCanSolve` / `requireCanEditDefinition` (lines ~419-421) internally call `loadProjectOr404` → `getProject` **again** (`access.server.ts:408,446`). `requireCanEditDefinition` also re-fetches the definition already loaded at line ~406.
- Fix: let the gates accept a pre-loaded `project`/`definition`, or call the gate first and reuse its returned project.
- Same class: `POST /api/definitions/[guid]/+server.ts:50` re-fetches the project after `requireEditableDefinition` already loaded it.

#### 2c. `/library` per-project access N+1 — HIGH (main landing page)

- `routes/library/+page.server.ts:42-64` — per project: `getOrgMember` (org-visibility), `getProjectMember` (private), or `grantStore.listByProject` (platform). O(projects) store calls per visit.
- **The fix already exists in the codebase**: `routes/projects/+page.server.ts:87-96` fetches each org's member row once into `orgMemberByOrgId`, batches `getProjectMember` in one `Promise.all`, and evaluates via the no-I/O `projectAccessInputFromRows` helper (`access.server.ts:208-229`). Port that pattern.

### Admin/team pages

#### 2d. Per-user `getOrgMember` on admin users page + API

- `routes/admin/users/+page.server.ts:57-65` and `routes/admin/api/users/+server.ts:49-55` — profiles (`getProfiles`) and permissions (`getForBatch`) are batched correctly, then a per-user `orgs.getOrgMember(...)` for the acting-org role. Up to 200 calls per page.
- Fix: one `listOrgMembers(ctx, activeOrgId, {limit})` → `Map<userId, OrgMember>`.

#### 2e. Counting by listing — needs a store-interface addition

Pages fetch full member/project rows just to read `.items.length` (the `list*` calls do return a `total`, which the pages already use with `.items.length` as fallback — so the fix is avoiding the **full-row fetch** via a `COUNT(*)` path, not the absence of any count):

- `routes/team/+page.server.ts:21-31` (1000 members + 200 projects for two integers; also the two calls are sequential — `Promise.all` them regardless)
- `routes/admin/organizations/+page.server.ts:22-33` (1000 members per org)
- `routes/team/projects/+page.server.ts:26-37` (caps at `limit: 200`, not 1000)
- `routes/team/reclaim/+page.server.ts:39-52` (caps at `limit: 200`, not 1000)

Fix (store level): add `countMembers(ctx, projectId)` / `countOrgMembers(ctx, orgId)` to `IProjectStore`/`IOrgStore` — SQL `COUNT(*)` on Supabase, trivial on local. Confirmed neither interface has these today. Fixes all four pages.

#### 2f. Sequential cross-org walk for platform projects

- `routes/admin/api/projects/+server.ts:54-63` and `routes/admin/projects/+page.server.ts:37-48` — serial `for`+`await listProjects` per org, then JS-filter to `visibility === 'platform'`. (The code comment even anticipates this: "if instance scale ever demands it, add a dedicated `listPlatform()`".)
- Quick win: `Promise.all` the per-org calls. Real fix: `listPlatformProjects()` on `IProjectStore` (single `WHERE visibility='platform'` query).

#### 2g. Minor sequential awaits

- `routes/admin/projects/[id]/+page.server.ts:79-80` — `listByProject` then `listOrgs`, independent → `Promise.all`.

#### 2h. Navigation redundancy in /team

- `/team` and `/team/members` both call `listOrgMembers` for the same org on navigation. Option: hoist into `team/+layout.server.ts` and share via `parent()` — or moot once 2e lands (count for `/team`, roster only for `/team/members`).

### Verified clean (no action)

- `api/compute/+server.ts` remote-definition cache + client cache: well-designed TTL+LRU.
- `admin/audit/+page.server.ts` `enrichRows` (173-235): model batching implementation.
- `admin/api/compute/status`, org/project member mutation endpoints: correctly parallelized / branch-gated.
- Root/projects/admin layouts read only from `locals` — hook fetches once, layouts project it. Correct division of labor.
- Provider/config wiring: `resolveProviders()` memoizes everything once per process; `getBranding()`/`flag()`/`getTenancy()` are field reads. No per-request env parsing.

---

## 3. Local provider (`packages/providers/local`)

Every JSON store follows: `readJsonFile` = full `fs.readFile` + `JSON.parse` per read; `writeJsonFile` = full serialize + temp-file + `rename` per write (`src/data/fsJson.ts:8-28`). Writes are atomic (good). No fsync anywhere (acceptable for dev). Only **one** store caches: `LocalOrgStoreLoader` (`src/data/LocalOrgStore.ts:55-83`).

### 3a. No cache for the two hottest files — HIGH (hot path)

- `auth-users.json` and `user-data.json` are fully read+parsed **~4× per authenticated request** (`src/auth/users.ts:96-99`, `src/data/userData.ts:67-82`, consumed by hook steps in §1).
- Provider is the sole writer in single-process local mode → in-memory copy can be authoritative (write-through), or mtime-validated like `LocalOrgStoreLoader`.
- Makes `ensureUser` a zero-I/O `Set.has` check.

### 3b. Definitions config re-read per `get`/`list` — MEDIUM (warm + public path)

- `src/data/LocalDefinitionStore.ts:59-162` — `get`/`list`/`listByProject`/`getVersion`/`listVersions` each re-read+parse the entire `definitions-config.json` (all definitions + all versions, largest and fastest-growing doc).
- Also hit on the **unauthenticated share-link solve path**: `LocalShareLinkStore.getByTokenHash` (`src/data/LocalShareLinkStore.ts:113-116`) does a definition lookup per call.
- Fix: same mtime-validated loader pattern.

### 3c. Shared mutable `EMPTY` fallback — CORRECTNESS BUG (fix regardless)

- **Live bug — `LocalInviteStore.ts:17`:** module-level `const EMPTY = { invites: [] }`; `readJsonFile` returns it **by reference** on a missing file, and `create` does `file.invites.push(invite)` **directly into the loaded object** → the singleton is permanently polluted, so subsequent "empty" reads see the leaked invite. This one actually fires. Treat as correctness, not perf — fix immediately (verified 2026-07-05).
- **Latent only — `LocalComputeServerStore.ts:33`:** same risky `const EMPTY` pattern, but `readAll()` rebuilds a fresh object every call and no mutator ever pushes into the loaded object, so the reference never leaks. Harmless today; fix anyway to kill the footgun, but it is **not** an active bug (the doc previously overstated this by lumping it with the Invite store).
- Sibling stores (`users.ts:73-76`, `userData.ts:31`, `LocalDefinitionStore.ts:30-33`) deliberately use fresh-object `empty()` factories and comment on exactly this hazard.
- Fix: `const empty = () => ({...})` in both. Two lines.

### 3d. `listPublic` in-memory N+1 — LOW

- `LocalDefinitionStore.ts:138-141` — per-project `getProject`, but hits the org-store cache, so O(P×N) `Array.find`, no I/O. Build a `Map` once if touched anyway.

### Accepted as-is (dev-scale by design)

- Whole-file rewrites per mutation (incl. solve-count bumps) — documented tradeoff (`LocalShareLinkStore.ts:28-34`).
- O(n) find-by-email/id/tokenHash scans — one file per collection, in-memory after a single read.
- Image transcoding: WebP via sharp on **upload only**, plain `readFile` on serve, sharp lazy-loaded+cached. Clean.

---

## 4. Supabase provider (`packages/providers/supabase`)

Overall above average: centralized pagination, batch methods (`getProfiles`, `getForBatch`) exist and are used, `findUserMembership` already de-N+1'd with a join, per-request user clients WeakMap-cached, `getPublicUrl` is pure string construction (no per-item signing), transforms at upload only.

### 4a. Instance-admin checks N+1 the Auth admin API — HIGH

- `src/permissions/SupabasePlatformPermissionStore.ts:91-126` — `hasInstanceAdmin` and `countOtherEnabledAdmins` select admin candidate ids, then loop `serviceClient.auth.admin.getUserById(id)` per candidate just to read `user_metadata.disabled`. 1+K sequential round-trips; on bootstrap/proxy-auth paths and blocking admin writes.
- Fix: denormalize `disabled` into `user_profiles` (synced by the existing user-mirror trigger or by `disableUser`) → single indexed query. Stopgap: `Promise.all` the lookups.
- Related: `.contains()` (`@>`) filters on `platform_permissions` (lines 95, 115) need a **GIN index** or they become full scans.

### 4b. `select('*')` on list paths — MEDIUM-HIGH

- Worst: `listVersions` (`src/data/SupabaseDefinitionStore.ts:203-219`) drags the full `schema` JSONB (`UISchema`) per version row. Fetch `schema` only in `getVersion`.
- Also: definitions grid (`SupabaseDefinitionStore.ts:75,84`), `SupabaseProjectStore.ts:45,224`, `SupabaseOrgStore.ts:47,231,269`, `SupabaseInviteStore.ts:62`, `SupabaseShareLinkStore.ts:58,85`, `SupabaseComputeServerStore.ts:33-35` (pulls `api_key` on every config read).
- Mechanical fix: explicit column lists — the `*Row` interfaces already enumerate exactly what's mapped.

### 4c. Audit list pulls full event `data` JSONB — MEDIUM

- `src/data/SupabaseAuditQuery.ts:34-39` — `data` (full `DomainEvent`) for every one of up to 200 rows per admin audit page. If the list UI only renders type/actor/time, drop it from the list projection and fetch lazily on expand. (Keyset pagination there is otherwise exemplary.)

### 4d. Profile mutations are read-modify-write with a documented race — MEDIUM

- `src/userProfile/SupabaseUserProfileProvider.ts:73-136` — `starDefinition`/`unstarDefinition`/`recordRun` each do `getProfile` then `update` (2 round-trips + lost-update race the code comments on; `recordRun` fires per solve).
- Fix (per the code's own comment): `SECURITY DEFINER` RPC with `array_append`/`array_remove`/dedup+cap in one statement.

### 4e. `touchLastLogin` debounce still reads every login — LOW-MEDIUM

- `src/auth/SupabaseAuthProvider.ts:198-215` — reads `last_login_at`, conditionally writes. Fold into one conditional `UPDATE ... WHERE last_login_at IS NULL OR last_login_at < now() - interval '60 seconds'`.

### 4f. Low / notes

- Auth and storage providers each `createClient` independently instead of reusing the data-layer `ClientBundle` (`src/data/client.ts:55-92`, `src/storage/SupabaseStorageProvider.ts:66`). Clients are lazy so impact is low; matters for keepalive-pool reuse under load.
- `put` sets no `cacheControl` on upload — far-future caching for cover images/thumbnails is an easy win (Supabase default is 3600s).
- `filterValid` (`SupabasePlatformPermissionStore.ts:129-131`) runs Zod `safeParse` per permission string per row inside `getForBatch` — replace with a module-level `Set` membership check.

### 4g. Speculative missing indexes — verify against migrations

- GIN on `user_profiles.platform_permissions` (see 4a)
- Partial `definitions (project_id, created_at desc) WHERE deleted_at IS NULL`
- `projects (org_id, deleted_at)` + unique `(org_id, slug)`
- `org_members (user_id, deleted_at)`
- Unique on `share_links.token_hash` and `invites.token_hash`
- Composite `audit_events (occurred_at desc, id desc)` + secondary on `type`, `actor_id`

---

## Mind game: Selva at 1000 users — will it scale?

Assumption: 1000 registered users on a `packages/selva` deployment ⇒ Supabase provider (the local provider is explicitly single-process/dev — out of scope at this scale), adapter-node behind a reverse proxy, one or more Rhino.Compute servers. Realistic concurrency: ~50–150 active sessions, with slider-scrubbing solve storms as the peak load shape.

**Verdict:** the web tier and Postgres handle 1000 users comfortably once the audit items above land. The system does **not** fall over architecturally — sessions are stateless JWTs so the app scales horizontally, rate limiting and solve caching already exist, and the DB volume is small for Postgres. What actually constrains you is **Rhino.Compute capacity** (and the licensing cost behind it), plus a handful of single-process assumptions that leak when you run more than one app instance.

### What breaks first, in order

#### B1. Rhino.Compute saturation — the real ceiling

Solves are seconds-to-minutes of CPU on a Windows VM; a single compute server sustains only a handful of concurrent solves. Existing mitigations are good: client one-in-flight throttle + slider debounce, per-key rate limit (120/100s, `computeRateLimit.server.ts`), server-side `cachesolve` result cache, definition-pointer reuse. What's missing at scale:

- **No queue/backpressure UX.** When compute saturates, requests pile up until `MAX_SOLVE_DURATION_MS` (100s) — users see hangs then timeouts, not "you're #4 in queue". Need queue-depth signaling (SSE or polling) and fast-fail when depth exceeds a bound.
- **No compute pool.** Server selection is per-org config (`resolveServerForOrg`) — one busy org saturates its one server. Need N servers per org / instance-wide pool with least-loaded routing, which is also the horizontal-scaling story for compute.
- **Scheduler is per-app-instance.** With multiple app instances, each `SolveScheduler` throttles independently against the same compute server ⇒ oversubscription. Either pin compute traffic to one instance, or move admission control into/infront of the compute server. (And within ONE instance the problem is inverted — see B6: the scheduler currently serializes to a single in-flight solve per server.)
- **No per-org metering/quotas.** Compute time is the money at 1000 users. Only share-links have `maxSolves`. Need per-org solve-seconds metering (the solve metric sink is the natural hook) and quota enforcement.

#### B2. Auth: GoTrue round-trip per request (§1b becomes mandatory)

At 1000 users every page/API hit does a network call to Supabase Auth — latency floor on everything, and Supabase per-project auth rate limits become a real outage risk under load. Local JWT verification stops being an optimization and becomes a requirement. Design the revocation story at the same time (disabled-user latency ≤ token TTL, or hybrid periodic re-check).

#### B3. Memory: base64 solve payloads through the Node heap

File-typed inputs/outputs are base64-embedded in the solve request/response JSON — up to ~200–300 MB per solve, fully buffered (and the V8 ~512 MB string wall is already documented in `computeLimits.ts`). Ten concurrent large solves ⇒ multi-GB heap ⇒ OOM-kill. `COMPUTE_RESPONSE_MAX_BYTES` turns crashes into 413s but doesn't create capacity. **ADR 0003 (stream large file outputs out-of-band via storage) becomes mandatory.** Also: the TEMP dev caps in `computeLimits.ts` (50→300 MB upload, 210→300 MB body) must be reverted before any production release — they're marked in-code.

#### B4. Database hot spots

- **Missing indexes** (§4g) — especially unique on `share_links.token_hash`: it's resolved on every unauthenticated share solve, the most abusable public path.
- **Audit events unbounded growth** — solve/audit events at 1000 active users ⇒ millions of rows/year. Need retention/partitioning (e.g. monthly partitions, 12-month retention) before the admin audit page and inserts degrade.
- **`definition_versions.schema` JSONB bloat** (§4b) — version lists degrade linearly with version count until the projection fix lands.
- **`recordRun` per solve** (§4d) — 2 round-trips + race at solve volume; the RPC fix moves from nice-to-have to needed.
- The N+1s (§2c/2d) go from "sluggish" to "page timeouts" as row counts grow — same fixes, higher urgency.

#### B5. Multi-instance drift (in-process state)

Documented-acceptable today, worth a decision at scale: per-instance rate-limit buckets (N× effective rate), per-instance remote-definition/`getIO` caches (N× compute warm-up), `ensureUser`/first-run flags (harmless — idempotent). Either accept N× semantics explicitly, or introduce Redis for the rate limiter only (the caches are fine per-instance). Note both rate-limiter `Map`s (`computeRateLimit.server.ts`, `admin-auth.server.ts`) never evict dead keys — a slow leak; add periodic sweep.

#### B6. App-side solve serialization: one in-flight solve per compute server — HIGH (found 2026-07-11)

- `packages/server/src/compute/client-cache.ts:191` creates the warm client's scheduler with `mode: 'queue'` and **no `maxConcurrent`** — and `SolveScheduler`'s constructor defaults queue mode to `maxConcurrent = 1` (`../selva-compute/src/features/grasshopper/scheduler/solve-scheduler.ts:220`). Net effect: each app instance sends **exactly one in-flight solve per compute server**, FIFO-queuing everything else.
- But Rhino.Compute spawns N `compute.geometry` children per VM precisely to run solves concurrently — the app throttles itself _below_ the capacity of the hardware B1 worries about saturating. One user's 100s solve blocks every other user on that server. This bites long before compute saturation does; B1's scheduler bullet describes cross-instance *over*subscription while the live problem is within-instance *under*subscription.
- **Fix:** pass `maxConcurrent` (≈ the compute VM's `compute.geometry` child count) through `ClientCacheConfig` → `createScheduler`, env-tunable (e.g. `COMPUTE_MAX_CONCURRENT`). No package change needed — the scheduler option already exists; the app just never sets it.
- **Same-change requirement:** the cached client's `rhinoTiming.last` / `solveMeta.last` are single-slot mutable telemetry with a documented "concurrent burst may misattribute" caveat (`client-cache.ts:63-76`). At `maxConcurrent = 1` that caveat is edge-case; the moment concurrency rises it becomes routine — thread per-request telemetry through the `onSettle`/`onServerTiming` context instead of the shared slot when raising the limit.
- **Sequencing:** land before the `selva-compute/CACHING.md` work — cache hit-rate and queue-depth math both change once real concurrency exists.

#### B7. Queue wait is unbounded and doesn't count toward the solve deadline — MEDIUM-HIGH

- The scheduler's `timeoutMs` is only injected at execution start (`solve-scheduler.ts:425` — inside `execute()`), and the `fifoQueue` has no depth bound. Under load, requests queue indefinitely (until the client disconnects), then _each still gets its full 100s_ once it finally runs. The route's 504 "exceeded the 100s deadline" message misattributes queue wait as solve time; there is no fast-fail.
- Compounds B6 badly today: 30 queued solves × up to 100s each behind a single in-flight slot. Still real after B6 — saturation just needs more load.
- **Fix (package — `../selva-compute`):** either count `enqueuedAt` toward the deadline, or add `maxQueueDepth` / `maxQueueWaitMs` scheduler options that reject with a typed error the route can map to 503 + `Retry-After`. This is the mechanical hook B1's "queue/backpressure UX" item currently lacks — queue-position signaling needs the queue to expose and enforce bounds first.

#### B8. `gzipSync` + `JSON.stringify` block the event loop per solve — MEDIUM-HIGH

- `routes/api/compute/+server.ts:447/:478` — the solve response is stringified and gzipped **synchronously** on the main thread, and `COMPUTE_RESPONSE_MAX_BYTES` currently defaults to 300 MB (`packages/server/src/compute/limits.ts:134`, the TEMP dev cap). Gzipping even 20–50 MB synchronously freezes the _entire Node instance_ for hundreds of ms — every concurrent request, every in-flight solve callback, every auth hook. One user's heavy geometry stalls everyone.
- B3 covers the _heap_ cost of big payloads; this is the separate _event-loop_ cost of the same payloads.
- **Fix:** async `zlib.gzip` (or a stream) is a near-drop-in — the timing instrumentation already brackets the gzip phase. The structural fix is the same as B3 (ADR 0003: large outputs out-of-band via storage). And revert the TEMP 300 MB caps before release (already flagged in-code).

#### B9. `solve_metrics`: one unbatched INSERT per solve attempt — MEDIUM

- `packages/providers/supabase/src/data/SupabaseSolveMetricSink.ts:18` — fire-and-forget but one row per attempt, one round-trip each. Slider scrubbing is the stated peak shape: ~100 active users scrubbing ⇒ hundreds of telemetry inserts/sec against the same Postgres serving the auth path. B4 tracks the table's _growth/retention_; the _write rate_ itself wasn't flagged.
- **Fix:** buffer + periodic batch flush behind the sink interface (the `ISolveMetricSink` seam already isolates this), or sample non-error metrics under load. Keep failures unsampled — they feed alerting.

### Missing production-grade features (beyond efficiency)

1. **Async solve jobs** — 100s solves held over a single HTTP request die at proxy/platform timeouts and on every deploy. Job-queue + result-polling (or SSE) for long solves; also gives you the queue-position UX from B1.
2. **Observability** — there's a metrics module, solve metric sink, boot health, and admin compute-status probes, but no aggregated story: request latency percentiles, solve queue depth, compute server utilization, error-rate alerting. At 1000 users you can't debug from logs alone.
3. **Graceful shutdown / zero-downtime deploys** — adapter-node with in-flight 100s solves: drain on SIGTERM, connection draining at the LB, or accept solve loss per deploy.
4. **Load testing** — nothing in the repo exercises concurrent solve load; the B1/B3 numbers above are estimates until measured (k6/artillery scenario: N users scrubbing sliders against a throwaway compute server).
5. **Backup/DR posture** — Supabase covers Postgres PITR; storage buckets (definition blobs are the source of truth for solves) need an explicit backup/versioning decision.
6. **Abuse surface on public share links** — rate limit per `share:{linkId}` exists and `maxSolves` caps totals; still missing: per-IP limits on the share path (one link, distributed abuse) and CAPTCHAs/turnstile if links are shared publicly at scale.

### Rhino.Compute load balancing — lay the ground now, build later

Context: today resolution returns exactly ONE `ComputeServerConfig` (definition pin → `orgDefaults[orgId]` → global default; `platform/src/computeServer/utils.ts`), and a "server" is one URL + one API key. Rhino.Compute already balances _within_ a VM (the rhino.compute frontend spawns N `compute.geometry` children) — the missing layer is **cross-VM**.

**Why a naive HTTP LB (nginx round-robin) would actively hurt this system:**

- The **definition pointer cache** (`COMPUTE_REUSE_DEFINITION_CACHE`) is per-VM. Round-robin means every other solve hits a VM without the cached definition — on the VektorNode fork that's transparent re-upload thrash; on a standard rhino.compute it's the **silent-empty-geometry** failure mode (documented in `computeLimits.ts:138-144`). An LB without affinity turns a known edge case into routine behavior.
- The **`cachesolve` result cache** is per-VM — hit rate divided by N under random routing.
- Solves are long (up to 100s) and wildly variable — round-robin stacks two heavy solves on one VM while another idles; you need least-loaded or affinity, both of which require knowing something about the request.

**The routing law that follows: solves must route by definition affinity** (hash the definition guid → pool member), because both caches key on the definition. Whoever does the routing — infra LB or the app — needs the definition identity at routing time.

**What's already future-proof:** pins, org defaults, and shares all reference a server **id**, never a URL. What an id _resolves to_ can later become a pool of URLs without touching any stored reference. The data model is not the one-way door here.

**Ground to lay NOW (cheap, forward-compatible):**

1. **Write the ADR**: (a) routing law = definition-guid affinity; (b) server identity = the id, URLs are resolution detail — new code (metrics, caches, logs) must key on id, never URL; (c) pool membership will be an additive change to `ComputeServerConfig` (`urls: string[]` or member rows), no schema break.
2. **Expose the definition guid to the routing layer**: send it as a header (e.g. `X-Selva-Definition`) on every solve/getIO request to compute. One line today; lets ANY future LB (nginx `hash ... consistent`, cloud LB, or app-level) do affinity without parsing the POST body.
3. **Do efficiency fix 2a first** (shared compute client cache module): that module is exactly where pool member selection will plug in later — building it now means the LB lands in one file.
4. Keep the per-server health probing (`admin/api/compute/status` already probes passively) — it becomes the pool-member liveness source.

**Defer until real demand:** the LB itself, autoscaling, cross-instance admission control, a queue service. At one user none of it pays; with the ADR + header + client module in place, adding app-level pool routing later is a contained change (extend `resolveServerForOrg` to return members + pick-by-hash with liveness fallback), and an infra LB remains possible as an alternative because the affinity key is already on the wire.

**Recommendation between the two end-states, when the time comes:** app-level pooling over an infra LB — the app already holds per-server schedulers (queue-depth awareness), the API-key-per-server model doesn't fit a shared LB URL cleanly, and per-org quotas/metering (B1) want to live at the same decision point.

### What does NOT need work (verified)

- Horizontal app scaling fundamentals: stateless JWT cookies, no server session store, no sticky-session requirement.
- Compute-side result caching (`cachesolve`) and pointer reuse are already instance-spanning (they live on the compute server).
- Solve request/response caps, remote-fetch caps, upload caps: all centralized and env-tunable (`computeLimits.ts`).
- File proxy (`api/files`) serves only small rasterized images/PDFs with cache headers — not a scaling concern (solve geometry does not flow through it).

---

# Blind-spots sweep (pre-scale)

Four additional audits run while there is one real user: security posture, data-model irreversibility, test coverage, operational readiness. Cross-verified — two subagent claims were corrected against source (noted inline).

## S. Security posture

### S1. Supabase compute-server API keys stored in PLAINTEXT — HIGH (verified)

- `packages/providers/supabase/src/data/SupabaseComputeServerStore.ts:193-229` — `api_key` read/written verbatim to the `compute_servers.api_key` column.
- The local provider treats the same secret as security-critical: AES-256-GCM envelope via `secretCrypto.ts` keyed by `SELVA_AT_REST_KEY`, and hard-fails on plaintext-on-disk (`LocalComputeServerStore.ts:116-121`). The Supabase path has no equivalent — a DB backup leak or service-role compromise yields Rhino.Compute credentials directly.
- Fix: apply the same `secretCrypto` envelope in `SupabaseComputeServerStore` (encrypt before insert, decrypt on read) + a boot-health check surfacing plaintext rows.

### S2. App-layer gates are the ONLY defense on service-role paths — HIGH (architectural)

- `packages/providers/supabase/src/data/client.ts:55-92` — `forRequest(ctx)` returns the RLS-bypassing `serviceClient` whenever `ctx.system === true`. Service-role usages: share-link resolution + solve-count increment, event/metric sinks, audit query, platform permissions, user profiles, and **all request-bootstrap reads in hooks.server.ts**.
- No concrete hole found — admin routes gate before every `SYSTEM_CONTEXT` call, and the bootstrap reads are identity-scoped. But one missing `require*` gate on a service-client path = full cross-tenant breach with no RLS backstop.
- Fix: (a) RLS policies on `selva.*` tables as defense-in-depth; (b) a test/lint asserting no route handler passes `SYSTEM_CONTEXT` to a store without a preceding gate; (c) regression-pin the fail-closed anon default in `client.ts` (it previously failed open — documented in-file).

### S3. Secret strength not enforced — MEDIUM

- `SELVA_HMAC_KEY` (sessions) and its fallback consumers `SHARE_LINK_SECRET`/`INVITE_TOKEN_SECRET` have presence-only checks (`LocalAuthProvider.ts:97-99`, `shareLinks/token.server.ts:40-49`, `invites/token.server.ts:26-35`). A 4-char dev secret reaches production silently. `SELVA_AT_REST_KEY` already enforces 32 bytes (`secretCrypto.ts:61-69`) — apply the same strictness.

### S4. CSRF / Origin — MEDIUM

- No `csrf` override in `svelte.config.js` → SvelteKit's built-in Origin check applies, but it only covers form content types, and correctness hinges on `ORIGIN` being set right in production. JSON POSTs on cookie-authed API routes have no explicit server-side Origin assertion, and CSP/frame-ancestors are deliberately deferred for iframe embedding (`hooks.server.ts:391-396`), which removes a layer.
- Fix: validate `ORIGIN` at boot; consider an explicit Origin allowlist check for state-changing API methods.

### S5. Invite acceptance is not atomic — MEDIUM-LOW

- `routes/accept-invite/+page.server.ts:65-122` — expiry/consumed filtering delegated to `getByTokenHash`; TOCTOU window between fetch and `markAccepted`. Mitigated by the invite email being fixed on the row. Fix: atomic check-and-consume like `tryIncrementSolveCount`.

### S6. Definition upload validated by extension only — LOW

- `api/definitions/+server.ts:31-45` — `.gh`/`.ghx` extension + size only; content validation is effectively delegated to compute (schema extraction fails the upload for non-GH bytes — validate-before-write). Optional hardening: magic-byte check before the compute round-trip.

### Verified solid (security)

- Token entropy + hashing at rest: `crypto.randomBytes(32)`, HMAC-SHA256 stored, constant-time compare — share links and invites both.
- PBKDF2 + per-user salt + `timingSafeEqual` for local passwords.
- Deny-by-default route gating with tested allowlists; no ungated `SYSTEM_CONTEXT` route found.
- Secrets never returned to clients (`hasApiKey` boolean pattern, tokenHash stripped, raw token shown once at mint).
- Share-link solve surface tightly validated (definition+channel match, expiry, allowSolve, atomic cap-before-solve, per-link rate limit).
- Blob proxy re-derives canonical storage paths (no traversal); SSRF hardening on remote definitions (private-IP rejection, redirect error, size/time caps).
- **Corrected claim:** a subagent reported cover images stored verbatim — wrong. Both storage providers run `transcodeImageIfNeeded` (sharp → WebP) inside `put()` (`LocalStorageProvider.ts:52-59`, `SupabaseStorageProvider.ts:106-113`), which normalizes bytes and rejects non-decodable input. No stored-XSS surface; the serve proxy additionally refuses SVG.

## D. Data-model irreversibility — decide NOW while there's one user

### D1. Stored UISchema blobs are never migrated on the web side — RANK 1

- The C# plugin has a full migration registry (`Plugin/Selva.Schema/Services/SchemaMigrator.cs`, 1.0.0 → 2.11.0, including breaking field renames), but it runs **only inside Grasshopper**. The web app stores `DefinitionVersion.schema` JSONB validated as merely "an object" (`platform/src/definitions/schemas.ts:21-24`) and the render path consumes it **verbatim** with no version check (`loadForRender.server.ts:124-135`). `schemaVersion` is not even required in `ui-schema.json` (has a default, absent from `required`) and the app never reads it — confirmed by grep, only the generated type mentions it.
- Once thousands of definitions are frozen at old schema versions, the options are: port the C# migrator to TS (double-maintenance forever) or backfill-migrate every blob per schema bump.
- **Decide now:** (a) store `schema_version` explicitly alongside the blob; (b) pick the ownership model — recommended: treat stored schema as a **disposable cache**, re-extract from compute (which runs the C# migrator) on version mismatch instead of migrating in TS; (c) make `schemaVersion` required in `ui-schema.json`.
- **Progress (2026-07-11):** (b) DECIDED as recommended (disposable cache, re-extract on mismatch) and (c) DONE — schema format bumped 2.11.0 → 2.12.0 with `schemaVersion` in the `required` list, a `MigrateTo_2_12_0` C# step (legacy schemas get stamped by the migrator; the C# model always emitted the field, so no data transformation), and the TS generator now exports `UI_SCHEMA_VERSION` from the generated constants (changeset `schema-version-required`, `@selvajs/schemas` minor). (a) resolved as **not needed**: with the field required in-blob, the blob itself is the authoritative version carrier — no separate column. **Remaining:** the enforcement — `loadForRender.server.ts` still consumes the stored schema verbatim; add the `schema.schemaVersion !== UI_SCHEMA_VERSION` → re-extract-from-compute → `setVersionSchema` path (mirror the solve route's lazy-backfill bridge, including its best-effort/non-fatal semantics). Sequencing unchanged: land before K4 extracts `loadForRender`.
- Related runtime gap (ops audit): no plugin↔app compat gate at upload — a definition authored with a newer plugin is silently accepted or crashes the renderer with no "server supports ≤2.11" message. Same fix surface — `UI_SCHEMA_VERSION` is now the constant to compare against at upload.

### D2. Definition status enum drift — RANK 2 (3-line fix)

- DB CHECK allows all 5: `('pending','draft','review','published','archived')` (`20260425155514_selva_initial.sql:476`); TS type has **4**, missing only `review` (`definitions/types.ts:28` = `'pending' | 'draft' | 'published' | 'archived'`); Zod has **3**, missing both `pending` and `review` (`definitions/schemas.ts:7` = `['draft','published','archived']`). Three definitions of one enum (verified against source 2026-07-05). Reconcile now while zero rows use the divergent values — and **decide first** whether `pending`/`review` are real states (widen TS+Zod) or dead DB values (tighten the CHECK instead); the direction is a design micro-decision, not mechanical.

### D3. Audit event payload unversioned — RANK 3

- `audit_events.data` is the raw `DomainEvent` union serialized with no envelope/version. Append-only forever-table: every historical shape must be parseable forever, and old vs new shapes are indistinguishable. Add `{ v: 1, ... }` or an `event_version` column now while the table is nearly empty — or explicitly document `data` as opaque/non-queryable.

### D4. Single-org membership baked into bootstrap — RANK 4

- The DB is multi-org-ready (composite PK on `org_members`), but `findUserMembership` collapses to ONE org (earliest-joined, `SupabaseOrgStore.ts:258-289`) and `ctx.actingOrgId` has no switch mechanism. Retrofitting `/o/{slug}/` URL prefixes after users share deep links is the expensive part. **Decide now:** single-org by design, or reserve the URL shape before external links exist.

### D5. `/api/compute` contract unversioned — RANK 5

- `ComputeRequest` has no version field; `local:` GUID prefix scheme, `?token=share_…` param, and the raw `JSON.stringify(solvedDefinition)` response (the compute lib's internal shape leaked verbatim) are all implicit wire contracts with the plugin and share consumers. Add a version marker (`/api/v1/compute` or `v` field) and a response envelope while you're the only client.

### D6/D7. Smaller decisions

- Org deletion mixes soft-delete (org/projects/members) with **hard-delete** of invites + compute config (`SupabaseOrgStore.deleteOrg`, documented) — org restore is lossy. Confirm intended.
- Storage visibility is encoded in the path prefix (`branding/` vs `private/`) — changing a blob's visibility means moving the object. Low likelihood; note only.

### Future-proofed well (data model)

UUID PKs everywhere, no slug/email FKs; storage paths keyed by immutable ids (never slugs); append-only idempotent migrations in an isolated `selva` schema (one drift already caught and fixed via migration); consistent `deleted_at` + partial unique indexes; immutable version snapshots with `ON DELETE RESTRICT`; `solve_metrics` deliberately FK-free to survive definition deletion.

## T. Test coverage

### T1. THE finding: selva app tests don't run in CI

- `.github/workflows/test.yml` runs three jobs — `@selvajs/schemas`, `@selvajs/local-provider`, and the .NET suites (`Selva.Tests`, `Selva.Drawing.Tests`) — but on the JS app side runs **only** `pnpm --filter @selvajs/local-provider test`. `@selvajs/selva` is **explicitly skipped** (skip comment verbatim: "178 assertions pass, but the process exits 1 from an unhandled promise rejection in test cleanup (a race between suite teardown and async store writes)"); `@selvajs/supabase-provider` skipped (needs live stack). So the load-bearing claim stands — the selva app suite, the supabase provider, and the deny-direction conformance (see Q1) do not gate PRs — even though CI is not literally "one command."
- The app's tests are high quality where they exist — access-gate deny cases against a real LocalDataProvider, exhaustive share-link failure paths, route-classification negatives, `api/files` traversal/cross-tenant tests — but **none of it gates PRs**. A logic break in `access.server.ts` that keeps type-checking goes green.
- **Fix the teardown race and re-enable `@selvajs/selva` in CI before touching hooks/access/providers** — highest-leverage single action in this whole document; converts existing tests from decorative to load-bearing.

### T2–T7. Gaps ranked

2. `buildContext` and the `handle` flow are untested; test fixtures use a parallel reimplementation (`fixtures.ts::actAs` "mirrors buildContext()") that can silently drift from production. The §1 refactor lands exactly there.
3. The compute POST handler has zero handler-level tests — gate-selection branch, atomic share-cap increment, error mapping are only covered piecewise.
4. Local HMAC token expiry + tamper branches (`hmac.ts`) untested (conformance only does round-trip + garbage).
5. `requireCanSolve` has no direct test (currently rides `canView` equivalence — breaks silently the day solve gets quota logic).
6. `writeJsonFile` atomicity has no dedicated test (it IS atomic — temp+rename, verified — but nothing pins it).
7. Supabase stores effectively untested (conformance suites exist but skip without live creds AND are excluded from CI).

Well-covered: route classification, access-gate deny direction, share-link resolution, api/files access control, rate limit, SSRF guard, local-provider conformance (CI-gated), .NET schema migration + drawing snapshots (CI-gated).

## Q. Test quality (deep pass — beyond the T-section coverage map)

Three readers judged the actual test files: are they good, what's deletable, what's missing. Overall verdict: **unusually strong suites where they exist** — real providers in tmpdirs instead of mocks, deny-case-heavy, ordering invariants asserted via observable side effects. The problems are (1) the deny direction of the conformance suites never actually executes, (2) a handful of weak/duplicated tests, (3) a small set of high-blast-radius missing cases.

### Q1. The deny direction of the store conformance suites NEVER RUNS — top finding

- The shared suites in `packages/platform/src/testing/suites/` contain proper cross-org/cross-user rejection tests (`orgStoreSuite` "cannot get an org they do not own", `definitionStoreSuite`/`projectStoreSuite` isolation cases) — but they're gated behind a `ctxIsolation` flag. **Correction (verified 2026-07-05): `ctxIsolation: true` is set NOWHERE in the repo** — grep across all `*.test.ts` returns zero. The local provider omits it (by design: local shares all records), and the Supabase conformance tests _also_ never pass it (even the ones that seed a `secondaryUserId`). So the deny direction is dead in **both** providers, not "Supabase-only" as the doc originally implied — the gate never fires anywhere.
- Net: the access-denial direction of the entire store layer is tested nowhere that executes. Compounding trap: `readEnv()` in `packages/providers/supabase/src/data/__tests__/test-helpers.ts` (not under `packages/platform`) silently returns `null` (→ skip) on Node < 22 even when creds ARE present — it catches the realtime-js WebSocket construction error and returns `null`, so a misconfigured CI goes green while testing nothing.
- Fix: CI job with `supabase start` + migrations + `.env.test` **and pass `ctxIsolation: true` from the Supabase conformance invocations** (without that, adding the CI job still runs zero deny tests); make `readEnv` throw when `SUPABASE_URL` is set but the client can't construct; convert capability-absent silent `return`s in `authProviderSuite`/`emailLinkAuthSuite` to `it.skip` so green ≠ didn't-run.

### Q2. Probable root cause of the CI teardown race (T1)

The app-suite reader scanned for the unhandled-rejection source: it is **not** in the test files (rate limiter has no timers; every `afterEach` awaits cleanup; `singleFork` serializes). Most plausible origin: a **fire-and-forget sharp transcode promise** in the local storage `put()` path (cover/branding tests) resolving after `fs.rm` deletes the tmpdir — an unawaited image-transcode rejecting against a deleted directory. Check `LocalStorageProvider.put`/`transcodeImageIfNeeded` awaiting discipline and the tests' `seedCover` helpers first when fixing T1.

### Q2b. CI blind spots beyond T1 (from the .NET/E2E pass)

- **`@selvajs/ui`, `@selvajs/plugin-ui`, `@selvajs/config`, `@selvajs/cli` tests are not invoked in CI at all** — including the cross-stack wire-fixture tests (`wire-fixtures.test.ts`/`messageSchemas.test.ts`), whose C# halves DO run. A TS-side envelope drift goes green.
- **The plugin-ui E2E suite is stranded**: `packages/plugin-ui/e2e/` (builder + preview against a transport-level WebSocket stub of the Grasshopper protocol — the app runs unmodified) is the most valuable E2E in the repo and `e2e.yml` filters to `@selvajs/selva` only, whose suite is a thin auth/routing smoke (no upload, no solve).
- What IS solid on PR: both .NET suites (net8.0/ubuntu) and the generated-code drift gate (`pnpm generate` + `git diff --exit-code` over TS + C# + SchemaVersion) — the latter is the right mechanism for ui-schema drift; no unit tests needed there.

### Q3. Deletable / slimmable tests (small list — little dead weight)

.NET additions:

- `Plugin/Selva.Drawing.Tests/SmokeTests.cs` — `Assert.True(true)`. Delete.
- `Plugin/Selva.Tests/JsonSchemaTests.cs` — strict subset of `SchemaValidatorTests.Fixture_ValidFile_PassesValidationWithNoErrors`. Delete.
- `SchemaMigratorTests` `:181` overlaps `:160` (its inputs/outputs scaffolding is never asserted). Merge.
- Review `SymbolBenchmarkTests.cs` for timing-flakiness in the unit suite.

- `definitionStoreSuite.ts` "versioning scaffold: liveVersionId/draftVersionId default to null on create" — restates factory defaults; delete.
- `storageProviderSuite.ts` `getPublicUrl` "consistent"/"differs" pair — keep one of three; slim.
- `compute-server-encryption.test.ts` "preserves servers with no apiKey" — duplicated inside the verifySecrets-ok case; delete.
- `HeaderAuthProvider.test.ts` "reads custom header names" — redundant with the `fromEnv` override test; slim.
- `updateCheck.test.ts` `isNewer('a','b')` lexical-fallback pin; `releaseChannel.test.ts` on-disk-shape pin — implementation-detail pins; fold/drop.
- `scenarios.test.ts` pure-rule matrices (`canView`, `canChangeVisibilityToPublic`) — belong in `@selvajs/platform`'s own unit tests, duplicated here; relocate.
- Three identical `create populates createdBy/updatedBy` tests across org/project/definition suites — one shared helper.

### Q4. Tests needing strengthening

- `scenarios.test.ts` `.resolves.toBeDefined()` assertions on `requireCanViewProject`/`requireCanCreateDefinition` — assert the returned identity/project like their stronger siblings do.
- `patch-member.test.ts` cross-tenant case is self-admittedly ambiguous (actor fails the permission gate before the tenancy check) — give the actor the permission in their own org and assert the cross-org 403 still holds, or a dropped tenancy check stays green.
- `upload-schema-gate.test.ts` hand-builds `locals`/event instead of using the shared `call()`/`actAs()` path — will drift on handler-signature changes.
- `bootstrap-admin.test.ts` describes the concurrent first-signin race in prose but never exercises it.

### Q5. Top missing high-value cases (merged, ranked by blast radius)

1. **Endpoint-level share-cap enforcement:** a share-token solve AT its `maxSolves` cap must be rejected by `/api/compute` itself. Units pass individually (resolver, store cap); whether the handler wires the cap into the deny path is unverified. Direct compute-budget exposure if it regresses.
2. **Concurrent `tryIncrementSolveCount` against a capped link** (`Promise.all` ×N) — the suite header advertises atomicity but only tests serially; local's whole-file read-modify-write almost certainly over-counts under contention. Exactly the local↔supabase drift a conformance suite exists to catch. Same class: two concurrent `addOrgMember` to one org (lost-update).
3. **Rate-limit key selection at the endpoint:** nothing verifies anonymous share solves are keyed `share:{linkId}` vs `user:{userId}` — if the handler keyed both by empty userId, all anonymous consumers share one global bucket.
4. **`hmac.ts` direct tests:** tampered signature, tampered payload (userId swap), expired token, length-mismatch branch — the local session boundary is only round-trip tested. Plus `fsJson.ts` direct tests: crash-safety (pre-planted `.tmp`, throwing write leaves previous file intact) and missing-file fallback isolation (the shared-EMPTY mutation-bleed guard, §S3c).
5. **Privilege-escalation direction in member PATCH:** admin granting owner-only perms to self/peer admin is untested (the tested cases are admin→member grant and member→rejected).
6. **Pagination cursor stability under insertion** — the cursor is a raw offset (`pagination.ts`); insert-between-pages will skip/duplicate rows, and local vs Supabase may drift. Honorable mention: unicode case-folding (Turkish-İ/ß) on slugs/emails/UPNs — JS `toLowerCase()` vs Postgres `lower()` drift, and an allowlist-bypass risk in header-auth.
7. **The product's core loop has zero E2E**: authed user → upload definition → set input → solve → binary geometry → render. The selva E2E stops at auth; the plugin-ui stub omits binary mesh frames entirely. Related unit gap: `BinaryGeometryWriterTests.cs` (excellent — delta/zigzag, wrapping arithmetic, index promotion all covered) verifies against a **C#-reimplemented decoder**, not the shipping JS parser — writer↔reader drift in the real TS decoder reddens nothing. Fix: feed C#-produced blobs into the actual JS parser (mirror the wire-fixture pattern).
8. **SchemaMigrator hostile input + fixture void**: a corrupt `schemaVersion: "abc"` throws an unguarded `FormatException` from `MigrateJson` (`SchemaMigrator.cs:51`) — untested; malformed layouts (non-array `tabs`/`items`, string `source`) untested; golden fixtures stop at v2.4.0, so the real 2.9.0/2.10.0 source-kind transformations have no full-pipeline fixture. Directly feeds the D1 decision (stored schemas will hit this code).

### Q6. Genuinely good tests (leave alone, imitate elsewhere)

`safe-url.test.ts` SSRF table (encoding bypasses, metadata IPs); `access-control.test.ts` path-shape gate (traversal/suffix-injection); `sole-admin-sequencing.test.ts` (asserts the 409 AND re-reads the auth provider to prove ordering via side effect); `upload-schema-gate.test.ts` fail-closed assertion (fetch never called, nothing persisted); `mock-surface.test.ts` (drift guard: mock must be superset of real module's exports); header-auth allowlist deny-direction tests; `definitionStoreSuite` reference-protection with rollback verification. On the .NET side: `BinaryGeometryWriterTests.cs` (the best-tested unit in the repo — wire-format behavior via an independent decoder, wrapping deltas, quantization fallbacks); the cross-stack wire-fixture pattern (same JSON fixtures validated by both C# and TS — extend it to more envelope types); the SVG snapshot suite (deterministic via bundled font metrics, explicit env-gated re-pinning — snapshots that can't be blindly re-approved).

## O. Operational readiness

### O1. No error tracking — you would not know a user hit a 500 — CRITICAL

- `hooks.server.ts:424-462` `handleError` is careful (cause chains, no internal leak to client) but dead-ends in `console.error`. No Sentry/OTel/shipper anywhere; discovery mechanism is SSH + `pm2 logs`. Smallest fix with the biggest visibility payoff: `@sentry/sveltekit` (DSN behind env var so self-hosters opt out) + `unhandledRejection` hook.

### O2. Self-update endpoint under-observable — HIGH

- `admin/api/system/update/+server.ts` — the mechanism is genuinely well-engineered (detached runner, health-probe + auto-rollback, EXIT-trap keep-alive), but: log goes to `/tmp/selva-update.log` (wiped on reboot), **no audit event** for the most destructive operator action, no error-tracker report on rollback. Emit audit events (start/finish/rollback + versions + actor), persist the log under `DATA_PATH`.

### O3. No app↔DB schema handshake — HIGH

- Self-update runs `npm install` + pm2 restart but never applies Supabase migrations or checks schema head; `/api/health` won't catch skew (it only reflects boot-time secret checks). An operator who forgets `db push` gets per-request `PGRST` errors — invisible per O1. Fix: expected-schema-version constant + boot comparison → 503 via health; a `selva doctor` migration-head check; warn/block in the update runner.

### O4. Logging is unstructured console soup — MEDIUM

- 27 `console.*` calls, prefix conventions but no levels, no request correlation, no JSON. No secrets logged (verified — `hasApiKey` pattern holds; the verbose compute-debug flag dumps payloads but is opt-in). Introduce pino + request-ID in hooks; keep prefixes as `component`.

### O5. Local-provider data has no backup/export tooling — MEDIUM

- No `selva backup`/export command; no local→supabase migration path for graduating deployments. (A subagent claim that JSON writes lack atomicity was **wrong** — `fsJson.ts:23-28` does temp+rename; the real residual risks are disk-full/permission corruption mid-operation, already surfaced by the admin health check, and no snapshot to roll back to.)

### O6. `/api/health` is boot-snapshot only — LOW

- `bootHealth` caches its report at boot and never refreshes — the LB-facing probe stays 200 after the DB/compute die post-boot. The live checks already exist behind the admin-gated system-health route; reuse them with a short-TTL cache in `/api/health` or a separate `/api/ready`.

### Ops: already solid

`selva doctor` is genuinely excellent (placeholder-key detection, writability, reachability, PM2/systemd verification, version alignment); fail-fast env validation with clear messages; at-rest key handling + recovery flow; deny-by-default gating; per-boot `instanceId` in health; Supabase migration hygiene.

---

# Not yet audited — remaining known gaps

What the audit passes did NOT cover, split by whether it's worth doing now.

## Worth doing now

1. **Dependency vulnerabilities (checked 2026-07-05)** — see below, executed.
2. **`@selvajs/compute` — the unaudited core.** It lives in a separate repo (consumed via catalog `^3.1.0-beta.1`) and contains the solve client, `SolveScheduler`, data-tree parsing, and the **JS binary-geometry parser** (the untested half of the Q5#7 round-trip gap). Two real production bugs already came from there (pointer-cache silent-empty-geometry; TreeBuilder flattening geometry trees). It deserves the same efficiency + test-quality pass this repo got — arguably first, since every solve flows through it. **Not started.** — **Caching sub-audit STARTED (2026-07-11):** the solve-caching-at-scale surface (durable/shared solve cache, 32-bit `hashSolveInput` collision risk, pre-solved downloadable bundle, blob/client-memo wins) is mapped in `selva-compute/CACHING.md`. It spans both repos — its H1 durable `ISolveResultCache` lands app-side in `packages/platform` + `/api/compute`, its H2 needs a SHA-256 keying export from `@selvajs/compute`. Ties into B1 (compute saturation) and LB (definition-affinity routing) below. — **Second pass DONE (2026-07-11, "Re-review addendum" in that file):** package bugs filed as `selva-compute/ISSUES.md` 114–116 (errored-solve cache log/flag mismatch — caching them is _intended_, decided 2026-07-11: GH errors are valid results; no in-flight coalescing; shared mutable cache hits). App-side design ask from the same pass: a per-definition `cachePolicy` on/off flag on the definition record — for non-deterministic definitions AND ones with effectively infinite input spaces (continuous sliders → ~0% hit rate, pure cache churn) — consulted before any durable-cache read/write (CACHING.md addendum R9). Two findings live in THIS repo:
   - **Per-server solve serialization, no backpressure (B1-adjacent):** `packages/server/src/compute/client-cache.ts:190` creates the shared scheduler with `mode: 'queue'` and no `maxConcurrent` → defaults to **1**. Every user on a compute server (per app instance) waits in one unbounded FIFO; one slow solve (100 s deadline) stalls all of them; the scheduler's `timeoutMs` starts at _execution_, so queue wait is unbounded and invisible; and per `selva-compute` issue 46 a request whose client disconnected while queued still runs the full compute. Directions: `maxConcurrent` sized to the Rhino pool, queue-depth cap with fast 503 + Retry-After, queue-wait deadline, per-key coalescing.
   - **Stale `X-Selva-Definition` header on shared clients (LB / ADR 0004 D2):** the header is baked at client _build_ time (`client-cache.ts:185-187`) from whichever definition first touches that server; all later definitions on the same warm client send the wrong guid. Inert-ish today (bad access-log telemetry), but it mis-routes the moment a definition-affinity pool router keys on it — needs a per-request header path first.
3. **Client-side viewer memory** — see V section below, executed.
4. **Privacy-claim reality check** — see P section below, executed.

### Dependency vulnerabilities (checked 2026-07-05)

`pnpm audit --prod` reports 6 findings — 4 moderate **Svelte SSR XSS / DOM-clobbering / ReDoS** advisories, 1 moderate SvelteKit `query.batch` cross-talk, 1 low (cookie). Framework-level XSS in an app that renders user-authored schema content is not theoretical. **Exact fix identified:** the catalog in `pnpm-workspace.yaml` pins `svelte: 5.55.5` (all four advisories patched in ≥5.55.7) and `@sveltejs/kit: 2.58.0` (patched in ≥2.60.1, which also pulls the fixed `cookie`) — two catalog edits + `pnpm install`. Add `pnpm audit` to CI so this is continuous, not a one-off.

## V. Client-side viewer memory audit (point 3 — executed)

**Headline: the hot path is safe.** The external `@selvajs/compute` visualization layer (read via its shipped source maps) does per-solve disposal correctly — `updateScene` → `clearScene` traverses and disposes geometry, materials, AND texture slots before adding new meshes — and `dispose()` on unmount cancels the RAF loop, removes all listeners, disposes controls/pipeline/renderer, and sweeps the scene. No resize/ResizeObserver leaks exist (resize is polled inside the RAF loop, so it dies with it). The WS driver bounds its binary-frame ring buffer (64) and cleans its listeners. Slider scrubbing at several solves/second does not accumulate GPU memory.

**Actionable findings:**

1. **`renderer.forceContextLoss()` missing on teardown — the one real in-repo fix.** The library calls `renderer.dispose()` but never forces context loss, and `ComputeApp.svelte`'s `{#key definitionKey}` block recreates the canvas + `WebGLRenderer` + GL context on every definition switch. Browsers cap live WebGL contexts (~16) — heavy back-and-forth navigation can hit "Too many active WebGL contexts". Mitigation: `initThree`'s result already exposes `renderer` (`Viewer.svelte:165-174` just doesn't capture it) — keep a reference and call `renderer.forceContextLoss()` after `init.dispose()` in the cleanup. Also worth upstreaming into the library's `dispose()`.
2. **Base64 image outputs transiently doubled in heap** — `ImageOutput.svelte:32` string-concats the base64 into a `data:` URL, so large image outputs exist twice (store value + img src) per solve. Churn, not a leak. Optional fix: decode to Blob + `createObjectURL` with revocation if image payloads grow.
3. **Server-side note:** the new `TextureAssetStore` (`Plugin/Selva.GH/Features/Display/Services/TextureAssetStore.cs`) is a content-addressed, process-wide `ConcurrentDictionary` with **no eviction** — entries live for the Rhino session. Client side it's all upside (hash-keyed URLs, HTTP-cache dedupe, solves ship URLs not bytes); flag only for long-lived plugin sessions with many distinct textures.
4. **No `renderer.info` instrumentation exists** — capturing `init.renderer` and logging `renderer.info.memory` after `updateScene` would be a cheap regression guard for this audit's invariant (counts flat across scrubs and navigations).

## P. Privacy-claim audit (point 4 — executed)

**Verdict: the CLAUDE.md claim is false as written.** CLAUDE.md ("zero exposure to EU data regulations, credentials, or company user records") overclaims. **Correction (verified 2026-07-05): `docs/providers.md` does NOT contain the "zero exposure" wording** — the doc originally claimed line 16 repeated it; it does not. The nearest phrasing there is softer and correctly scoped to the auth-provider case ("Identity, credentials, and PII are owned entirely by the auth provider; Selva stores only opaque session tokens, user IDs, and minimal authorization metadata"). So the aggressive claim lives **only in CLAUDE.md** — the public docs surface is smaller than the doc implied, and only CLAUDE.md needs the hard reword. The marketing landing page makes no privacy claim.

**Contradictions found:**

1. **Selva IS the auth provider in local mode** — `auth-users.json` stores email + PBKDF2 password hash (`providers/local/src/auth/users.ts:13-26`). Header-auth writes company emails/UPNs/display names to its allowlist file. "Credentials owned exclusively by the auth provider" is misleading when Selva ships that provider.
2. **"Stores only tokens + id + perms" is incomplete** — Selva also persists display names, invite emails, audit-event payloads carrying emails (`invite.created`, `events/interface.ts:52-58`), actor ids, and solve telemetry.
3. **No right-to-erasure guarantee** — `DELETE /admin/api/users/[id]` removes auth user + user-data rows, but: invite rows keep the email forever (no cascade, nothing purges by age), and on Supabase `audit_events` keeps actor ids + email payloads forever (`SupabaseDataProvider.onUserDeleted` is a **no-op**, `SupabaseDataProvider.ts:130`; the table is append-only with no retention). User deletion is partial.
4. IPs are processed by the login rate limiter (`admin-auth.server.ts:23`, `getClientAddress` in login/email-start) — but **transient, in-memory, ≤15 min, never persisted or logged**. Lowest-risk item.

**What holds up:** cookies are strictly-necessary auth only (`httpOnly`, `sameSite=lax`, secure in prod); zero analytics/trackers in app or website; no console log prints emails/tokens/IPs (verified).

**Fixes:**

- Reword CLAUDE.md (the only place with the "zero exposure" claim): drop "zero exposure"/"exclusively"/"only"; state what IS stored per provider and that the operator is the data controller responsible for retention/erasure. `docs/providers.md` is already appropriately hedged — leave it, or tighten only if you want the "stores only…" line to name the local-provider exception.
- Erasure: make `SupabaseDataProvider.onUserDeleted` scrub/delete the user's `audit_events` rows and invites by email; purge accepted/expired invites by age.
- Retention: `pg_cron` (or documented manual) purge policy for `audit_events` + `solve_metrics` — dovetails with B4's retention item.
- Optional: HMAC the IP before using it as the rate-limit key so no raw IP sits in memory.

## Deliberately deferred (fine for now)

- **Plugin C# runtime quality** (WebSocket server thread safety, Rhino document interaction, memory) — runs on user machines, lower blast radius, and its logic is the best-tested part of the repo.
- **Accessibility / i18n** — revisit when selling into orgs that require it.
- **Docs accuracy drift** (e.g. `docs/Caching.md` vs the caches found in these audits) — fold into whichever fix touches each area.
- **License-compliance scan, website package** — low risk.
