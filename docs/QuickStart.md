---
title: Local Dev Setup
group: Get Started
order: 4
published: true
description: 'Run the whole app on your own machine with hot reload before committing to servers.'
---

# Local Dev Setup

This runs the full Selva web app on your own machine — the fastest way to see it working before you set up any servers. (For a real deployment, see [Get Started](getting-started/overview.md).)

## Prerequisites

Install these first if you don't have them. **Node.js** runs JavaScript outside the browser; **pnpm** is the tool that downloads Selva's code dependencies (think of it as a package installer).

- **Node.js >= 22** and **pnpm >= 10** — required
- **.NET SDK 7.0+** — only if touching the C# plugin
- **Rhino 8 or 9** — only if running the plugin (Rhino 7 is not supported)
- **Docker Desktop** — only if using the Supabase provider locally

The repo root `README.md` "Requirements" section is the canonical version list; this page mirrors it.

## 1. Install

```bash
pnpm install
pnpm build
```

## 2. Configure environment

```bash
cp packages/selva/.env.example packages/selva/.env
```

An `.env` file holds settings the app reads at startup — secrets and config you don't want hard-coded. [`.env.example`](../packages/selva/.env.example) lists every available setting with inline notes; you just copied it and now fill in a few values. At minimum:

- Set `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` — two random secret strings the app uses to sign sessions and encrypt stored data. The `.env.example` comments show a command to generate them. That's all the `local` provider needs.
- For Supabase, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (see the [supabase-provider README](../packages/providers/supabase/README.md)) and `SELVA_AUTH_PROVIDER=supabase`.
- For multi-org testing, set `SELVA_TENANCY=multi`.

## 3. Run

```bash
cd packages/selva
pnpm run dev
# http://localhost:5173
```

On first boot, visit `/setup` to create the platform admin. Then register your Rhino.Compute server at `/admin/compute` — see [RhinoCompute.md](RhinoCompute.md).

## Plugin UI (optional)

For C# plugin development with hot-reload:

```bash
# Terminal 1: start the plugin in your IDE
# Terminal 2:
cd packages/plugin-ui && pnpm run dev
# http://localhost:5173 — connects to plugin via WebSocket on port 8765
```

## Providers

|               | Local                       | Supabase                  |
| ------------- | --------------------------- | ------------------------- |
| State         | JSON files on disk          | Postgres + Auth + Storage |
| External deps | none                        | Docker                    |
| Best for      | quick eval, single-instance | multi-instance, RLS       |

Switch by changing `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` in `.env` and restarting.

## Troubleshooting

- **Compute 500s on solve** — verify Rhino.Compute is running and registered at `/admin/compute`.
- **`Cross-site POST form submissions are forbidden`** — the app doesn't know its own public URL. Set `ORIGIN=https://your-domain.com` (or `http://localhost:3000` locally) in `.env`.
- **First user can't sign in** — check `/setup` ran cleanly (available only on a fresh install with no users).
