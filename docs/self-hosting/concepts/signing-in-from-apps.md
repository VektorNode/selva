---
title: Signing in from apps
order: 11
published: true
description: 'How the Grasshopper plugin and MCP clients sign in through the browser, what each may be granted, and where the resulting token lives.'
---

# Signing in from apps

Two kinds of app sign in to Selva on your behalf: the Grasshopper plugin, to upload
definitions, and MCP clients such as Claude, to read and solve them. Both use the same
flow, the one native apps use everywhere: the app opens Selva in your browser, you sign in
and approve, and the app gets an API token. The app never sees your password.

## What happens

1. The app opens `/oauth/authorize` in your browser. If you aren't signed in, Selva sends you
   to the login page first, through whatever sign-in your instance uses.
2. The consent page names the app, says where the token will go, and lists what it may do.
3. If you belong to more than one organization, you pick one. The token works in that
   organization only. Selva refuses an organization you don't belong to, whatever the form
   says.
4. **Allow** creates an API token acting as you, named after the app, such as
   "Selva for Grasshopper (OAuth)". It lasts 30 days.
5. The app trades a one-time code for the token. The code is useless without a secret only
   the app that started the sign-in holds (PKCE), so another program that catches it can't
   redeem it.

There are no refresh tokens. After 30 days the app gets a 401 and asks you to sign in again.

OAuth needs `SELVA_HMAC_KEY` set, as API tokens do.

## The Grasshopper plugin

The plugin is built into every Selva instance as the client `selva-grasshopper`, named
"Selva for Grasshopper". It needs no registration, so it works on an instance with no
internet access. The consent page marks it as built in.

- **It can only send the token to your own machine.** Its one redirect is
  `http://127.0.0.1/callback` on any port: a listener the plugin opens while you sign in.
  `localhost`, another path or another host is refused.
- **It asks for Upload definitions** (`upload`). That allows creating definitions and new
  versions where you could already, and making a version live. It can't edit a
  definition's details, delete anything or create share links.
- **No admin has to switch it on.** Anyone who can create a definition in at least one
  project of the organization may approve it: a project owner or editor, or anyone on a
  commons project.

Any program on your machine can use this client id, as with any app that runs on your own
computer. The consent page warns that the token goes to a program on your computer; only
approve a sign-in you just started.

Uploading a definition runs its scripts on your organization's Compute server. See
[who can put code on Compute](./security-and-limits.md#who-can-put-code-on-compute).

## MCP clients

MCP clients register themselves, by dynamic client registration or a client metadata URL.
Their name is whatever they say it is, and the consent page says Selva hasn't checked it.
See [MCP server](./mcp.md) for connecting one.

A registered client can be granted **Read**, or **Read and run solves**, and never
**Upload definitions**. One that asks for upload is given at most read and solve, so a
look-alike "Selva for Grasshopper" registration can't phish for upload rights.

## Who may approve what

| Access              | Who may approve                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Read                | Anyone who can create a definition in one project of the org, or holds `manage_api_tokens` |
| Upload definitions  | The same                                                                                   |
| Read and run solves | Holders of `manage_api_tokens`                                                             |

The check runs again on every request, so a token stops working once its owner no longer
qualifies, for example after losing their last editable project. It isn't revoked: it
works again if they get the right back.

## Where the token lives

- **Team → API tokens** (`/team/tokens`) lists your tokens, including ones from sign-ins
  you approved but the app never finished. Revoke any you don't recognise. Org admins with
  `manage_org_members` see and revoke everyone's.
- **An app signs out** by calling `DELETE /api/v1/me/token` with its token. That revokes
  the token it sent and nothing else.

## Behind a forward-auth proxy

The app's own calls carry a `selva_` key, and the OAuth discovery and token endpoints are
called with no session, so the proxy must let those through without its sign-in.
`/oauth/authorize` stays behind it, so you sign in as usual. The Caddyfile in
[Header auth with Entra](../providers/header-auth-entra.md#part-5-caddyfile) does this.
