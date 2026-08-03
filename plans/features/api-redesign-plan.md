# Plan: API v1 redesign — one versioned surface for browser + tokens

## Context & decision

The current `/api/*` surface is internally consistent (uniform `apiError`/`ApiErrorCode` envelope,
guards from `access.server.ts`) but was grown as a browser-mutation API: **all list/detail reads
live in page load functions**, two endpoints have unconventional method semantics, and org-scoped
naming is inconsistent. The PAT/public-API plan ([token-plan.md](token-plan.md)) needs a stable
contract on top of this.

**Decision (supersedes token-plan Phase 4's wrapper approach):** Selva is pre-launch with zero
external API consumers — so instead of freezing the current shape behind `/api/v1` wrappers, we
redesign the API once, now, as a **single versioned surface `/api/v1/*` used by both the browser UI
and API tokens**. One implementation, one contract, continuously dogfooded by our own UI. Stability
is expressed per-endpoint in the OpenAPI spec (`x-internal` tags), not by maintaining two URL trees.

Migration cost is small and fully in-repo: ~30 `fetch('/api/…')` call sites across 15 files in
`packages/selva/src`. (Phase A includes a repo-wide grep — check `packages/cli` and any
non-template-literal URL construction too.)

---

## Conventions (normative — every v1 endpoint follows these)

### Paths

- `/api/v1/<plural-resource>[/{id}[/<sub-resource>|/<action>]]`.
- **Org-scoped resources are explicit**: `/api/v1/orgs/{orgId}/…` (members, invites, compute
  settings). Tenancy invariant stays as implemented today in
  [orgs/[orgId]/members/[userId]/+server.ts](../../packages/selva/src/routes/api/orgs/%5BorgId%5D/members/%5BuserId%5D/+server.ts):
  the URL `orgId` **must equal `ctx.actingOrgId`** (403 otherwise). Explicit IDs future-proof for
  the planned URL-prefix tenancy (`/o/{slug}` note in hooks.server.ts) without changing the API.
- **User-scoped resources** under `/api/v1/me/…` (starred; profile later).
- **Actions** (non-CRUD verbs) are `POST /api/v1/<resource>/{id}/<verb>` — `publish`, `reclaim`,
  `solve`, `disable`. Documented in OpenAPI as actions, not resources.

### Methods & status codes

| Method   | Use                                                       | Success                    |
| -------- | --------------------------------------------------------- | -------------------------- |
| `GET`    | Read; never mutates                                       | `200` + resource / page    |
| `POST`   | Create (`201` + created resource) or action (`200`/`202`) | `201` / `200`              |
| `PATCH`  | Partial update (all our updates are partial)              | `204`, or `200` + resource |
| `PUT`    | Idempotent full set **only** (`/me/starred/{guid}`)       | `204`                      |
| `DELETE` | Delete / revoke                                           | `204`                      |

No `PUT` for partial updates — the two current offenders both move to `PATCH` (their handlers
already have merge semantics: `PUT /api/org/compute` documents "`undefined` leaves it untouched").

### Errors

The existing envelope from [api-errors.ts](../../packages/selva/src/lib/server/api-errors.ts)
(`ApiErrorCode`, `apiError`, `handleApiError`) is the v1 contract. Every code gets documented in
the OpenAPI spec. No route may return a bare `error(...)` — already true for all 40 route files;
a conformance test keeps it that way (Phase D).

### Response envelope

**Collections return `{ items: T[], nextCursor?: string }`. Single resources return the resource
object bare.** No resource-named keys — `{ items: [...] }`, never `{ projects: [...] }`; the project
object itself, never `{ project: {...} }`.

This is a change from today: `GET /api/projects` currently returns `{ projects: page.items }`,
discarding the `Page<T>` the store already handed it. A resource-named key forces every client —
UI, CLI, MCP — to write one unwrapper per endpoint instead of one pagination helper for the whole
API. Phase A rewrites these call sites anyway, so the cost of fixing it is close to zero now and
grows with every consumer added later.

### Pagination

Cursor-based, straight from the platform layer
([pagination.ts](../../packages/platform/src/pagination.ts)): query params
`?limit=&cursor=&orderBy=&orderDir=` → response `{ items: T[], nextCursor?: string }`.
Limits clamp to `MAX_PAGE_LIMIT` (200), default 50. Cursors are opaque. Every list endpoint —
no unpaginated collections in v1. `GET /api/projects`'s hardcoded `limit: 200` with no cursor
pass-through is the current offender; it becomes a normal paginated list.

### Idempotency

`POST /api/v1/definitions/{guid}/solve` accepts an optional `Idempotency-Key` header. A repeated
key within the retention window returns the first response instead of re-solving.

Solve is the one action with real per-call cost, and its two biggest non-browser consumers both
retry by nature: a CLI wrapping a flaky network, and an LLM re-issuing a tool call it thinks
failed. Without a key, both double-charge compute. Retrofitting this after PATs ship means changing
a published contract, so it lands with the endpoint. Scope for v1.0: in-memory store keyed by
`(tokenId|userId, key)`, short TTL — enough to absorb retries, not a durable result cache.

### Stability & change policy

- Every endpoint is either **public** or **`x-internal`** in the OpenAPI spec. `x-internal`
  endpoints are excluded from published docs and may change without notice.
- Public endpoints: **additive-only** within v1 (new optional fields/params OK; no removals,
  renames, type or semantics changes). Breaking change ⇒ new route under `/api/v2` alongside.
- Uploads (definition create, version upload, image) are `multipart/form-data`; documented as such.

### Auth & the two scopes

The API has exactly two scopes, and the URL says which one you're in:

| Prefix         | Scope                               | Credentials       | Versioned |
| -------------- | ----------------------------------- | ----------------- | --------- |
| `/api/v1/*`    | Tenant — acts as the caller's `ctx` | Cookie **or** PAT | Yes       |
| `/api/admin/*` | Platform — instance administration  | Cookie **only**   | No        |

- `/api/v1/*` is the _only_ prefix that accepts `Authorization: Bearer sk_…`. The token-plan gates
  on `pathname.startsWith('/api/v1/')` exactly, so this stays an unconditional prefix test with no
  carve-outs inside it.
- **`/admin/api/*` moves to `/api/admin/*`** (Phase A). Same handlers, same session-only treatment,
  same per-handler `requireInstanceAdmin`. What changes is that all HTTP endpoints live under one
  `/api` root and `/admin` becomes purely the page tree.
- `/api/health` stays unversioned (LB probe, allowlisted in the route classifier).

Why the split is by scope and not folded into one tree: `/admin/api/projects` lists **every org as
`SYSTEM_CONTEXT`**, while `/api/projects` lists **the acting org as the caller**. Same resource
name, deliberately different reach — not duplication to merge. Putting admin inside `/api/v1/*`
would make instance administration bearer-reachable by default and require an exception inside the
prefix that is supposed to be uniform.

**Known gap this move does not fix:** `/admin/+layout.server.ts` guards page loads only — SvelteKit
does not run layout loads for `+server.ts`. Admin endpoints are protected solely by their own
`requireInstanceAdmin` call. True today, true after the move; the Phase D conformance test is what
turns it from convention into something enforced.

---

## Target surface (endpoint map)

Status legend: **moved** = same handler, new path; **method** = same handler, corrected method;
**NEW** = handler must be authored; **renamed** = path normalization.

### Definitions

| Method | Path                                                     | Status  | Notes                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/definitions`                                    | **NEW** | List visible definitions. Filters: `projectId`, `status`; cursor pagination (`DefinitionListOptions`). Access filtering extracted from the library load (Phase B).                                                         |
| POST   | `/api/v1/definitions`                                    | moved   | Create (multipart: file + metadata). Was `POST /api/definitions`.                                                                                                                                                          |
| GET    | `/api/v1/definitions/{guid}`                             | **NEW** | Detail: record + live/draft version summary.                                                                                                                                                                               |
| PATCH  | `/api/v1/definitions/{guid}`                             | method  | Metadata update. Was `PUT` — handler unchanged.                                                                                                                                                                            |
| DELETE | `/api/v1/definitions/{guid}`                             | moved   | Soft-delete.                                                                                                                                                                                                               |
| GET    | `/api/v1/definitions/{guid}/versions`                    | moved   |                                                                                                                                                                                                                            |
| POST   | `/api/v1/definitions/{guid}/versions`                    | method  | Upload new version (multipart). Was `POST /api/definitions/{guid}` — now lives on the collection it creates into.                                                                                                          |
| GET    | `/api/v1/definitions/{guid}/versions/{versionId}`        | **NEW** | Single version (metadata + changeNote).                                                                                                                                                                                    |
| GET    | `/api/v1/definitions/{guid}/versions/{versionId}/schema` | **NEW** | Stored `UISchema` for that version. No compute round-trip — reads what the upload cached.                                                                                                                                  |
| GET    | `/api/v1/definitions/{guid}/schema`                      | **NEW** | Convenience alias → the live version's schema. 404 if nothing is published.                                                                                                                                                |
| DELETE | `/api/v1/definitions/{guid}/versions/{versionId}`        | moved   |                                                                                                                                                                                                                            |
| POST   | `/api/v1/definitions/{guid}/publish`                     | moved   | Action.                                                                                                                                                                                                                    |
| POST   | `/api/v1/definitions/{guid}/solve`                       | **NEW** | **Flagship public action.** Thin alias over the compute handler: injects `definitionUrl: "local:{guid}"`, passes `inputs`/`values`/`channel`/`versionId` through. One implementation (Phase C). Honours `Idempotency-Key`. |
| POST   | `/api/v1/definitions/{guid}/image`                       | moved   | Upload preview image (multipart).                                                                                                                                                                                          |
| GET    | `/api/v1/definitions/{guid}/image/{filename}`            | moved   | Public read (embedded in payloads/pages).                                                                                                                                                                                  |
| GET    | `/api/v1/definitions/{guid}/share-links`                 | moved   |                                                                                                                                                                                                                            |
| POST   | `/api/v1/definitions/{guid}/share-links`                 | moved   |                                                                                                                                                                                                                            |
| DELETE | `/api/v1/definitions/{guid}/share-links/{linkId}`        | moved   |                                                                                                                                                                                                                            |

### Projects

| Method | Path                                     | Status  | Notes                                           |
| ------ | ---------------------------------------- | ------- | ----------------------------------------------- |
| GET    | `/api/v1/projects`                       | moved   | Add cursor pagination if currently unpaginated. |
| POST   | `/api/v1/projects`                       | moved   |                                                 |
| GET    | `/api/v1/projects/{id}`                  | **NEW** | Detail (project + caller's effective role).     |
| PATCH  | `/api/v1/projects/{id}`                  | moved   |                                                 |
| DELETE | `/api/v1/projects/{id}`                  | moved   |                                                 |
| GET    | `/api/v1/projects/{id}/members`          | moved   |                                                 |
| POST   | `/api/v1/projects/{id}/members`          | moved   |                                                 |
| PATCH  | `/api/v1/projects/{id}/members/{userId}` | moved   |                                                 |
| DELETE | `/api/v1/projects/{id}/members/{userId}` | moved   |                                                 |
| POST   | `/api/v1/projects/{id}/reclaim`          | moved   | Action.                                         |

### Orgs (explicit `{orgId}`, acting-org tenancy check)

| Method | Path                                    | Status           | Notes                                                                                                                    |
| ------ | --------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/orgs/{orgId}/members`          | **NEW**          | List (exists only as `orgs.listOrgMembers` in the team page load).                                                       |
| PATCH  | `/api/v1/orgs/{orgId}/members/{userId}` | moved            | Role/permission update; sole-owner invariant already implemented.                                                        |
| DELETE | `/api/v1/orgs/{orgId}/members/{userId}` | **NEW**          | Remove member — closes the current gap (project members have DELETE, org members don't). Reuse the sole-owner invariant. |
| GET    | `/api/v1/orgs/{orgId}/invites`          | renamed          | Was `GET /api/invites` (acting-org implied).                                                                             |
| POST   | `/api/v1/orgs/{orgId}/invites`          | renamed          | Was `POST /api/invites`.                                                                                                 |
| DELETE | `/api/v1/orgs/{orgId}/invites/{id}`     | renamed          | Was `DELETE /api/invites/{id}`.                                                                                          |
| GET    | `/api/v1/orgs/{orgId}/compute`          | renamed          | Was `GET /api/org/compute` (flag-gated).                                                                                 |
| PATCH  | `/api/v1/orgs/{orgId}/compute`          | renamed + method | Was `PUT /api/org/compute` — handler already merge-patch.                                                                |

### Me

| Method | Path                        | Status | Notes                                                                  |
| ------ | --------------------------- | ------ | ---------------------------------------------------------------------- |
| PUT    | `/api/v1/me/starred/{guid}` | method | Idempotent set (GitHub-style). Was `POST`.                             |
| DELETE | `/api/v1/me/starred/{guid}` | moved  |                                                                        |
| —      | `/api/v1/tokens`            | —      | From [token-plan.md](token-plan.md) Phase 3 — lands directly under v1. |

### Compute utilities

| Method | Path                     | Status                | Notes                                                                                                                                                 |
| ------ | ------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/compute`        | moved, **x-internal** | Generic solve incl. remote `definitionUrl` and share-token flow; the browser runner keeps using it. Public consumers use `/definitions/{guid}/solve`. |
| POST   | `/api/v1/compute/schema` | moved, **x-internal** | Pre-upload schema extraction utility for the create/upload dialogs.                                                                                   |

### Deliberately outside v1

- `/api/admin/*` (moved from `/admin/api/*`) — instance administration; unversioned, session-only,
  never PAT-reachable. Relocated for tree consistency, but **not** redesigned: no v1 conventions
  apply, no OpenAPI coverage, no stability promise. It is internal by definition.
- `/api/health` — LB probe; moving it breaks probes for zero gain.
- `/api/diag/throughput` — dev diagnostics; stays unversioned internal.
- `/api/files/[...path]` — blob serving with URLs embedded in stored payloads; renaming risks
  stale references. Stays as-is; revisit only if v1 needs first-class file resources.
- `/auth/*`, `/logout` — session lifecycle, not API.

---

## Phases

### Phase A — move the tree, fix methods, normalize envelopes (one PR)

Mechanical except for step 3, which changes response shapes. Every caller is in-repo and is being
edited in this PR anyway, so both land together rather than churning the same 15 files twice.

1. Move every route dir listed "moved/renamed/method" from `routes/api/…` to `routes/api/v1/…`
   with the corrected method/path. Handlers untouched except the export name (`PUT`→`PATCH`,
   `POST`→`PUT`) and the version-upload relocation (`definitions/[guid]` POST body →
   `definitions/[guid]/versions` POST).
2. **Move `routes/admin/api/**` → `routes/api/admin/**`** (16 `+server.ts` files). Handlers
   untouched — `requireInstanceAdmin` / `requireManageCompute` / `requirePermission` stay exactly as
   they are. Update the two in-repo callers found by grep:
   [useServerHealth.svelte.ts:54](../../packages/selva/src/lib/composables/useServerHealth.svelte.ts#L54)
   and [AssetUpload.svelte:24](../../packages/selva/src/lib/components/AssetUpload.svelte#L24).
   Note `admin/api/system/health` is a distinct endpoint from `/api/health` — the latter is the LB
   probe and does not move.
3. **Normalize response envelopes** on every moved route: collections → `{ items, nextCursor? }`,
   single resources → the bare object. `GET /projects` stops hardcoding `limit: 200` and passes
   `limit`/`cursor`/`orderBy`/`orderDir` through to the store. This is the breaking-shape step;
   it touches both the handlers and the UI call sites that destructure the old keys.
4. Update all in-repo callers: ~30 `fetch('/api/…')` sites in 15 files (plus a repo-wide
   grep for constructed URLs and `packages/cli`). Legacy `/api/*` routes are **deleted**, not
   deprecated — pre-launch, nothing external to break.
5. Route classifier / hooks: `isJsonApiRoute` (line 251) currently ORs `/api/` with `/admin/api/` —
   after the move it collapses to the single `/api/` prefix test. Confirm nothing allowlists old
   paths.
6. If STRUCTURE.md or other docs enumerate routes, update them.

### Phase B — author the reads (the real new work)

1. **Extract shared read helpers** into `$lib/server/` so page loads and v1 routes share one
   implementation (no HTTP self-calls):
   - `listVisibleDefinitions(ctx, opts)` — the batched access filtering (§2c pattern) currently
     inlined in [library/+page.server.ts](../../packages/selva/src/routes/library/+page.server.ts);
   - `getVisibleDefinition(ctx, guid)` — from `library/[guid]/+page.server.ts`;
   - project detail + org member list are thin over existing store calls.
2. New routes: `GET /definitions`, `GET /definitions/{guid}`, `GET /definitions/{guid}/versions/{versionId}`,
   `GET /projects/{id}`, `GET /orgs/{orgId}/members`, `DELETE /orgs/{orgId}/members/{userId}`.
3. **Schema reads** — `GET /definitions/{guid}/versions/{versionId}/schema` plus the
   `/definitions/{guid}/schema` live-version alias. Nothing today reads a stored definition's
   schema over HTTP: `POST /compute/schema` is a _pre-upload_ utility that takes a `.gh` file and
   round-trips to Rhino.Compute, and it is `x-internal`. Any non-browser client needs to know a
   definition's inputs before solving it, so this is the read-side partner to
   `POST /definitions/{guid}/solve`.
   Schemas belong to a **version**, not a definition — hence the sub-resource, with the
   definition-level path as a convenience alias rather than the canonical location.
4. Switch the load functions to the extracted helpers (pure refactor, same data).
5. Every new list endpoint: cursor pagination from day one.

### Phase C — definition-addressed solve

Extract the body-independent core of [api/compute/+server.ts](../../packages/selva/src/routes/api/compute/+server.ts)
so `POST /api/v1/definitions/{guid}/solve` can delegate with `definitionUrl = "local:{guid}"`
(reject a conflicting `definitionUrl` in the body with 400). Share-token and remote-URL flows stay
on `/api/v1/compute` (x-internal). This is the endpoint the CLI's `solve` command and the MCP
`solve_definition` tool both map to.

**Idempotency lands here, not later.** Optional `Idempotency-Key` header; a repeat within the TTL
replays the stored response instead of re-solving. In-memory store keyed by
`(tokenId|userId, key)` — the goal is absorbing client retries, not durable result caching. Adding
it after PATs ship would mean changing a contract that already has consumers.

### Phase D — contract artifacts

1. **OpenAPI spec** `packages/selva/openapi/v1.yaml`: all v1 endpoints, auth schemes (cookie +
   bearer), scopes (from token-plan), pagination params, full `ApiErrorCode` enum, `x-internal` tags.
2. **Conformance test** (vitest) — enforces the contract, not just its existence. Enumerate
   `routes/api/v1/**/+server.ts` exports and assert:
   - every method+path appears in the spec, and every non-`x-internal` spec path exists as a route
     (no drift in either direction);
   - no handler returns a bare `error(...)` — every failure carries an `ApiErrorCode`;
   - every collection endpoint accepts `limit`/`cursor` and returns `{ items, nextCursor? }` — a
     public list endpoint cannot ship unpaginated;
   - every `routes/api/admin/**` handler calls a platform-permission guard on every exported
     method. This is the check that makes admin protection structural: the `/admin` layout guard
     never ran for endpoints, so today "all admin routes guard themselves" holds only by review.

   Without the last three, `x-internal` is an annotation someone remembers to write rather than a
   boundary the build enforces.

3. **Docs page** `/docs/api` rendering the public subset of the spec.

---

## Interaction with token-plan.md

- Token plan **Phase 4 is superseded** by this plan (no wrapper layer; this IS the managed API).
- PAT acceptance (token plan Phase 2) gates on `pathname.startsWith('/api/v1/')` exactly.
- Token mint/management routes land at `/api/v1/tokens` from the start.
- Per-token rate limiting stays in the token plan; this plan only guarantees every v1 endpoint
  flows through guards that can consume `ctx.apiScope`.
- Build order: **Phase A/B of this plan first**, then the token plan — PATs should launch against
  the final surface, and the OpenAPI spec (Phase D) can document bearer auth in one pass.
- **The CLI is the first PAT consumer, ahead of MCP** (token-plan Phase 5). `selva projects list`,
  `definitions list`, `definitions schema`, `definitions upload`, `solve` are all tenant-scope
  `/api/v1/*` calls — none need `/api/admin/*`, which is what keeps the cookie-only admin split
  free. A PAT never widens permissions (token-plan's intersection rule), so CLI output is scoped to
  what its minting user can already see; `all-projects-admin` is the one deliberate exception and
  is read/solve only.

## Files to create / modify (representative)

**Create**

- `packages/selva/src/routes/api/v1/**` (moved route dirs + 8 new read/delete routes)
- `packages/selva/src/routes/api/admin/**` (16 `+server.ts` moved from `routes/admin/api/**`)
- `packages/selva/src/lib/server/definitions/visibility.server.ts` (extracted list/get helpers)
- `packages/selva/src/lib/server/idempotency.server.ts` (solve replay store)
- `packages/selva/openapi/v1.yaml` + spec↔route conformance test
- `docs/adr/00xx-api-v1-single-surface.md` (no-wrapper decision + the two-scope prefix split)

**Modify**

- 15 UI files with `fetch('/api/…')` call sites (+ any constructed-URL callers found by grep),
  including the envelope destructuring changed by Phase A step 3
- `lib/composables/useServerHealth.svelte.ts`, `lib/components/AssetUpload.svelte` (admin-path move)
- `hooks.server.ts` (`isJsonApiRoute` collapses to one `/api/` prefix test)
- `library/+page.server.ts`, `library/[guid]/+page.server.ts`, `team/members/+page.server.ts`
  (switch to extracted helpers)
- `api/compute/+server.ts` (extract solve core for the alias)
- `plans/features/token-plan.md` (Phase 2 gate, Phase 4 pointer, `/api/v1/tokens` paths)

**Delete**

- All legacy `packages/selva/src/routes/api/*` route dirs except `health`, `diag`, `files`.
- `packages/selva/src/routes/admin/api/` entirely (moved, not copied) — `/admin` keeps only pages.

## Verification

1. `pnpm check && pnpm type-check && pnpm lint && pnpm test` across the workspace.
2. Grep gates: no `fetch('/api/` outside `/api/v1/`, `/api/admin/`, `/api/health`, `/api/files`;
   no remaining reference to `/admin/api/` anywhere in the repo.
3. Manual dev pass (`pnpm dev:selva`): library list/detail, project CRUD + members, team members
   - invites, org compute settings, definition upload → new version → publish → solve (runner),
     share-link solve, starred toggle. **Plus the full `/admin` UI** — its endpoints all moved, and
     the layout guard never covered them, so a missed call site fails only at runtime.
4. New reads: `curl /api/v1/definitions` as two users with different access → visibility matches
   the library page for each.
5. Envelope check: every collection response is `{ items, nextCursor? }`; paging a list with
   `?limit=1` twice yields distinct items and a working cursor.
6. Idempotency: same `Idempotency-Key` posted twice to `/definitions/{guid}/solve` → one compute
   call, two identical responses.
7. Conformance test green; spec validates; `/docs/api` renders public endpoints only.

## Open questions (non-blocking)

- Should `GET /definitions` support free-text search (`q`) in v1.0 or ship filter-only? (lean: filter-only, additive later)
- Version detail: include a download URL for the .gh blob or keep blobs UI-only? (lean: no blob
  download in v1.0 — add deliberately if a use-case shows up, it's additive)
- `202 Accepted` + polling for long solves, or keep synchronous like today? (lean: synchronous —
  matches Rhino.Compute reality; revisit with queueing work)
