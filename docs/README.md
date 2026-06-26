# Documentation

## Getting Started

- **[QuickStart.md](QuickStart.md)** — Setup and initial configuration
- **[CLI.md](CLI.md)** — `npx @selvajs/cli` and the `selva` operator commands
- **[Turborepo.md](Turborepo.md)** — Task orchestration across the monorepo
- **[Testing.md](Testing.md)** — Vitest and Playwright

## Backend Providers

- **[@selvajs/local-provider](../packages/providers/local/README.md)** — Filesystem + JSON + HMAC. Default. Single-instance.
- **[@selvajs/supabase-provider](../packages/providers/supabase/README.md)** — Supabase Auth + Postgres + Storage. Multi-instance, RLS.
- **[@selvajs/header-auth-provider](../packages/providers/header-auth/README.md)** — Trusts identity headers from a reverse proxy (Caddy, oauth2-proxy, Entra, etc.).

## Deployment

- **[GCE-Linux.md](./deployment/GCE-Linux.md)** — Linux VM deploy behind Caddy
- **[Caddyfile.example](./deployment/Caddyfile.example)** — Reference Caddy config
- **[RhinoCompute.md](./RhinoCompute.md)** — Set up the Rhino.Compute server
- **[Caching.md](./Caching.md)** — The three solve caches, their settings, and costs

## Architecture

- **[ADR 0001 — Pre-Step Producers](./adr/0001-pre-step-producers.md)**
- **[ADR 0002 — Grasshopper Bridge Seam](./adr/0002-grasshopper-bridge-seam.md)**
- **[ADR 0003 — Large File Output Streaming](./adr/0003-large-file-output-streaming.md)**

## Release Management

- **[Publishing.md](./Publishing.md)** — npm releases (Changesets) and Grasshopper plugin (Yak)
