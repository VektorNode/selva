---
title: MCP server
order: 10
published: true
description: 'Connect an AI agent to Selva over MCP: the endpoint, the key it needs, and what it can and cannot do.'
---

# MCP server

Every Selva instance serves an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`. An agent
connected to it can find a definition, read its inputs, solve it and read the numbers back. It
cannot delete anything, manage share links or tokens, or reach `/admin`.

The endpoint is a client of `/api/v1`: each tool call goes through the API with the caller's key,
so it sees exactly what that key sees and is rate-limited the same way.

## Connect

1. Create an API key at **Settings → API tokens** (`/team/tokens`). Pick **Read and run solves**; a
   **Read** key can browse and describe but every solve gets 403.
2. Point the client at `https://<your-selva-host>/mcp` and send the key as a header:
   `Authorization: Bearer selva_…`.

Claude Code:

```bash
claude mcp add --transport http selva https://selva.example.com/mcp \
  --header "Authorization: Bearer selva_…"
```

Other clients that support remote MCP servers with custom headers take the same URL and header in
their MCP config. The transport is streamable HTTP, stateless: every message is a `POST`.

## Limits

- **A key header is the only way in.** There is no OAuth flow yet, so clients that can only
  connect through OAuth, such as claude.ai connectors, can't use it.
- **Solves spend compute.** A token solve draws on its owner's compute budget, and the token rate
  limit applies on top: see [Security and limits](./security-and-limits.md#api-tokens-apiv1).
  The server tells the agent to confirm with the user before a series of solves.
- **Only the live version solves.** A definition with nothing published can't be solved from MCP.
- **Geometry stays in Selva.** A solve returns number and text outputs, a count per geometry
  output and file names, plus a link to view the result.
- **Tokens need a provider that stores them.** On a data provider without an API-token store,
  every call returns 503 `API_TOKENS_UNAVAILABLE`.
