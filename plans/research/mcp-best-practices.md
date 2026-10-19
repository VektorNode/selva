# MCP best practices, checked against Selva's `/mcp`

**Feeds the [MCP package plan](../features/mcp-package.md).** Read 2026-10-19 from the MCP
specification (revision `2026-07-28`), the TypeScript SDK v2 docs, Claude's connector docs and
Anthropic's tool-design guidance. Sources are at the end.

## Answer

The tool layer already follows most of the guidance: few targeted tools, errors as tool results
with a next step, honest annotations, bounded output, a `detail` switch. What's missing is around
it:

1. **`Origin` validation**, a transport MUST that `/mcp` skips.
2. **OAuth**, which every hosted client except Claude Code's header mode needs.
3. **The `2026-07-28` protocol**, which `@modelcontextprotocol/sdk` 1.30.1 doesn't speak.
4. **Evals**, which Anthropic puts first and Selva has none of.
5. **MCP Apps**, the one way to show geometry in the chat instead of a link.

## What changed in `2026-07-28`

- **Stateless core.** There's no `initialize` handshake and no `Mcp-Session-Id`. Each request
  carries its protocol version, client info and capabilities in `_meta`. Servers MUST answer a
  new `server/discover`. Cross-call state goes in server-minted handles passed as tool arguments.
- **Routing headers.** Every POST MUST carry `MCP-Protocol-Version` and `Mcp-Method`, plus
  `Mcp-Name` for `tools/call`. A server MUST reject a header that disagrees with the body with
  400 and `-32020`.
- **No GET stream, no resumability.** `subscriptions/listen` replaces the GET endpoint. When a
  response stream breaks, the client re-issues the request under a new id, and closing the stream
  counts as cancellation.
- **Cacheable lists.** `tools/list` and the other list methods carry `ttlMs` and `cacheScope`,
  and SHOULD return tools in a deterministic order.
- **Server-to-client requests become MRTR.** A tool that needs input returns
  `resultType: "input_required"`, and the client retries with `inputResponses`.
- **Deprecated.** Roots, Sampling, Logging, the HTTP+SSE transport, and Dynamic Client
  Registration (in favour of Client ID Metadata Documents).
- **Tasks moved to an extension**, `io.modelcontextprotocol/tasks`, with polled `tasks/get`.
  The extension matrix lists no client that supports it yet.
- **Schemas.** `inputSchema` and `outputSchema` accept any JSON Schema 2020-12 keyword, and
  `structuredContent` may be any JSON value.

**SDK.** v2 splits into `@modelcontextprotocol/server` and friends. `createMcpHandler(factory)` is
a web-standard `fetch` handler that serves `2026-07-28` and, by default, 2025-era clients
statelessly (`legacy: 'stateless'`). It validates the routing headers and emits cache hints
(default `ttlMs: 0`, `private`). A hand-built `Server` keeps speaking 2025-era protocol, which is
what `packages/mcp` does today.

## Transport security

- Servers **MUST** validate `Origin` on every request and answer 403 when it's present and
  invalid. The threat is DNS rebinding. `/mcp` doesn't check it. The bearer key makes rebinding
  useless today, but OAuth adds a browser-facing consent flow, and the check is a few lines.
- The MCP server **MUST NOT** accept tokens issued for another resource. Forwarding the caller's
  key to `/api/v1` doesn't count as token passthrough, because `/mcp` and `/api/v1` are one
  resource server with one token issuer. That only holds while `/mcp` refuses anything that isn't
  a `selva_` token, which `handle` does.
- Tool servers **MUST** validate inputs, enforce access control, rate-limit and sanitize outputs.
  `/api/v1` does the first three. Redacting the key covers the fourth.

## Authorization

Selva is its own authorization server, on every provider (see the plan's "Open" section). The
spec and Claude's client together require:

**On `/mcp` (resource server)**

- A 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`.
  Claude only starts sign-in on a 401. It ignores the header on a 200.
- Protected Resource Metadata (RFC 9728), where `resource` equals the URL the user typed,
  including `/mcp`. Claude uses only the first entry in `authorization_servers`.
- `scope` in the 401 challenge, kept minimal: `read solve`. A 403 for a missing scope SHOULD carry
  `error="insufficient_scope"` and the scope, so clients can step up. Today's 403 says it in the
  tool result text instead, because `api.call` sees it, not the transport.
- Scope hierarchy is the server's job. Selva's rule that any action covers `read` already does it.

**On the authorization server**

- RFC 8414 metadata, PKCE `S256` advertised in `code_challenge_methods_supported`, and `iss` in
  the authorization response with `authorization_response_iss_parameter_supported: true`.
- **Client ID Metadata Documents.** Advertise `client_id_metadata_document_supported: true` and
  `"none"` in `token_endpoint_auth_methods_supported`. Without both, Claude falls back to DCR.
  Fetching a client's metadata URL is SSRF-shaped: block private ranges and use a short timeout.
- **DCR** is deprecated, but it's still Claude's fallback and what most other clients do today.
  Under DCR, Claude registers a fresh client on every connection, so registrations must be cheap
  and expire.
- **Redirect URIs.** Accept `https://claude.ai/api/mcp/auth_callback`, plus loopback
  `http://localhost/callback` and `http://127.0.0.1/callback` matched on any port, for Claude
  Code.
- **The `resource` parameter** (RFC 8707) arrives on both the authorize and token requests.
  Record it on the minted token so its audience is the instance.
- **Token endpoint.** Accept `application/x-www-form-urlencoded`, answer within 10 s (30 s for a
  refresh), and send `invalid_grant` for a dead refresh token. Rotate refresh tokens for public
  clients.
- **Consent page.** Name the client and show the redirect URI's host, warning when it's loopback
  only. Use CSRF-protected `state` that is single-use and short-lived. Set
  `frame-ancestors 'none'`.

**Claude's other mode.** `static_headers` (beta, Owner-entered) sends one key for a whole claude.ai
organization. A Selva key belongs to one user, so every member would act as that user. The docs
should say so if Selva recommends it.

## Tool design

Anthropic's guidance, and where Selva stands:

| Guidance                                                                                        | Selva                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Few tools for real workflows, not one per endpoint                                              | Four tools; solve fetches its own schema. Good                                                                                            |
| Namespaced names                                                                                | `selva_*`. Good                                                                                                                           |
| Natural-language identifiers over UUIDs                                                         | Inputs accept label, nickname or id. Definitions need a `guid`, so the model must list first. A name-or-search lookup would save the call |
| `response_format` concise or detailed                                                           | `detail: 'summary' \| 'full'` on solve only                                                                                               |
| Cap responses (Claude Code truncates at 25k tokens) and say how to narrow                       | Lists page. Solve summaries aren't capped: a tree of 10k scalars goes out whole                                                           |
| Actionable errors with a correct example                                                        | Unknown input names the real ones; 403 names the scope. Good                                                                              |
| `outputSchema` when the shape is fixed                                                          | None declared. The list tools and the solve envelope are fixed                                                                            |
| Unknown tool is a protocol error (`-32602`), not `isError`                                      | Returns `isError`                                                                                                                         |
| `tools/list` may vary by the caller's authorization                                             | Lists `selva_solve` to a read-only key, which then gets 403                                                                               |
| Evals: realistic multi-call tasks, verifiable outcomes, track calls/tokens/errors, held-out set | None                                                                                                                                      |

## Long solves

Tasks would suit Selva's minute-long solves, but no client implements the extension, so the
plan's synchronous call with a progress heartbeat stays. Under `2026-07-28`, a dropped stream is
re-issued as a new request, so `api.call` mints a new `Idempotency-Key` and the solve runs again.
The solve cache catches identical inputs, which keeps the replay cheap. Revisit once Claude
supports Tasks and the public async solve exists.

## MCP Apps

`io.modelcontextprotocol/ui` renders a server-supplied HTML resource inline in the conversation.
Claude web and Desktop, ChatGPT, Cursor and VS Code Copilot support it. For Selva, it would let
`selva_solve` show the result in the viewer instead of "view it at <link>". Geometry is the thing
the model can't summarize and the user most wants to see. It would mean a separate bundle of
`@selvajs/visualization` served as a `ui://` resource. It's the largest item here and the most
distinctive.

## Sources

- [MCP `2026-07-28` changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [Security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- [Tasks extension](https://modelcontextprotocol.io/extensions/tasks/overview) and the [extension client matrix](https://modelcontextprotocol.io/extensions/client-matrix)
- [TypeScript SDK: supporting `2026-07-28`](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [Claude connectors: authentication](https://claude.com/docs/connectors/building/authentication)
- [Anthropic: writing effective tools for agents](https://anthropic.com/engineering/writing-tools-for-agents)
