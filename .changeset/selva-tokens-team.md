---
'@selvajs/selva': minor
---

- The API token page moves to `/team/tokens`. Its tab shows only for people who may hold keys, and the new-key email links there.
- `/api/v1/compute/schema`, `/api/v1/solve-events` and `/api/v1/solve/{solveId}/cancel` now count against the per-token rate limit and send `RateLimit-*` headers.
- A `SELVA_HMAC_KEY` shorter than 32 characters turns API tokens off (503) instead of failing every request.
- `selva_solve` takes `detail: 'full'` for the raw solve response, and its geometry summary counts mesh vertices.
- The MCP server is built once instead of on every `/mcp` request.
