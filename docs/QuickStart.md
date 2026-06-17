---
title: Getting Started
group: Getting Started
order: 1
published: true
---

# Getting Started

## Prerequisites

- **Node.js >= 20.6** and **pnpm >= 10**
- **.NET SDK 7.0+** — only if touching the C# plugin
- **Rhino 8** — only if running the plugin
- **Docker Desktop** — only if using the Supabase provider locally

## 1. Install

```bash
pnpm install
pnpm build
```

## 2. Configure environment

```bash
cp packages/selva/.env.example packages/selva/.env
```

[`.env.example`](../packages/selva/.env.example) is the authoritative reference for every env var. At minimum:

- Set `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` (instructions inline) — enough for the local provider.
- For Supabase, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (see the [supabase-provider README](../packages/providers/supabase/README.md)) and `SELVA_AUTH_PROVIDER=supabase`.
- For multi-org testing, set `SELVA_TENANCY=multi`.

## 3. Run

```bash
cd packages/selva
pnpm run dev
# http://localhost:3000
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
- **`Cross-site POST form submissions are forbidden`** — set `ORIGIN=https://your-domain.com` in `.env`.
- **First user can't sign in** — check `/setup` ran cleanly (available only on a fresh install with no users).
