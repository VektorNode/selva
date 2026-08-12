---
title: Local Dev Setup
order: 4
published: false
description: 'Run the whole app on your own machine with hot reload before committing to servers.'
---

# Local Dev Setup

This runs the full Selva web app on your own machine, the fastest way to see it working before you deploy anything. One thing stays remote: solving needs a Rhino.Compute server, which is Windows-only and doesn't run as part of this. For a real deployment, see [Get Started](./overview.md) instead.

## Prerequisites

- **Node.js >= 22** and **pnpm >= 11**: required
- **.NET SDK 7.0+**: only if touching the C# plugin
- **Rhino 8 or 9**: only if running the plugin (Rhino 7 is not supported)
- **Docker Desktop**: only if using the Supabase provider locally

Node and pnpm versions come from `engines` in the root `package.json`; pnpm is pinned exactly by `packageManager` there and activated through Corepack.

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

[`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example) documents every setting inline. At minimum:

- Replace the placeholder `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY`. The first signs session cookies, the second encrypts stored credentials. Generate each with:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

  That's all the `local` provider needs. It stores everything as JSON files under `.selva-data/` at the repo root.

- For Supabase, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (see the [`@selvajs/supabase-provider` README](https://github.com/VektorNode/selva/blob/main/packages/providers/supabase/README.md)), then point the slots you want it to own at `supabase`. That's usually all three: `SELVA_AUTH_PROVIDER`, `SELVA_DATA_PROVIDER`, `SELVA_STORAGE_PROVIDER`.
- To test multi-org, set `SELVA_TENANCY=multi`.

## 3. Run

```bash
pnpm dev:selva
# http://localhost:5173
```

On first boot, visit `/setup` to create the platform admin: an email, a password of at least 8 characters, and (in single-tenant mode) a company name, which becomes your first organization with a "Default" project inside it. Once an admin exists the page redirects to `/login`.

Then register your Rhino.Compute server at `/admin/compute`, covered in [RhinoCompute.md](./rhino-compute.md). Until you do, the app runs but no definition will solve.

## Plugin UI (optional)

The schema designer embedded in the Grasshopper plugin, a separate app from the one above. Running it against a live plugin gives you hot reload on the web UI while the C# stays debuggable:

```bash
# Terminal 1: build the plugin and run it from your IDE
cd Plugin && dotnet build
# Terminal 2:
pnpm dev:plugin
```

The plugin serves the WebSocket (port 8765 by default) and the page connects back to it. Vite serves this app on 5173 too, so if the Selva app from step 3 is already running, this one takes the next free port. Check the terminal for the URL it prints.

## Providers

|               | Local                       | Supabase                        |
| ------------- | --------------------------- | ------------------------------- |
| State         | JSON files on disk          | Postgres + Auth + Storage       |
| External deps | none                        | Docker, for the local CLI stack |
| Best for      | quick eval, single-instance | multi-instance, several tenants |

The three provider slots (`SELVA_AUTH_PROVIDER`, `SELVA_DATA_PROVIDER`, `SELVA_STORAGE_PROVIDER`) are set independently and each defaults to `local`. Change them in `.env` and restart. Supabase also works as a managed project: point `SUPABASE_URL` at it and Docker isn't involved.

## Troubleshooting

- **Compute 500s on solve.** Check that Rhino.Compute is running and registered at `/admin/compute`.
- **`Cross-site POST form submissions are forbidden`.** SvelteKit compares the request's `Origin` header against the app's own URL. `vite dev` knows its own address, so this turns up only once the built app sits behind a proxy. Set `ORIGIN` to the public URL, no trailing slash.
- **`/setup` redirects to `/login`.** An admin already exists, so setup is closed. With the `local` provider, delete the data directory (`DATA_PATH`, `.selva-data/` by default) to start over.
- **Login succeeds but bounces back to `/login`.** This only bites a production build (`NODE_ENV=production`) served over plain `http://`: the session cookie is marked `Secure` and the browser drops it. Set `ALLOW_INSECURE_COOKIES=true`. `pnpm dev:selva` is unaffected.
