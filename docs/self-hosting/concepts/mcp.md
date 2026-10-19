---
title: MCP server
order: 10
published: true
description: 'Connect an AI agent to Selva over MCP: the endpoint, signing in with OAuth or a key, and what it can and cannot do.'
---

# MCP server

Every Selva instance serves an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`. An agent
connected to it can find a definition, read its inputs, solve it and read the numbers back. It
cannot delete anything, manage share links or tokens, or reach `/admin`.

The endpoint is a client of `/api/v1`: each tool call goes through the API with the caller's key,
so it sees exactly what that key sees and is rate-limited the same way.

## Connect

Point the client at `https://<your-selva-host>/mcp`. It signs in one of two ways.

### Sign in through the browser (OAuth)

Clients that support MCP authorization, such as claude.ai connectors, Claude Desktop and Claude
Code, need only the URL. On first use they open Selva in a browser, where you sign in and choose
what the client may do:

- **Read**: browse definitions and their inputs.
- **Read and run solves**: also solve, which spends your compute budget.

Allowing it creates an API token named after the client, such as "Claude (OAuth)". The consent
page says how long it lasts. It shows up under **Settings → API tokens**, where you can revoke it.
When it expires, the client asks you to sign in again.

In claude.ai: **Settings → Connectors → Add custom connector**, and paste the URL.

OAuth needs `SELVA_HMAC_KEY` set, as API tokens do. Behind a forward-auth proxy, some routes
must skip the proxy's sign-in: see [Header auth with Entra](../providers/header-auth-entra.md#part-5-caddyfile).

### Send a key yourself

1. Create an API key at **Settings → API tokens** (`/team/tokens`). Pick **Read and run solves**; a
   **Read** key sees no solve tool.
2. Send it as a header: `Authorization: Bearer selva_…`.

Claude Code:

```bash
claude mcp add --transport http selva https://selva.example.com/mcp \
  --header "Authorization: Bearer selva_…"
```

Other clients that support remote MCP servers with custom headers take the same URL and header in
their MCP config.

A browser-based client, such as a web MCP inspector, is refused unless its origin is listed in
`MCP_ALLOWED_ORIGINS` (see [`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example)).

## Limits

- **Solves spend compute.** A token solve draws on its owner's compute budget, and the token rate
  limit applies on top: see [Security and limits](./security-and-limits.md#api-tokens-apiv1).
  The server tells the agent to confirm with the user before a series of solves.
- **Only the live version solves.** A definition with nothing published can't be solved from MCP.
- **Geometry stays in Selva.** A solve returns number and text outputs, a count per geometry
  output and file names, plus a link to view the result.
- **Tokens need a provider that stores them.** On a data provider without an API-token store,
  every call returns 503 `API_TOKENS_UNAVAILABLE`.
