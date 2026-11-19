---
title: MCP server
order: 7
published: true
description: 'Connect an AI agent to Selva over MCP: the endpoint, signing in with OAuth or a key, and what it can and cannot do.'
---

# MCP server

Every Selva instance serves an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp`. An agent can find a definition, read its form (groups, inputs with their ranges, units, conditions and descriptions, outputs), solve it, read the numbers back, download output files and render a preview. It can check what a definition needs from its Compute server when a solve fails, and list and compare versions. With a key that may change things, it can also upload a file as a new definition or version, try a version before it is live, edit a definition's details and cover image, publish or roll back a version, and create projects. It cannot delete anything, manage share links or tokens, or reach `/admin`.

A key only sees the tools its scopes allow:

| Scope | Tools |
| --- | --- |
| Read | list projects, project members, definitions, versions; describe; compare versions; check what a definition needs; show the cover |
| Run solves | solve; render a preview |
| Upload | check a file; create a definition; upload a version; publish or roll back; recheck a definition against Compute |
| Change | edit name, description, category, tags and project; set the cover |
| Create projects | create a project |

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
- The live version solves unless the agent asks for `version: 'draft'` or a version id, which an upload-capable key may. A definition's `draft` status only keeps it out of the library; it does not stop solves.
- A solve returns number and text outputs, a count per geometry output, a download link per output file and a link to view the result. Clients that show MCP Apps (claude.ai, Claude Desktop) draw the geometry in a 3D view beside the result, with the definition's number, choice, toggle and text inputs to change and solve again. `detail: 'full'` adds the raw response with geometry, which can be very large.
- Files reach the agent as base64 in the tool call, so an upload is as large as the file plus a third.
- File links, solve geometry and previews are kept in the storage provider for an hour, so they survive a restart and work on every instance sharing that storage. Anyone holding a file link can download it until then.
- Rendering a preview needs a Chromium on the server: `npx playwright install --with-deps chromium`, or set `MCP_PREVIEW_BROWSER`. Without one, that tool says so and the others still work. It draws with the look and background the definition opens in.
- Project members are listed by display name and user id, never by email.
- Every call returns 503 `API_TOKENS_UNAVAILABLE` when the data provider has no API-token store, `SELVA_HMAC_KEY` is missing or under 32 characters, or the Supabase delegated session is unhealthy.
