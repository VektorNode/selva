---
title: Local Dev Setup
order: 4
published: true
description: 'Run the whole app on your own machine with hot reload before committing to servers.'
---

# Local Dev Setup

Runs the full Selva web app on your own machine. Solving still needs a Rhino.Compute server, which is Windows-only and isn't part of this. For a real deployment, see [Get Started](./overview.md).

## Prerequisites

- **Node.js >= 24** and **pnpm >= 11** — required
- **.NET SDK 7.0+** — only to build the C# plugin
- **Rhino 8 or 9** — only to run the plugin (Rhino 7 is not supported)
- **Docker Desktop** — only for the Supabase provider's local stack

Node and pnpm versions come from `engines` in the root `package.json`; pnpm is pinned exactly by `packageManager` and activated through Corepack.

## 1. Install

```bash
pnpm install
pnpm build
```

Both from the repo root. The build is not optional: the app imports the workspace packages (`@selvajs/ui`, `@selvajs/platform`, and the rest) from their built `dist/` output, so the dev server won't start until they exist.

## 2. Configure environment

```bash
cp packages/selva/.env.example packages/selva/.env
```

[`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example) documents every setting inline. At minimum, replace the placeholder `SELVA_HMAC_KEY` (signs session cookies, hashes share-link and invite tokens) and `SELVA_AT_REST_KEY` (encrypts the stored Rhino.Compute API key). Both must be 32 bytes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

That's all the `local` provider needs — it stores everything as JSON under `.selva-data/` at the repo root (`DATA_PATH`).

Optional:

- **Supabase**: set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, then point the slots you want it to own at `supabase` — usually all three of `SELVA_AUTH_PROVIDER`, `SELVA_DATA_PROVIDER`, `SELVA_STORAGE_PROVIDER`. See [Supabase provider](../providers/supabase.md).
- **Multi-org**: `SELVA_TENANCY=multi`.

## 3. Run

```bash
pnpm dev:selva
# http://localhost:5173
```

On first boot, visit `/setup` to create the platform admin: email, a password of at least 8 characters, and (in single-tenant mode) a company name, which becomes your first organization with a "Default" project inside it. Once an admin exists the page redirects to `/login`.

Then register your Rhino.Compute server at `/admin/compute` — see [Rhino Compute Setup](./rhino-compute.md). Until you do, nothing will solve.

## Plugin UI (optional)

The schema designer embedded in the Grasshopper plugin — a separate app from the one above. Running it against a live plugin gives hot reload on the web UI while the C# stays debuggable:

```bash
# Terminal 1: build the plugin, then run it from your IDE
cd Plugin && dotnet build
# Terminal 2:
pnpm dev:plugin
```

The plugin serves the WebSocket (8765 by default) and the page connects back to it. Vite serves this app on 5173 too, so if the Selva app is already running, this one takes the next free port — check the terminal for the URL.

## Providers

|               | Local                       | Supabase                        | Header (forward auth)                 |
| ------------- | --------------------------- | ------------------------------- | ------------------------------------- |
| Slots         | auth, data, storage         | auth, data, storage             | auth only — pair with another         |
| State         | JSON files on disk          | Postgres + Auth + Storage       | allowlist JSON; identity is the IdP's |
| External deps | none                        | Docker, for the local CLI stack | a reverse proxy that authenticates    |
| Best for      | quick eval, single-instance | multi-instance, several tenants | SSO behind Entra, Okta, oauth2-proxy  |

The three slots (`SELVA_AUTH_PROVIDER`, `SELVA_DATA_PROVIDER`, `SELVA_STORAGE_PROVIDER`) are set independently and each defaults to `local`. Change them in `.env` and restart. Supabase also works as a managed project: point `SUPABASE_URL` at it and Docker isn't involved.

`header` is auth-only and has no data or storage layer, so it is always paired — usually `SELVA_DATA_PROVIDER=local`. See the [`@selvajs/header-auth-provider` README](https://github.com/VektorNode/selva/blob/main/packages/providers/header-auth/README.md); it is the only provider whose security depends on configuration outside Selva, since it trusts identity headers the proxy is responsible for stripping and setting.

### Trying a provider without committing your `.env`

Editing `.env` back and forth to compare providers is avoidable. From a repo checkout:

```bash
pnpm dev:local       # local provider
pnpm dev:supabase    # starts the Supabase CLI stack first
pnpm dev:header      # starts a local Caddy that fakes the SSO headers
```

Each pins one provider, keeps its own throwaway data directory, and leaves your
`.env` and `.selva-data/` untouched. Testing the header provider this way needs
no identity provider at all. Details in
[scripts/DEV-PROVIDERS.md](https://github.com/VektorNode/selva/blob/main/scripts/DEV-PROVIDERS.md).

## Troubleshooting

- **Compute 500s on solve.** Check that Rhino.Compute is running and registered at `/admin/compute`.
- **`Cross-site POST form submissions are forbidden`.** SvelteKit compares the request's `Origin` header against the app's own URL. `vite dev` knows its own address, so this only turns up once the built app sits behind a proxy. Set `ORIGIN` to the public URL, no trailing slash.
- **`/setup` redirects to `/login`.** An admin already exists. With the `local` provider, delete the data directory (`DATA_PATH`, `.selva-data/` by default) to start over.
- **Login succeeds but bounces back to `/login`.** Only bites a production build (`NODE_ENV=production`) served over plain `http://`: the session cookie is marked `Secure` and the browser drops it. Set `ALLOW_INSECURE_COOKIES=true`. `pnpm dev:selva` is unaffected.
