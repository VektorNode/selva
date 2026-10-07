# API tokens

**Tracked in [#97](https://github.com/VektorNode/selva/issues/97).** Decided on the wayfinder map
[#312](https://github.com/VektorNode/selva/issues/312); each decision below links the ticket that
holds its full reasoning.

API tokens let a script, an integration, or a host app call `/api/v1` as a user, without a browser
session. Everything here ships in `@selvajs/*` packages so a host app with its own hook (not just
the Selva app) can mint, resolve and enforce them. Terms (**API token**, **scope**, **host app**,
**delegated session**, **service account**) are defined in [CONTEXT.md](../../CONTEXT.md).

## How a request flows

1. The host hook sees `Authorization: Bearer selva_…` and calls `resolveApiToken` **before** the
   cookie path.
2. The resolver checks the checksum, hashes the key, loads the row, and rejects unknown, expired or
   revoked keys.
3. It rebuilds the owner's live context in the token's org with `buildRequestContext`, then
   narrows it to the token's scopes. Narrowing only removes rights.
4. On Supabase it signs a 60 s delegated-session JWT for the owner into
   `ctx.adapterContext.sessionToken`, so row security applies as if the owner were logged in.
5. `runHandler` applies the scope check (from the HTTP method or the route's declared `action`), the
   per-token rate limit, and opt-in idempotency, then runs the handler.

## Decisions

### Token model

- **Format: `selva_` + base62 random + CRC32 checksum.** A distinctive prefix lets secret scanners
  match it, and the checksum rejects typos before a DB lookup. `sk_` was dropped because Stripe and
  OpenAI keys share it. Hashed at rest by `createTokenCodec` with `SELVA_HMAC_KEY`; the raw value is
  shown once. ([#323](https://github.com/VektorNode/selva/issues/323))
- **One org per token, fixed at mint.** A user in two orgs can't reach the wrong one by accident,
  and the org roster is exact. ([#317](https://github.com/VektorNode/selva/issues/317))
- **`userId` (acts as) and `createdBy` (minted by) are separate fields.** They're equal in v1. A
  future service account is a user row that can't log in, so the owner stays a plain user id and
  every FK, RLS policy and delegated session works unchanged. A separate principal type was rejected:
  every store and policy would have to learn it. ([#317](https://github.com/VektorNode/selva/issues/317))
- **Expiry is required: 30, 90 or 180 days.** The mint form defaults to `read`, whole org, 30 days;
  `write` and `solve` are opt-in with a warning. ([#323](https://github.com/VektorNode/selva/issues/323))
- **Minting needs `manage_api_tokens`** (platform permission) and can never exceed the creator's live
  rights.

### Scopes and enforcement

- **Actions are only `read`, `write`, `solve`; `write` and `solve` include `read`.** A host app maps
  its own scopes onto these three and accepts the cost: it can't grant writes on one of its resources
  without the others. Host-registered actions were rejected as more engine surface than anything
  needs today. Scopes are stored as strings, so they can be added later without migrating keys.
  ([#315](https://github.com/VektorNode/selva/issues/315))
- **Resources: `all`, `org`, `project`, `definition`.** `scopeAllows(ctx, action, resource?)` with
  no resource is an org-level check, and only `all` or org-scoped keys pass it. A project key is
  refused on a host app's org-level routes such as orders.
- **`runHandler` checks scope automatically.** `GET`/`HEAD` mean `read`, everything else `write`, and
  a handler can declare `action` (solve routes declare `solve`). Per-handler calls were rejected:
  a forgotten call silently lets a read-only key write. A host that bypasses `runHandler` must call
  `scopeAllows` itself.
- **Requests without a token always pass `scopeAllows`.** Browser sessions are unaffected.

### Resolution

- **`resolveApiToken(request, deps, { pathPrefix = '/api/v1/' })`** returns `none`, `ok` or
  `rejected`. ([#316](https://github.com/VektorNode/selva/issues/316))
- **A sent `selva_` key never falls back to the cookie.** A bad key gets 401 even if a valid session
  cookie rides along, and a key outside `pathPrefix` (such as `/api/admin/*`) is rejected, not
  ignored. The previous version of this plan fell through to the cookie; that ran the request as
  someone else and hid the broken key.
- **Keys go in the header only.** A key in a query string gets 400, because URLs leak into logs and
  history.
- **`buildContext` moves from the app hook into `@selvajs/server/http`** as `buildRequestContext`,
  with an option to pin the org. The cookie path, the token path and every host app share one copy;
  two would drift silently.

### Delegated sessions (Supabase)

The Supabase stores scope every query by the user JWT, and a token request has none.
([#313](https://github.com/VektorNode/selva/issues/313), [#314](https://github.com/VektorNode/selva/issues/314),
[#322](https://github.com/VektorNode/selva/issues/322))

- **Selva signs a short-lived JWT for the owner** through an optional auth-provider capability,
  `delegatedSession.mint(userId, { readOrg? })`. Claims are hardcoded: `sub`, `role` and `aud` both
  `authenticated`, `iat`, `exp`, and never `session_id`. Without `aud`, GoTrue's `getUser` returns 400.
  - Only the Supabase provider implements it; local and header have no RLS.
  - Minted JWTs never go through `verifyToken`.
- **60 s, signed per request, no cache.** Signing costs microseconds. The resolver re-checks the user
  (disabled, membership, live permissions) before every signature. That matters because PostgREST
  doesn't check bans: a live test showed a banned user's valid JWT still read their rows.
- **Signing keys.**
  - `SUPABASE_JWT_SIGNING_KEY` is an ES256 private JWK that the project trusts. On hosted Supabase,
    that means importing it and rotating to it, which makes it the key for every session.
  - `SUPABASE_JWT_SECRET` is the legacy HS256 fallback, mainly so the local dev stack works. It stops
    working when the operator revokes the legacy secret.
  - The key can mint `service_role` (verified live), so it gets the service key's handling:
    server-only, redacted from logs, and covered in the operator's rotation runbook.
- **A bad key turns tokens off, not the app.** At startup Selva checks that the key's `kid` is in the
  project JWKS (for HS256, it signs a probe and checks Supabase accepts it). If the check fails:
  - token requests get 503 `API_TOKENS_UNAVAILABLE`;
  - minting is blocked;
  - the admin health page shows the error.

  Browser logins keep working.

- **Rejected alternatives.** A service-role client with an org filter in each store would drop the
  RLS floor for every table. Validating the token inside Postgres would mean rewriting every policy
  and checking the token on every query. Findings and the live test are in
  [research/supabase-delegated-jwt.md](../research/supabase-delegated-jwt.md).

### Read every project in the org

([#320](https://github.com/VektorNode/selva/issues/320))

- **The org permission `read_all_org_projects`, granted by org admins,** lets its holder mint a
  read + solve key covering every project in the token's org, including projects they aren't a
  member of. It replaces the earlier instance-wide `read_all_projects`, which would have broken the
  one-org rule.
- **Content only: projects, definitions, versions, solves.** Member lists stay member-only because
  they're personal data. The key is never allowed to write.
- **The permission is re-checked live at resolution,** so withdrawing it neuters existing keys.
- **On Supabase the delegated JWT carries `selva_read_org: <orgId>`,** honoured only by the SELECT
  policies on `projects`, `definitions` and `definition_versions`. Write policies never read it, so
  the database itself rules out writes.
- **App-side, the `contentCheck` view and solve guards accept the scope; edit guards don't.** The
  local provider relies on these guards alone.

### Rate limiting

([#318](https://github.com/VektorNode/selva/issues/318))

- **Two layers.** A general per-token limit covers every request. Solves also charge the owner's
  existing `user:{id}` compute bucket, so ten keys never buy ten times the compute.
- **The limiter lives in `runHandler`.** It's process-local and fixed-window, behind an interface a
  host app can swap for a shared store. Limits are instance-wide env defaults, with no per-key
  limits.
- **429 `RATE_LIMITED` with `Retry-After`,** plus `RateLimit-Limit` and `RateLimit-Remaining` on
  every token response.
- **`ApiErrorCode` merges into `@selvajs/server`;** the app's duplicate copy goes.

### Idempotency

([#319](https://github.com/VektorNode/selva/issues/319))

- **Opt-in per handler** (`idempotent: true`). What's safe to replay differs per route.
- **Keys are namespaced per token,** so two integrations never share replays.
- **Reusing a key with a different body gets 422,** by fingerprinting method, path and body.
- **The store stays in-memory and absorbs in-flight retries.** For creates that must never duplicate,
  the host stores the key on the created row under a unique constraint in the same transaction. A
  separate durable idempotency table was rejected: a crash between it and the insert still
  duplicates.
- **Selva's own creates opt in:** solve, project, definition, version, share link.

### Lifecycle, audit and privacy

([#321](https://github.com/VektorNode/selva/issues/321), [#325](https://github.com/VektorNode/selva/issues/325))

- **Removing a member revokes their keys for that org;** disabling a user revokes theirs. Re-adding
  someone doesn't revive old keys. The previous version kept keys alive and relied on manual roster
  cleanup. With live membership checks those keys were dead anyway, and keeping them only invited
  silent resurrection.
- **Erasing the owner deletes their keys** (`userId` cascade); `createdBy` is set null.
- **Revoked and expired rows stay, marked,** so a `tokenId` in the audit log still resolves to a name.
- **Audit events carry ids only:** `api_token.created` and `api_token.revoked` (reason `owner`,
  `admin`, `member_removed` or `user_disabled`). The key's name stays out because people write
  things like "Felix laptop". There are no expiry or per-use events. Every audit event written
  during a token request carries the token's id, so a key's actions differ from the same person's
  browser actions.
- **No IP is stored.** `lastUsedAt` is written fire-and-forget at most every 5 minutes. Refusal
  counts stay in memory.
- **Logs carry `tokenId` only.** The raw key, the `Authorization` header and the delegated JWT are on
  the pino redaction list.

### Making mistakes visible

([#323](https://github.com/VektorNode/selva/issues/323))

- **Emails go out on mint and 3 days before expiry,** when the server has mail configured.
- **The token page shows** scopes in plain words, last used, expiry, and badges: expiring soon,
  unused for 30 days, refused N times today. Org admins see the whole roster and can revoke any key.
- **Refusals are logged and badged, never auto-revoked.** A burst is usually a misconfigured
  integration.
- **403 bodies name the missing scope** (`details.requiredScope`) unless access is deliberately
  concealed as 404.

### Endpoints

([#324](https://github.com/VektorNode/selva/issues/324))

| Method | Path                                    | Notes                                                                     |
| ------ | --------------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/api/v1/orgs/{orgId}/tokens`           | Returns `{ token, secret }` once, with `Cache-Control: no-store`          |
| GET    | `/api/v1/orgs/{orgId}/tokens`           | Own tokens; `?all=true` returns the roster and needs `manage_org_members` |
| DELETE | `/api/v1/orgs/{orgId}/tokens/{tokenId}` | Owner or org admin; returns 204                                           |

These endpoints are session-only, so a key can't manage keys and a leaked one can't spawn more. They
are `x-internal` for v1.

## Where it lives

| Package                    | Holds                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@selvajs/platform`        | `ApiToken`, `IApiTokenStore` (+ `apiTokens` on `IDataProvider`), `scopeAllows`, `narrowApiTokenContext`, `manage_api_tokens`, `read_all_org_projects`, `api_token.*` events, `IDelegatedSession` |
| `@selvajs/server/http`     | `resolveApiToken`, `buildRequestContext`                                                                                                                                                         |
| `@selvajs/server/handlers` | `createApiToken`, `listApiTokens`, `revokeApiToken`                                                                                                                                              |
| `@selvajs/server/api`      | `runHandler` `action`/`idempotent`, scope check, rate limiter, idempotency (moved from `/compute`)                                                                                               |
| Supabase provider          | Token store, `delegatedSession`, migration (`api_tokens`, `audit_events.token_id`, `jwt_reads_org`, SELECT policies)                                                                             |
| Local provider             | JSON-file token store                                                                                                                                                                            |
| `packages/selva`           | Hook wiring, mounted routes, `/settings/tokens` as the reference host page                                                                                                                       |

Reuse rather than reinvent: the token codec (`packages/server/src/tokens/token-codec.ts`), the
invite store as the store template, and the share-link org roster (`/team/shares` and its RLS
migration) as the template for the token roster.

## Invariants the tests must pin

- A `read` key fails a `POST`; a `project:A` key fails on project B and on any org-level host route.
- A read-every-project key reads and solves a non-member project in its org, can't edit it, can't
  see its members, and can't reach another org. It stops working once its owner loses
  `read_all_org_projects`.
- A bad key plus a valid cookie gets 401, and `/api/admin/*` rejects every key, including an
  instance admin's.
- A banned or removed owner's key fails before any JWT is signed.
- A misconfigured signing key gives 503 `API_TOKENS_UNAVAILABLE` while browser logins work.
- The raw key and the delegated JWT never appear in logs.

## Out of scope

- **The CLI's `selva login`:** [#215](https://github.com/VektorNode/selva/issues/215). It will be a
  plain `/api/v1` client with no admin commands, because instance administration stays
  cookie-only.
- **The MCP server:** [#216](https://github.com/VektorNode/selva/issues/216). It will be a thin
  client of `/api/v1` whose tool schemas are generated from the frozen spec, deferred until that
  spec is stable. OAuth 2.1 for a remote MCP connector comes later, and should resolve to the same
  principal and scopes.
- **Building service accounts.** Only the door is kept open.
- **A host app's own routes, hook, token page and spec.**
