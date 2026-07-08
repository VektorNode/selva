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

- **[Scaling.md](./Scaling.md)** — Current limits of the compute/data path and the staged scaling roadmap
- **[ADR 0001 — Pre-Step Producers](./adr/0001-pre-step-producers.md)**
- **[ADR 0002 — Grasshopper Bridge Seam](./adr/0002-grasshopper-bridge-seam.md)**
- **[ADR 0003 — Large File Output Streaming](./adr/0003-large-file-output-streaming.md)**

## Plans

- **[Solve / Input Race Conditions](./plans/solve-input-race-conditions.md)** — Fixing lost-update and double-solve bugs in the GH ↔ web bridge
- **[Mesh Texture Support](./plans/mesh-texture-support.md)** — Optional UV chunk in the binary mesh format for textured display
- **[Embeddable Server Layer](./plans/embeddable-server-layer.md)** — Finish the "build your own app on the engine" contract: schema-aware client bundle, exported store utilities, published compute server stack

## Release Management

- **[Publishing.md](./Publishing.md)** — npm releases (Changesets) and Grasshopper plugin (Yak)
