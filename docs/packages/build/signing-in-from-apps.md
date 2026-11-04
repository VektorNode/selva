---
title: Signing in from apps
order: 6
published: true
description: 'How the Grasshopper plugin and MCP clients sign in through the browser, what each may be granted, and where the resulting token lives.'
---

# Signing in from apps

The Grasshopper plugin (to upload definitions) and MCP clients such as Claude (to read and solve) use the standard native-app flow: the app opens `/oauth/authorize` in your browser, you sign in and click Allow, and the app trades the one-time code it gets back for an API token. The app never sees your password.

- The consent page names the app and lists what it may do.
- With several organizations you pick one. The token works there only.
- Allowing creates an API token acting as you, named after the app, such as "Selva for Grasshopper (OAuth)".
- The code is useless without the PKCE secret only the starting app holds.
- There are no refresh tokens. After 30 days the app gets a 401 and you sign in again.

OAuth needs `SELVA_HMAC_KEY` set, as API tokens do.

## The Grasshopper plugin

Built into every instance as client `selva-grasshopper`; no registration, works offline.

- It can only send the token to `http://127.0.0.1/callback` on any port, a listener the plugin opens while you sign in.
- It asks for **Upload definitions** (`upload`): create definitions and versions where you already could, check a file, make a version live. It can't edit details, delete or create share links.
- It also asks to create projects (`create_projects`), so you can upload into a new one. It works only where you could already create projects. Those projects are private, and nobody joins them on upload. The consent page names it.
- Before its first sign-in to an instance, the plugin asks in Rhino, not in the web page, whether to connect to that address.
- Any program on your machine can use this client id. Approve only a sign-in you just started.

Uploaded definitions run their scripts on your Compute server: see [who can put code on Compute](../../self-hosting/deployment/security-and-limits.md#who-can-put-code-on-compute).

## MCP clients

They register themselves (dynamic registration or a metadata URL) and Selva doesn't verify their name. They can get **Read** or **Read and run solves**, never **Upload definitions** or project creation. See [MCP server](./mcp.md).

## Who may approve what

| Access                        | Who may approve                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Read, Upload                  | Anyone who can create a definition in one project of the org, or `manage_api_tokens`                              |
| Read, Upload, create projects | The same, or anyone who may create a project in the org (an org admin with no projects yet), or `manage_api_tokens` |
| Read and run solves           | Holders of `manage_api_tokens`                                                                                    |

The check runs on every request, so a token stops working when its owner no longer qualifies, and works again if they regain the right.

## Where the token lives

- **Team → API tokens** (`/team/tokens`) lists your tokens, including unfinished sign-ins. Org admins with `manage_org_members` see and revoke everyone's.
- An app signs out with `DELETE /api/v1/me/token`, which revokes only the token it sent. It works even when the owner no longer qualifies to hold the token.
- `GET /api/v1/me` returns `capabilities.createProjects` for the token. `orgPermissions` there is the owner's and isn't narrowed to the token, so don't derive capabilities from it.
- The plugin stores the token in Windows Credential Manager or the macOS login keychain, never in the `.gh` file, the web UI or a log.

## Behind a forward-auth proxy

Let the OAuth discovery and token endpoints and `selva_` keys through without the proxy's sign-in. Keep `/oauth/authorize` behind it. The Caddyfile in [Header auth with Entra](../../self-hosting/providers/header-auth-entra.md#part-5-caddyfile) does this. Because those keys skip the proxy, disabling someone in your identity provider doesn't stop them: see [When someone leaves](../../self-hosting/providers/header-auth-entra.md#when-someone-leaves).
