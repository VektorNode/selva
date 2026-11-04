---
title: Local Dev Setup
order: 4
published: true
description: 'Run the whole app on your own machine with hot reload before committing to servers.'
---

# Local Dev Setup

Runs the web app on your machine. Solving still needs a Windows [Rhino.Compute](./rhino-compute.md) server. For a real deployment, see [Get Started](./overview.md).

## Prerequisites

- **Node.js >= 24** and **pnpm >= 11**
- **.NET SDK 10**: only to build the plugin
- **Rhino 8.21+ or 9**: only to run the plugin
- **Docker Desktop**: only for the Supabase provider's local stack

## 1. Install

```bash
pnpm install
pnpm build
```

The build is required: `@selvajs/compute`, `solve` and `visualization` load from their built `dist/`. The other workspace packages load from source and hot-reload.

## 2. Configure

```bash
cp packages/selva/.env.example packages/selva/.env
```

[`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example) documents the settings. Replace the placeholders `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` with 32-byte keys:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

That's all the `local` provider needs. For Supabase, see [Supabase provider](../providers/supabase.md). For several organizations, set `SELVA_TENANCY=multi`.

## 3. Run

```bash
pnpm dev:selva
# http://localhost:5199
```

On first boot, visit `/setup` to create the platform admin. Then register your Compute server at `/admin/compute`; nothing solves until you do.

## Plugin UI (optional)

The schema designer embedded in the plugin is a separate app. Run it against a live plugin for web hot reload while the C# stays debuggable:

```bash
# Terminal 1: build the plugin, then run it from your IDE
cd Plugin && dotnet build
# Terminal 2:
pnpm dev:plugin
```

The plugin serves the WebSocket (8765 by default) and opens the page on port 5173. It accepts only that port, so Vite fails instead of moving on if 5173 is taken.

## Trying a provider

Each command pins one provider on a throwaway data directory and leaves your `.env` and `.selva-data/` alone:

```bash
pnpm dev:local       # local provider
pnpm dev:supabase    # starts the Supabase CLI stack first
pnpm dev:header      # local Caddy fakes the SSO headers
```

Details in [scripts/DEV-PROVIDERS.md](https://github.com/VektorNode/selva/blob/main/scripts/DEV-PROVIDERS.md). Provider concepts: [Providers](../providers/overview.md).

## Troubleshooting

- **Compute 500s on solve.** Check Rhino.Compute is running and registered at `/admin/compute`.
- **`Cross-site POST form submissions are forbidden`.** Behind a proxy, set `ORIGIN` to the public URL, no trailing slash.
- **`/setup` redirects to `/login`.** An admin exists. With the `local` provider, stop the server and delete `.selva-data/` (`DATA_PATH`) to start over.
- **Login bounces back to `/login`.** A production build over plain `http://` drops the `Secure` cookie. Set `ORIGIN` to the `http://` address you browse to, or add `ALLOW_INSECURE_COOKIES=true` to `.env`.
