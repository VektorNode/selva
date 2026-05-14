# Getting Started

This is the canonical onramp. Follow it top to bottom.

## Prerequisites

- **Node.js >= 20.6** and **pnpm >= 10** ([packages/selva/package.json](../packages/selva/package.json) is authoritative for the app runtime)
- **.NET SDK 7.0+** and an IDE (Visual Studio / Rider / VS Code) — only if you'll touch the C# plugin
- **Rhino 8** — only if you'll run the plugin
- **Docker Desktop** — only if you'll use the Supabase provider locally

## 1. Install

```bash
pnpm install
pnpm build
```

## 2. Pick a path

Selva ships two backend providers; both run locally. Pick one:

|                    | Local provider                          | Supabase (local stack)             |
| ------------------ | --------------------------------------- | ---------------------------------- |
| **State lives in** | JSON files on disk                      | Postgres + Supabase Auth + Storage |
| **External deps**  | none                                    | Docker                             |
| **Best for**       | quick eval, single-instance self-host   | multi-instance, RLS, managed auth  |
| **Switch later**   | yes — edit `selva.config.ts` and re-run | yes                                |

The default is local. You can switch any time by editing `selva.config.ts`.

## 3. Configure environment

Use the command that matches your shell:

```bash
# bash
cp packages/selva/.env.example packages/selva/.env
```

```powershell
# PowerShell
Copy-Item packages/selva/.env.example packages/selva/.env
```

[`.env.example`](../packages/selva/.env.example) is the **single authoritative reference** for every env var Selva reads — provider choice, tenancy, platform flags, secrets. Open it and:

- Set `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` (instructions inline). For local provider those two are enough.
- For Supabase, set `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — see [@selvajs/supabase-provider](../packages/providers/supabase/README.md#development--local-supabase-stack) for the `npx supabase start` flow that produces those keys. Then switch the provider in `selva.config.ts`.
- For multi-org testing, set `tenancy: 'multi'` in `selva.config.ts`.

You shouldn't need to read any other env-var documentation.

## 4. Run

```bash
cd packages/selva
pnpm run dev
# http://localhost:3000
```

On first boot, hit `/setup` to create the platform admin.

After login, go to `/admin/compute` and register your Rhino.Compute server URL (and optional API key) — Selva needs this to actually solve definitions. See [RhinoCompute.md](RhinoCompute.md) for setting that up.

## Plugin UI (optional — only for plugin development)

If you're working on the C# plugin and want hot-reload UI:

```bash
# Terminal 1 — start the plugin in your IDE (debug mode)
# Terminal 2:
cd packages/plugin-ui
pnpm run dev
# http://localhost:5173 — connects to plugin via WebSocket on port 8765
```

The plugin UI needs no env vars.

## Going further

- **[Architecture](../packages/selva/specs/Architecture.md)** — how the providers, tenancy, and access rules fit together
- **[Access control](../packages/selva/specs/Permissions.md)** — who can do what
- **[@selvajs/local-provider](../packages/providers/local/README.md)** — on-disk layout, backups, caveats
- **[@selvajs/supabase-provider](../packages/providers/supabase/README.md)** — schema, RLS, hosted setup
- **[Deploying to a Linux VM](deployment/GCE-Linux.md)** — production deploy walkthrough
- **[RhinoCompute.md](RhinoCompute.md)** — set up the Rhino.Compute server

## Troubleshooting

- **Frontend slow on first build** — normal; subsequent reloads are fast.
- **Compute features missing or 500s on solve** — verify Rhino.Compute is running and registered at `/admin/compute`.
- **`Cross-site POST form submissions are forbidden`** — set `ORIGIN=https://your-domain.com` in `.env` (you're behind a reverse proxy).
- **First user can't sign in** — check that `/setup` ran cleanly; it's only available on a fresh install with no users.
