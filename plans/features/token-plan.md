# Plan: Token-based API auth (PATs) + managed public API, MCP designed-but-deferred

**Tracked in [#97](https://github.com/VektorNode/selva/issues/97)** (Phases 0–3) with [#214](https://github.com/VektorNode/selva/issues/214)/[#215](https://github.com/VektorNode/selva/issues/215)/[#216](https://github.com/VektorNode/selva/issues/216) as sub-issues.

> **Status verified 2026-08-16: not started, and now UNBLOCKED.** Phases 0–3 and 5 are 0% built —
> no `packages/platform/src/apiTokens/`, no `ApiToken` type, no Bearer branch in
> `hooks.server.ts`, no `/api/v1/tokens` routes, no `/settings/` tree. That is accurate to the
> plan's own claims.
>
> What changed: the api-redesign this was waiting on **shipped and was archived**. `/api/v1/*` is
> the single versioned surface, `bearerAuth` is already declared in `openapi/v1.yaml` alongside
> `cookieAuth`, and Phase 4's "managed public REST API" was delivered wholesale by it — this plan
> already records that supersession inline.
>
> Two things to fold in when starting:
>
> - Phase 4's "document Bearer auth in the OpenAPI spec" item is **done**.
> - Per-token rate limiting will need `RATE_LIMITED` added to `ApiErrorCode`. The redesign
>   documented 429 in the spec but never added the code — tracked at
>   [fixes/api-v1-residuals](../fixes/api-v1-residuals.md).

## Context

Selva today authenticates humans through exactly one selected session-auth provider
(`SELVA_AUTH_PROVIDER` = `local` | `supabase` | `header`), and its `/api/*` routes are all
gated by the session cookie `admin_session`. There is **no machine-to-machine credential** — the
only bearer-token path that exists is share links, which are scoped to a single definition and
carry no user identity.

As API access and LLM/automation use-cases grow, we need **GitHub-style personal access tokens**:
long-lived bearer credentials (`sk_...`) with a chosen expiry (30 / 90 / 180 days), an action+resource
scope set (read / write / solve × all / project / definition / org), that act **as the creating user
but never exceed that user's permissions**. Admins control **who is allowed to mint tokens** (a new
platform permission), not the tokens themselves. On top of that we document a **stable, versioned public
REST API** (the "good managed API") so third parties and LLMs have a contract that won't drift. An **MCP
server** is designed here as a concrete later phase, built only once the REST surface is stable.

### Decisions locked with the user

- **Parallel token layer**, not a 4th auth provider — PATs coexist with whatever session provider is active.
- **Two-axis scopes**: action (`read`/`write`/`solve`) × resource selector (`all`/`project:<id>`/`definition:<guid>`/`org:<id>`).
- **Per-user tokens**, but **a new `manage_api_tokens`-gated permission decides who may mint** them; a token can never exceed its creator's live permissions.
- **Scope of build now**: PAT infra + management UI + hook integration + versioned public REST API. **MCP = designed, deferred.**
- **Cross-project admin/IT capability** (data analysis across projects the admin is _not_ a member of): handled as a **token-only** override — a new `read_all_projects` platform permission lets its holder mint a token carrying an `all-projects-admin` scope granting **read + solve** across every project. This deliberately does **not** change the interactive browser session: the UI still follows the existing Reclaim rules (`contentCheck` gives `instance_admin` no bypass, by design — see [access.server.ts](packages/selva/src/lib/server/access.server.ts) lines 112–138). The blanket capability is opt-in, minted deliberately, visible in the token list, and auditable. `write` is intentionally excluded from the blanket scope.

---

## Architecture: where PATs plug in

The token is a **credential type**, resolved in `hooks.server.ts` _before_ the existing
session-cookie branch. It produces the same `AuthUser` → `RequestContext` the session path produces,
then **intersects** the resulting context's permissions/scope with the token's scope set. Everything
downstream (`access.server.ts` rules, every `IDataProvider` store call) is unchanged — the token
just hands them a narrower `ctx`.

Reused primitives (do **not** reinvent):

- **Token codec** — `createTokenCodec({ prefix, secret })` in
  [packages/server/src/tokens/token-codec.ts](packages/server/src/tokens/token-codec.ts). Two-part
  design (per-token random secret shown once, instance HMAC secret hashes at rest), `timingSafeEqual`,
  `MIN_TOKEN_SECRET_LENGTH = 32`. New prefix `sk_`, hashed with `SELVA_HMAC_KEY` like share-link and invite tokens.
- **Store template** — model the new store on `IInviteStore`
  ([packages/platform/src/invites/interface.ts](packages/platform/src/invites/interface.ts)) +
  `Invite` type ([types.ts](packages/platform/src/invites/types.ts)): `create` / `getByTokenHash(SYSTEM_CONTEXT, hash)` / `listBy...` / `revoke` / `deleteBy...`. Store keeps only `tokenHash`, never the raw token.
- **Local impl template** — [packages/providers/local/src/data/LocalInviteStore.ts](packages/providers/local/src/data/LocalInviteStore.ts) (JSON file, atomic write).
- **Context builder** — `buildContext(user, sessionToken, platformPermissions, membership)` in
  [packages/selva/src/hooks.server.ts](packages/selva/src/hooks.server.ts) (lines 107–146). PAT path reuses this, then narrows.
- **Permission model** — add one enum value to `PlatformPermissionSchema`
  ([packages/platform/src/permissions/types.ts](packages/platform/src/permissions/types.ts)).

---

## Phase 0 — Data model & platform interface (`@selvajs/platform`)

New module `packages/platform/src/apiTokens/` mirroring the `invites/` layout:

- **`types.ts`** — `ApiToken` record:
  ```ts
  interface ApiToken {
  	id: string;
  	userId: string; // principal — token acts AS this user
  	orgId: string; // acting org fixed at mint time
  	name: string; // human label, e.g. "MCP laptop"
  	tokenHash: string; // HMAC-SHA256(API_TOKEN_SECRET, raw); base64url
  	prefixHint: string; // first ~8 chars of raw, for list display ("sk_ab12…")
  	scopes: ApiTokenScope[]; // two-axis scope set
  	createdAt: string;
  	expiresAt: string; // mint-time choice, capped
  	lastUsedAt?: string; // best-effort, debounced like touchLastLogin
  	revokedAt?: string;
  }
  ```
- **`scopes.ts`** — the two-axis scope model + a **pure** `narrowContext` helper:
  ```ts
  type ApiTokenAction = 'read' | 'write' | 'solve';
  type ApiTokenResource =
  	| { kind: 'all' } // everything the CREATOR can access (bounded by their membership)
  	| { kind: 'all-projects-admin' } // EVERY project incl. non-member — requires read_all_projects
  	| { kind: 'org'; id: string }
  	| { kind: 'project'; id: string }
  	| { kind: 'definition'; guid: string };
  interface ApiTokenScope {
  	action: ApiTokenAction;
  	resource: ApiTokenResource;
  }
  ```
  Zod schemas for all of the above (matches the `invites`/`permissions` pattern of colocated schemas).
  `all-projects-admin` is the cross-project admin/IT capability — the only resource whose reach
  exceeds the creator's membership. Minting a scope containing it is rejected unless the creator holds
  `read_all_projects`, and its `action` may only be `read`/`solve` (never `write`).
- **`interface.ts`** — `IApiTokenStore` (create / getByTokenHash(SYSTEM_CONTEXT,hash) / listByUser(ctx,userId) / **listByOrg(ctx,orgId,opts)** / revoke(ctx,id) / touchLastUsed(id) / deleteByUser(ctx,userId) for the `onUserDeleted` cascade).

  **`listByOrg` is not optional — see the share-link precedent.** `IShareLinkStore` shipped with
  `listByDefinition` only, and finding 9 of the access-control audit is the result: a bearer
  credential nobody could enumerate. Answering _"what machine credentials currently reach this
  tenant's data?"_ has to be one query. Match the signature and the row shape that
  [`OrgShareLink`](packages/platform/src/shareLinks/types.ts) established — parent names resolved,
  and **`tokenHash` omitted from the type**, not merely left unread, since this is the row a page
  renders across the whole tenant. PATs make the stakes higher than share links: an
  `all-projects-admin` token reaches every project including ones its holder is not a member of.

  `/team/tokens` is then largely `/team/shares` with the first hop swapped —
  [`+page.server.ts`](packages/selva/src/routes/team/shares/+page.server.ts) and its RLS policy
  ([`20260817140000_share_links_org_roster.sql`](packages/providers/supabase/supabase/migrations/20260817140000_share_links_org_roster.sql))
  are the templates. Gate on `manage_org_members` for the same reason: it is the offboarding
  permission, whereas `manage_projects` can be handed to a plain member (§11).

- Add `apiTokens: IApiTokenStore` to `IDataProvider`
  ([packages/platform/src/data/interface.ts](packages/platform/src/data/interface.ts)); wire the
  `onUserDeleted` cascade to `deleteByUser`.

  **Deletion cascades; removal and disable deliberately do not.** `deleteByUser` fires only when the
  account itself is erased. A user removed from an org, or disabled, keeps their tokens — matching
  the share-link stance (Permissions.md §10) and for the same reason: a token is usually the
  credential behind a running integration, and killing it because the person who minted it changed
  teams is an outage, not a security win. Offboarding is roster-driven — open `/team/tokens`, filter
  to the leaver, revoke deliberately — which is exactly why `listByOrg` above is load-bearing rather
  than a convenience. If a deployment later wants auto-revoke, it layers on top of the roster; the
  reverse does not work.

- Add **two** values to `PlatformPermissionSchema`
  ([packages/platform/src/permissions/types.ts](packages/platform/src/permissions/types.ts)):
  - `'manage_api_tokens'` — **holding it = allowed to mint API tokens for yourself.**
  - `'read_all_projects'` — **holding it = allowed to mint a token carrying the `all-projects-admin`
    scope** (blanket cross-project read/solve). Held by IT/analysis staff; granted by an
    `instance_admin` through the existing user-permission admin UI.

  `instance_admin` implies both (already handled by `hasPermission`). Export in the barrel
  [packages/platform/src/index.ts](packages/platform/src/index.ts). Note both are **mint-time gates on
  the token path** — neither changes what an interactive browser session can do.

**Scope-narrowing is the security core.** `narrowApiTokenContext(fullCtx, scopes, requestTarget)`:

1. For the normal resources (`all`/`org`/`project`/`definition`) it only **removes** — intersection,
   never union. It never grants anything `fullCtx` lacks.
2. Maps `write`→ strips edit/manage rules if absent; `read`→ view only; `solve`→ solve only.
3. Resource selectors bind the ctx to the named project/definition/org; a request outside the
   selector is denied at the `access.server.ts` layer because the narrowed ctx won't satisfy the rule.
   Implement as: token adds a `ctx.apiScope` field (opaque to existing code) **plus** a pre-filtered
   permission set, so existing rules keep working unchanged and the scope acts as a second gate.
4. **`all-projects-admin` is the one deliberate exception** — it _widens_ content access to projects
   the user isn't a member of. It's safe because (a) it can only appear on a token whose creator held
   `read_all_projects` at mint time — re-checked at resolution against the _live_ permission, so
   revoking the permission neuters the token; (b) it's restricted to `read`/`solve`; (c) it flows
   only through the PAT/`/api/v1` path, never an interactive session.

> Design note: `RequestContext.adapterContext` is already "opaque adapter payload." We add a typed,
> optional `apiScope?: ApiTokenScope[]` to `RequestContext` (context.ts) rather than smuggling it
> through `adapterContext`, and a helper `scopeAllows(ctx, action, resource)` next to `hasPermission`.
> `access.server.ts` guards call `scopeAllows` when `ctx.apiScope` is present; absent = full session, no extra gate.

**Wiring the blanket bypass into the guards.** The content guards
([access.server.ts](packages/selva/src/lib/server/access.server.ts) `contentCheck` — `requireCanViewProject`,
`requireCanSolve`, `requireEditableDefinition`) get a small addition: _before_ running the normal
rule, if `ctx.apiScope` contains an `all-projects-admin` scope whose action covers the request
(`read` for view, `solve` for solve), the check passes without membership. This mirrors the existing
`managementBypassOrRun` pattern but is (i) driven by the token scope, not raw `instance_admin`, and
(ii) confined to read/solve. `write`/manage guards are untouched, so a blanket token still cannot edit.
Because the guard reads `ctx.platformPermissions` (built fresh each request from the live store), a
token whose creator lost `read_all_projects` fails the re-check and the scope is dropped at resolution.

## Phase 1 — Local provider implementation (`@selvajs/local-provider`)

- `packages/providers/local/src/data/LocalApiTokenStore.ts` — JSON-file store
  (`api-tokens.json` under `DATA_PATH`), copy `LocalInviteStore.ts` structure (atomic write via
  `fsJson.ts`, pagination helper). Lookup index by `tokenHash`.
- Wire it into `LocalDataProvider.fromEnv` and its `onUserDeleted` cascade
  ([packages/providers/local/src/data/LocalDataProvider.ts](packages/providers/local/src/data/LocalDataProvider.ts)).
- **Supabase provider**: add a matching `SupabaseApiTokenStore` + migration (RLS: a user sees only
  their own tokens; `getByTokenHash` runs as service-role/system). Keep it in the same PR set but it can
  trail local by a commit — the interface is the contract.

## Phase 2 — Token resolution in the hook

In [packages/selva/src/hooks.server.ts](packages/selva/src/hooks.server.ts) `handle`, add a branch
**before** the `admin_session` cookie read. **Not** gated on `isJsonApiRoute` — that helper matches
the whole `/api/` tree including the admin subtree, and admin endpoints must stay session-only.
Gate the PAT branch on `pathname.startsWith('/api/v1/')` exactly (the versioned surface from
[api-redesign-plan.md](../archive/api-redesign-plan.md)).

Note the api-redesign moves `/admin/api/*` → `/api/admin/*`. This does **not** loosen anything: the
PAT gate is a `/api/v1/` prefix test, and `/api/admin/` does not match it. The two scopes stay
separated by prefix, just under one `/api` root.

1. Read `Authorization: Bearer sk_…` (new `packages/selva/src/lib/server/apiTokens/resolve.server.ts`,
   modeled on [shareLinks/resolve.server.ts](packages/selva/src/lib/server/shareLinks/resolve.server.ts)
   and [token.server.ts](packages/selva/src/lib/server/shareLinks/token.server.ts)).
2. `looksLikeApiToken(raw)` prefix check → `hashToken(raw)` → `data.apiTokens.getByTokenHash(SYSTEM_CONTEXT, hash)`.
3. Reject expired/revoked (constant-time compare already inside codec). On hit:
   - `user = await auth.getUser(token.userId)` (identity still owned by the auth provider — token is not identity, it references one). If user gone/disabled → 401.
   - Fetch `permissions.getFor` + `orgs.findUserMembership` (same reads the session path does), `buildContext`, then **narrow** with the token's scopes → `locals.ctx`, `locals.user`.
   - Best-effort `touchLastUsed` (debounced).
4. No token / bad token on an `/api/*` route → fall through to the existing cookie path (so browser
   sessions on `/api/*` still work), and if that also misses → the existing 401 JSON.

**Page routes, `/api/admin/*`, and unversioned `/api/*` (health/diag/files) never accept PATs** —
only `/api/v1/*`. This keeps the browser attack surface unchanged and keeps instance administration
off the token path entirely.

## Phase 3 — Minting & management (routes + UI)

- **Gate minting** with the new permission. New guard `requireCanMintApiTokens(locals)` in
  [packages/selva/src/lib/server/access.server.ts](packages/selva/src/lib/server/access.server.ts)
  (403 unless `manage_api_tokens` or `instance_admin`). Admin grants the permission through the
  **existing** user-permission UI (`/api/admin/users/[id]` PATCH already sets platform permissions —
  the new values flow through the enum automatically). The admin UI does **not** pick up new enum
  values by itself: label/description maps are hardcoded in
  [UserListItem.svelte](packages/selva/src/routes/admin/users/UserListItem.svelte) (~lines 41–54) and
  [admin/users/+page.svelte](packages/selva/src/routes/admin/users/+page.svelte) (~lines 44–46) —
  add entries for `manage_api_tokens` and `read_all_projects` in both.
- **API** `packages/selva/src/routes/api/v1/tokens/` (self-service, gated by the mint permission):
  - `POST /api/v1/tokens` — mint: validate scopes ⊆ caller's live permissions, cap `expiresAt` to
    {30,90,180}d, return the **raw token exactly once**. Extra check: any scope with an
    `all-projects-admin` resource requires the caller to hold `read_all_projects` and forbids `write`
    (400/403 otherwise).
  - `GET /api/v1/tokens` — list caller's own tokens (hash never returned; show `prefixHint`, scopes, expiry, lastUsedAt).
  - `DELETE /api/v1/tokens/[id]` — revoke.
- **UI** `/settings/tokens` page (`packages/selva/src/routes/settings/tokens/`): list + "Generate token"
  form (name, expiry select, scope builder), one-time raw-token reveal with copy button. **Note: there is
  no `/settings` section yet** — this creates it (`routes/settings/+layout.svelte` + a nav entry; the
  deny-by-default route classifier already gates new authed pages, so no classifier change). Follow the
  admin page + form-action conventions. Dark-mode + mobile-first per house style. If the caller
  lacks `manage_api_tokens`, the page renders a "ask an admin to enable API tokens for your account" state.

## Phase 4 — Managed public REST API

**Superseded by [api-redesign-plan.md](../archive/api-redesign-plan.md).** The wrapper approach ("two URLs, one
implementation") is dropped: the API is redesigned once as a single versioned surface `/api/v1/*`
used by both the browser UI and PATs, with per-endpoint stability (`x-internal`) in the OpenAPI
spec. That plan owns the endpoint map, the missing read endpoints, the OpenAPI spec + conformance
test, and the `/docs/api` page. **Build order: api-redesign Phases A/B land before this plan's
Phase 2** so PATs launch against the final surface.

Still owned by THIS plan:

- **Rate limiting** — extend the existing limiter pattern in
  [admin-auth.server.ts](packages/selva/src/lib/server/admin-auth.server.ts) / the `/api/v1/compute`
  limiter to a per-token bucket.
- Bearer-auth + scope documentation contributed into `packages/selva/openapi/v1.yaml`.

## Phase 5 — PAT-driven clients: CLI first, then MCP

Both clients are the **same architecture**: a pure client of `/api/v1` authenticating with a Selva
PAT, holding no direct DB/provider access, inheriting every scope/permission guarantee for free.
The CLI ships first because it needs no generated tool schemas — it can be written against the v1
surface by hand as soon as Phases A/B land.

### 5a — CLI API mode (build once v1 reads exist)

`packages/cli` today is a deploy/scaffold tool that talks to Supabase directly and never to a
running Selva instance. This adds a second mode: `selva login --token sk_…` stores a PAT, and the
commands below are thin `/api/v1` calls.

| Command                           | Endpoint                                |
| --------------------------------- | --------------------------------------- |
| `selva projects list`             | `GET /api/v1/projects`                  |
| `selva definitions list`          | `GET /api/v1/definitions`               |
| `selva definitions get <guid>`    | `GET /api/v1/definitions/{guid}`        |
| `selva definitions schema <guid>` | `GET /api/v1/definitions/{guid}/schema` |
| `selva definitions upload <file>` | `POST /api/v1/definitions` (multipart)  |
| `selva solve <guid> --inputs …`   | `POST /api/v1/definitions/{guid}/solve` |

Notes that shape the CLI's behaviour:

- **A PAT never widens permissions.** `definitions list` shows what the minting user can already
  see, not the whole instance. Worth saying plainly in `--help` so the scoping isn't read as a bug.
- **No admin commands.** Instance administration is `/api/admin/*`, cookie-only and not
  PAT-reachable. Adding `selva admin …` later is a deliberate decision to widen token reach, not
  something to inherit by accident.
- `solve` sends an `Idempotency-Key` per invocation so a retried command doesn't double-charge
  compute (api-redesign Phase C).
- Paging is one helper over `{ items, nextCursor }` — uniform across every collection.

### 5b — MCP server (DESIGNED, DEFERRED — build after v1 API is stable)

A separate package `packages/mcp-server/` (Node MCP server) that is a **pure client of `/api/v1`** using a
Selva PAT — it holds no direct DB/provider access, so it inherits every scope/permission guarantee for free.

- **Auth**: operator supplies a Selva PAT (`SELVA_API_TOKEN=sk_…`) + base URL. All MCP tool calls carry it as `Authorization: Bearer`.
- **Tools** (map 1:1 to v1 endpoints, gated by the token's scopes so an LLM literally cannot exceed them):
  `list_projects`, `get_definition`, `list_definitions`, `solve_definition` (the big one — run a GH definition
  with inputs, return outputs), `list_versions`, `read_schema` (→ `GET /definitions/{guid}/schema`,
  added in api-redesign Phase B — an LLM needs a definition's inputs before it can solve it). Write
  tools (`create_definition`, `publish_version`) only if the token carries `write`.
- **Transport**: stdio for local (Claude Desktop / Claude Code), optional HTTP/SSE for hosted.
- **Why deferred**: the tool schemas should be generated from the frozen OpenAPI v1 spec (Phase 4). Building
  MCP against a moving `/api/*` means reworking tool schemas on every internal change. Ship v1 first, then MCP is mechanical.
- Deliverable now: this design section + an ADR under `docs/adr/` recording the "MCP = thin PAT-scoped v1 client" decision so the API is designed to be MCP-consumable from day one (cursor pagination, stable IDs, machine-readable errors — all already true).

---

## Files to create / modify (representative)

**Create**

- `packages/platform/src/apiTokens/{types,scopes,interface,index}.ts`
- `packages/providers/local/src/data/LocalApiTokenStore.ts`
- `packages/providers/supabase/src/data/SupabaseApiTokenStore.ts` (+ migration)
- `packages/selva/src/lib/server/apiTokens/{resolve,token}.server.ts`
- `packages/selva/src/routes/api/v1/tokens/+server.ts`, `.../tokens/[id]/+server.ts`
- `packages/selva/src/routes/settings/tokens/+page.{svelte,server.ts}` (+ new `settings/+layout.svelte` — section doesn't exist yet)
- (v1 namespace + `packages/selva/openapi/v1.yaml` come from [api-redesign-plan.md](../archive/api-redesign-plan.md))
- `packages/cli/src/api/` — PAT-authenticated v1 client + credential store (Phase 5a); the existing
  CLI has no HTTP client for a running Selva instance, only direct Supabase calls
- `docs/adr/00xx-api-tokens-and-mcp.md`
- Conformance/unit tests per store (mirror `packages/providers/local/src/**/__tests__/`)

**Modify**

- `packages/platform/src/data/interface.ts` (+`apiTokens`, cascade), `.../permissions/types.ts` (+`manage_api_tokens`, +`read_all_projects`), `.../context.ts` (+`apiScope`, `scopeAllows`), `.../index.ts` (barrel exports)
- `packages/providers/local/src/data/LocalDataProvider.ts` (wire store + cascade)
- `packages/selva/src/hooks.server.ts` (PAT branch before cookie path)
- `packages/selva/src/lib/server/access.server.ts` (`requireCanMintApiTokens`; `scopeAllows` in guards; `all-projects-admin` read/solve bypass added to the three `contentCheck` guards — view/solve/def-edit — for read+solve only)
- Admin user-permission UI — add label/description entries for both new permissions in `UserListItem.svelte` and `admin/users/+page.svelte` (hardcoded maps; new enum values don't render automatically)

---

## Verification (end-to-end)

1. **Unit/conformance**: `pnpm test` — new store passes a conformance suite modeled on the invite/auth ones; `narrowApiTokenContext` and `scopeAllows` get direct tests (a `read`-only token must fail `canEdit`; a `project:A` token must fail on project B; an `all-projects-admin` `read`+`solve` token must **pass** view/solve on a non-member project but still **fail** edit; minting `all-projects-admin` without `read_all_projects`, or with `write`, must be rejected; a token whose creator later lost `read_all_projects` must fail the blanket read).
2. **Type/lint**: `pnpm type-check && pnpm lint` across the workspace (touches platform + providers + selva).
3. **Live PAT flow** (dev): start `pnpm dev:selva`; as an admin, grant `manage_api_tokens` to a test user; as that user mint a `read`-only, `project:<id>`-scoped token at `/settings/tokens`; then:
   - `curl -H "Authorization: Bearer sk_…" localhost:5173/api/v1/projects` → 200, only that project visible.
   - Same token `POST`ing an edit → 403 (`FORBIDDEN`).
   - Expired/revoked token → 401 (`UNAUTHORIZED`).
   - A user **without** `manage_api_tokens` hitting `POST /api/v1/tokens` → 403; their `/settings/tokens` shows the "ask an admin" state.
4. **Isolation regression**: confirm session-cookie browser auth on `/api/v1/*` still works (PAT branch falls through cleanly) and that `/api/admin/*` rejects bearer tokens — including with a token whose creator holds `instance_admin`, since the prefix gate must not care about permissions.
5. **Docs**: OpenAPI spec validates; `/docs/api` renders.
6. MCP: N/A this phase (design + ADR only).

## Open questions deferred to build time (non-blocking)

- Exact expiry cap set — locked to 30/90/180d per your ask; add "no expiry" only if you later want it (not recommended for LLM tokens).
- Supabase RLS policy wording for `api_tokens` (service-role read on `getByTokenHash`).
- Whether `solve` counts against per-token or per-org compute rate limits (lean per-token).
