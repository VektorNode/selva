---
'@selvajs/mcp': minor
---

- Built on `@modelcontextprotocol/server` v2: `handle` serves protocol `2026-07-28` and, statelessly, 2025-era clients. `tools/list` carries a five-minute private cache hint.
- `handle` answers 403 to a request whose `Origin` is neither the host's nor in the new `allowedOrigins` option.
- An unknown tool, resource or prompt is a JSON-RPC `-32602` error, not a tool result.
- New `grantedActions(api)` option: `tools/list` leaves out tools the request's key can't use, and calling one returns 403 with an `insufficient_scope` challenge naming every scope the tool needs. A 401 from the hook becomes a 401 with `error="invalid_token"`.
- New `challenge` option adds `resource_metadata` and `scope` to the 401 and 403 challenges, for OAuth clients.
- Tools and `fromOperation` take `output` (Zod or JSON Schema), listed as `outputSchema`.
