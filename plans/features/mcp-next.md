# MCP: transport, tool surface, protocol, OAuth, evals, apps

**Tracked in: unfiled.**

This builds on the [MCP package plan](../archive/mcp-package.md). The spec and client requirements behind
every step are in [mcp-best-practices.md](../research/mcp-best-practices.md); this file says how
Selva meets them and in what order.

Six steps, each shippable on its own. The first three are small and make today's header-key
clients more correct. Step 4 opens Selva to hosted clients. Steps 5 and 6 make it good rather than
just reachable. Evals (step 5) have no dependency, and starting them before step 2 would give its
changes a baseline.

## 1. Transport hardening (`packages/mcp`)

- **`Origin` check in `handle`.** A request whose `Origin` header is present and is neither the
  host's own origin nor in a new `allowedOrigins` option gets 403 with a JSON-RPC error and no
  `id`. Native clients send no `Origin`, so they're unaffected. Selva reads `allowedOrigins` from
  a `MCP_ALLOWED_ORIGINS` env var, documented in `.env.example`.
  _Verify:_ whether claude.ai's backend sends `Origin` on its requests. If it does, it goes in the
  default list, not in every operator's env.
- **Unknown tool is a protocol error.** Throw `McpError(ErrorCode.InvalidParams)` instead of
  returning `isError`, as the spec splits them.
- **GET and DELETE answer 405.** SvelteKit already does this for a route with only `POST`. Pin it
  with a route test so a later `GET` handler can't quietly change it.

## 2. Tool surface

- **Hide tools a key can't use.** The spec lets `tools/list` vary by the presented credential.
  - `GET /api/v1/me` gains `apiToken: { scopes }` when the caller is a token. That's an OpenAPI
    and conformance change in `@selvajs/server`.
  - The engine already knows each tool's required actions from its calls' `x-scope`. It gets a
    host hook, `grantedActions(api)`, and filters both `tools/list` and `tools/call` by it.
  - A read-only key no longer sees `selva_solve`.
  - A call to a hidden tool returns HTTP 403 with
    `WWW-Authenticate: Bearer error="insufficient_scope", scope="read solve"`. That's the step-up
    signal OAuth clients act on in step 4.
  - The filter is by action only. A project-scoped `solve` key still sees `selva_solve`, and
    `/api/v1` refuses projects outside its scope as it does today.
- **Declare `outputSchema`.**
  - `ToolDefinition` gains `output?: ZodType | JsonSchema`, and the engine checks
    `structuredContent` against it in tests.
  - The list tools return `{ items, nextCursor? }`.
  - Solve returns `{ outputs, errors, warnings, link, response? }`, with `outputs` as an open
    record, since it's per definition.
  - Once declared, the spec requires every result to conform. The schema is a contract, so it
    stays as loose as the real shape.
- **Cap the solve summary.**
  - A scalar tree longer than a fixed item count shows the head, the total and how to get the
    rest (`detail: 'full'`). The text as a whole goes through the existing `truncate`.
  - Structured output gets the same cap unless `detail` is `full`. Claude Code cuts at 25k
    tokens, and a silent cut is worse than a stated one.
- **Address definitions by name.**
  - `selva_describe_definition` and `selva_solve` take `definition`: a guid or a display name.
  - A name is resolved by paging `getDefinitions`, with a bounded number of pages, and matching
    case-insensitively. An ambiguous name returns the candidates with their guids.
  - This saves the list call in the common "solve the shelf with width 40" case without adding
    search to `/api/v1`. That needs a store-level filter in both providers and is its own change
    if agents turn out to need it.

## 3. SDK v2 and protocol `2026-07-28`

- **Spike first.** Confirm that `@modelcontextprotocol/server` v2 still exposes a low-level
  `Server` with `setRequestHandler`, which the engine is built on. If it doesn't, port
  `server.ts` to `McpServer.registerTool` with raw JSON Schema inputs. The tool, client, spec and
  output modules don't change either way.
- **Swap the dependency** through a `catalog:` entry in `pnpm-workspace.yaml`. `handle` becomes
  `createMcpHandler(() => build(apiKey, fetch), { legacy: 'stateless' })`, so 2025-era clients
  keep working. `listen` becomes `serveStdio`.
- **Cache hints.** `tools/list` gets `cacheScope: 'private'`, because it varies by key after
  step 2, and a few minutes' `ttlMs`. Tools only change on deploy.
- **Cancellation.** Closing the response stream now cancels the request. `extra.signal` already
  flows into `api.call` and on to the solve `fetch`. Verify that an aborted request stops the
  Compute call rather than finishing it unobserved.
- **Re-issued solves.** A dropped stream comes back as a new request, so `api.call` mints a new
  `Idempotency-Key` and the solve runs again. The solve cache absorbs identical inputs, except on
  a definition with `solveCacheLimit: 0`. Deriving the key from a hash of the token, tool and
  arguments would replay instead. Two deliberate identical solves would then share one result,
  which a deterministic solve gives anyway. Decide during the step; it's one line in `client.ts`.
- **Check with MCP Inspector** against both protocol eras before merging.

## 4. OAuth: Selva as its own authorization server

The access token is a `selva_` API token, minted through the same core as
`POST /orgs/{orgId}/tokens`. `/mcp` and `/api/v1` keep one credential type, and `handle` doesn't
change. The token's principal, org, scopes, audit trail and revocation at Team → API tokens
all come for free. The core lives in `@selvajs/server` so host apps get the same flow; Selva's
routes only parse, guard and delegate.

**Routes**

| Path                                                            | Does                                                                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `/.well-known/oauth-protected-resource/mcp` (and the bare form) | Protected Resource Metadata: `resource` is `<origin>/mcp`, one `authorization_servers` entry (the origin) |
| `/.well-known/oauth-authorization-server`                       | RFC 8414 metadata, below                                                                                  |
| `/oauth/register`                                               | DCR (deprecated by the spec, still Claude's fallback and most clients' only path)                         |
| `/oauth/authorize`                                              | Consent page (GET) and approval (form action)                                                             |
| `/oauth/token`                                                  | Code exchange, `application/x-www-form-urlencoded`                                                        |

The metadata advertises:

- `code_challenge_methods_supported: ["S256"]`
- `client_id_metadata_document_supported: true`
- `token_endpoint_auth_methods_supported: ["none"]`
- `authorization_response_iss_parameter_supported: true`
- `scopes_supported: ["read", "solve", "upload"]`; only the built-in Grasshopper client is ever
  granted `upload` ([publish-from-plugin.md](../archive/publish-from-plugin.md)), so the `/mcp`
  resource metadata lists `read` and `solve` alone

Claude picks CIMD only when both the second and third are present.

`/mcp`'s 401 gains `resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"` and
`scope="read solve"`. The well-known paths, `/oauth/register` and `/oauth/token` join
`publicApis` in the route classifier. `/oauth` joins `FRAME_DENIED_PREFIXES`.

**No new stores.** Clients and codes are signed blobs (HMAC with `SELVA_HMAC_KEY`), so neither
provider needs a migration.

- **DCR client.** `client_id` is `dcr_` plus a signed payload of `redirect_uris`, `client_name`
  and issue time. Claude registers on every connection, which costs nothing here.
- **CIMD client.** `client_id` is an HTTPS URL. Fetch it through the SSRF guard in
  `@selvajs/server/compute/safe-url.ts`, generalised from remote definitions to any public URL.
  Use a short timeout and a small size cap, and cache by URL. The document's `client_id` must
  equal the URL.
- **Redirect URIs** match exactly, except loopback (`localhost` and `127.0.0.1`), which matches
  on any port, for Claude Code.
- **Authorization code.** A signed payload of user, org, scopes, client, redirect URI, PKCE
  challenge and `resource`, valid for 60 seconds. It's single-use through an in-memory replay
  set. On several replicas, a code could be redeemed once per replica within that minute, and
  only by whoever holds the PKCE verifier. The idempotency store already accepts the same
  per-process limit.

**Consent (`/oauth/authorize`)**

- Without a session, it redirects to `/login?redirectTo=…` (`safeRedirectTarget` already exists).
- The page shows the client name and the redirect URI's host, with a warning when the only
  redirects are loopback. It also has an org picker when the user has several, and the access
  choice: Read, or Read and run solves, preselected from the requested scope.
- Approval goes through a SvelteKit form action, whose origin check is the CSRF protection.
  `state` is passed through untouched; the client owns it.
- The response carries `code`, `state` and `iss`.

**Token exchange (`/oauth/token`)**

- Check the PKCE verifier, client, redirect URI, and that `resource` names this instance.
- Mint the token through the shared core, so the holder policy (`mayHoldApiTokens`) and the
  audit event apply. Name it `<client_name> (OAuth)` and give it scopes `read:all` or
  `solve:all`.
- Return `access_token`, `token_type`, `expires_in` and `scope`.
- Answer well under Claude's 10-second limit, and rate-limit by IP, as login does.

**Refresh tokens: not in the first cut.** Access tokens live 30 days. Expiry or revocation gives a
401 and the client signs in again. The spec leaves refresh to the authorization server. Supporting
it means storing a rotating secret per grant, which is a store change in both providers. Add it if
monthly re-consent turns out to annoy people.
_Verify:_ that Claude re-runs sign-in on a 401 when it holds no refresh token.

**CSRF.** SvelteKit's form-CSRF check refuses a form-encoded POST without a matching `Origin`,
which is every server-to-server token request. It can trust origins but not exempt a path, so it
is off in `svelte.config.js`, and the hook runs the same check with two exemptions: the token
endpoint, and any request carrying `Authorization`, which a cross-site form can't set.

**Header-auth deployments.** The proxy's forward-auth must let these through unauthenticated:

- `/.well-known/oauth-*`, `/oauth/register` and `/oauth/token`, which Claude's backend calls
  server-to-server;
- `/mcp`, which already carries its own key.

`/oauth/authorize` stays behind it, so login works as usual. This goes into
[reverse-proxy.md](../../docs/self-hosting/deployment/reverse-proxy.md) and the Caddy example.

**Docs.** [mcp.md](../../docs/self-hosting/concepts/mcp.md) loses "a key header is the only way
in" and gains: connecting from claude.ai by URL, what the consent page grants, and where the
resulting token shows up.

## 5. Evals

Anthropic ranks evals first, and every step above is a guess without them.

- **Where.** A script under `packages/mcp/evals/`, run by hand against a local instance
  (`pnpm dev:local`) seeded with the definitions in `fixtures/grasshopper/`. Not in CI: it needs
  Rhino.Compute and spends API credit.
- **Tasks.** Fifteen to twenty prompts a Selva user would actually type, each needing several
  calls ("Which bracket thickness keeps the flat pattern under 300 mm?"). Each has a verifiable
  outcome: a number within tolerance, or an LLM judge for prose. A held-out third isn't looked at
  while tuning.
- **Loop.** A plain agent loop over the Claude API with interleaved thinking, the MCP server's
  tools, and the user's own key.
- **Recorded per task:** success, tool calls, tokens, invalid-argument errors, wall time. Many
  calls point at missing lookups; many argument errors point at descriptions.

## 6. MCP Apps: the viewer in the chat

The largest step, and the only one that changes what a user sees. It gets a design spike before
it gets a plan.

- **Shape.** `selva_solve` declares `_meta.ui.resourceUri: "ui://selva/viewer"`. The resource is
  one self-contained HTML file bundling `@selvajs/visualization` and `three`, and it receives the
  tool result over the Apps bridge.
- **Hard part: geometry delivery.**
  - The display batch is megabytes, and the tool result also goes to the model, so it can't
    travel in `structuredContent`.
  - The likely answer: the result carries a short-lived signed URL, like the solve-events token.
    The app fetches the batch from Selva, whose origin is allowed in the app's declared CSP.
  - That needs the batch kept briefly after a solve, which nothing does today.
- **Open:** where the batch is kept and for how long; whether the bundle size is acceptable to
  hosts; and whether the app may re-solve when a user moves a slider, which would spend compute
  without the model in the loop.

## Rejected

- **Supabase's OAuth server.** It ties MCP to one provider and adds a second credential that
  `/api/v1` would have to accept.
- **Stored OAuth clients and codes.** That's a migration in every provider for data that signed
  blobs carry fine.
- **The Tasks extension for solves.** No client implements it yet. Revisit with a public async
  solve.
- **Recommending claude.ai's `static_headers`.** It sends one user's key for a whole
  organization, so every member acts as that user.
