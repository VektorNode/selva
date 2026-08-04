---
title: Local Dev Setup
group: Get Started
order: 4
published: true
description: 'Run the whole app on your own machine with hot reload before committing to servers.'
---

# Local Dev Setup

This runs the full Selva web app on your own machine, which is the fastest way to see it working before you set up any servers. For a real deployment, see [Get Started](getting-started/overview.md) instead.

## Prerequisites

Install these first if you don't have them. **Node.js** runs JavaScript outside the browser, and **pnpm** fetches the code Selva depends on.

- **Node.js >= 22** and **pnpm >= 11** — required
- **.NET SDK 7.0+** — only if touching the C# plugin
- **Rhino 8 or 9** — only if running the plugin (Rhino 7 is not supported)
- **Docker Desktop** — only if using the Supabase provider locally

The "Requirements" section in the repo root `README.md` is the canonical version list, and this page mirrors it.

## 1. Install

```bash
pnpm install
pnpm build
```

## 2. Configure environment

```bash
cp packages/selva/.env.example packages/selva/.env
```

An `.env` file holds the settings the app reads at startup: the secrets and config you don't want hard-coded. [`.env.example`](../packages/selva/.env.example) lists every setting with notes beside it. You've just copied that file, so now fill in a few values. At minimum:

- Set `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY`. These are two random secret strings the app uses to sign sessions and encrypt stored data, and the `.env.example` comments show a command to generate them. That's all the `local` provider needs.
- For Supabase, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (see the [supabase-provider README](../packages/providers/supabase/README.md)) plus `SELVA_AUTH_PROVIDER=supabase`.
- To test multi-org, set `SELVA_TENANCY=multi`.

## 3. Run

```bash
cd packages/selva
pnpm run dev
# http://localhost:5173
```

On first boot, visit `/setup` to create the platform admin. Then register your Rhino.Compute server at `/admin/compute`, covered in [RhinoCompute.md](RhinoCompute.md).

## Plugin UI (optional)

For C# plugin development with hot reload:

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

To switch, change `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` in `.env` and restart.

## Troubleshooting

- **Compute 500s on solve** — check that Rhino.Compute is running and registered at `/admin/compute`.
- **`Cross-site POST form submissions are forbidden`** — the app doesn't know its own public URL. Set `ORIGIN=https://your-domain.com` in `.env`, or `http://localhost:3000` locally.
- **First user can't sign in** — check that `/setup` ran cleanly. It's available only on a fresh install with no users.
