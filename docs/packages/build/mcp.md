---
title: MCP server
order: 7
published: true
description: 'Connect an AI agent to Selva over MCP: the endpoint, signing in with OAuth or a key, and what it can and cannot do.'
---

# MCP server

Every Selva instance serves an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`. An agent can find a definition, read its inputs, solve it and read the numbers back. With an upload-capable key it can also publish a version. It cannot delete anything, manage share links or tokens, or reach `/admin`.

Each tool call goes through `/api/v1` with the caller's key, so the agent sees what that key sees and is rate-limited the same way.

## Connect

Point the client at `https://<your-selva-host>/mcp`.

### Browser sign-in (OAuth)

Clients with MCP authorization (claude.ai connectors, Claude Desktop, Claude Code) need only the URL. On first use they open Selva, where you sign in and choose **Read** or **Read and run solves**. In claude.ai: **Settings → Connectors → Add custom connector**.

Allowing creates a 30-day API token named after the client, listed under **Team → API tokens** where you can revoke it. After expiry the client asks you to sign in again. Details: [Signing in from apps](./signing-in-from-apps.md).

### A key you create

1. Create a key at **Team → API tokens** (`/team/tokens`). **Read and run solves** is needed for the solve tool. **Read, change and run solves** also allows publishing; browser sign-in never grants that.
2. Send it as `Authorization: Bearer selva_…`.

```bash
claude mcp add --transport http selva https://selva.example.com/mcp \
  --header "Authorization: Bearer selva_…"
```

Browser-based clients are refused unless their origin is in `MCP_ALLOWED_ORIGINS` (see [`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example)).

## Limits

- Solves draw on the token owner's compute budget, plus the token rate limit: see [Security and limits](../../self-hosting/deployment/security-and-limits.md#api-tokens-apiv1).
- Only the live version solves.
- A solve returns number and text outputs, a count per geometry output, file names and a link to view the result. Geometry stays in Selva.
- Without an API-token store in the data provider, every call returns 503 `API_TOKENS_UNAVAILABLE`.
