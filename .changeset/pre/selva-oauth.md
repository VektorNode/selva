---
'@selvajs/selva': minor
---

- MCP clients can sign in through the browser: OAuth discovery, registration, a consent page at `/oauth/authorize` and a token endpoint. Approving mints a 30-day API token named after the client. `/mcp`'s 401 points clients at it.
- The form-CSRF check moves from SvelteKit into the hook, so the OAuth token endpoint and API-token multipart uploads (which send no `Origin`) are no longer refused in production.
