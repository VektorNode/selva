---
'@selvajs/mcp': minor
---

New package: serve a host's `/api/v1` as MCP tools over stdio or streamable HTTP.

- Built on `@modelcontextprotocol/server` v2: protocol `2026-07-28`, and 2025-era clients statelessly.
- `handle(request, { fetch })` answers as the request's own `Authorization: Bearer selva_…` key, never a configured one, and sends API calls with `credentials: 'omit'`. A missing or non-Selva bearer gets 401 with `WWW-Authenticate`.
- `refuseEarly` runs the origin and key checks before a server is built. `allowedOrigins` widens the accepted `Origin`s.
- `grantedActions` hides tools the key can't use and answers a call with an `insufficient_scope` challenge; `challenge` adds `resource_metadata` and `scope` for OAuth clients.
- Tools take `output` schemas, return `images`, and get annotations, error mapping, 429 handling and `solveTimeoutMs` for `x-long-running` operations from the spec.
- `onCall` and `onToolCall` report each API and tool call without argument values.
