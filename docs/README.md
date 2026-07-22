# Documentation

## Getting Started

- **[what-is-selva.md](what-is-selva.md)** — What Selva is and who it's for
- **[getting-started/overview.md](./getting-started/overview.md)** — Deployment-first path via the CLI scaffold
- **[getting-started/build-your-own-app.md](./getting-started/build-your-own-app.md)** — Using the published packages in your own app
- **[QuickStart.md](QuickStart.md)** — Local dev setup from the repo
- **[CLI.md](CLI.md)** — `npx @selvajs/cli` and the `selva` operator commands
- **[Turborepo.md](Turborepo.md)** — Task orchestration across the monorepo
- **[Testing.md](Testing.md)** — Vitest and Playwright

## Backend Providers

- **[providers.md](providers.md)** — Provider model overview (auth / data / storage slots)
- **[providers/local.md](./providers/local.md)** / **[@selvajs/local-provider](../packages/providers/local/README.md)** — Filesystem + JSON + HMAC. Default. Single-instance.
- **[providers/supabase.md](./providers/supabase.md)** / **[@selvajs/supabase-provider](../packages/providers/supabase/README.md)** — Supabase Auth + Postgres + Storage. Multi-instance, RLS.
- **[providers/header-auth-entra.md](./providers/header-auth-entra.md)** / **[@selvajs/header-auth-provider](../packages/providers/header-auth/README.md)** — Trusts identity headers from a reverse proxy (Caddy, oauth2-proxy, Entra, etc.).
- **[providers/writing-a-provider.md](./providers/writing-a-provider.md)** — Implementing the platform interfaces yourself

## Plugin

- **[plugin/overview.md](./plugin/overview.md)** — The five feature areas ([ui-builder](./plugin/ui-builder.md), [display](./plugin/display.md), [file-io](./plugin/file-io.md), [compute-io](./plugin/compute-io.md), [drawing](./plugin/drawing.md))

## Deployment

- **[GCE-Linux.md](./deployment/GCE-Linux.md)** — Linux VM deploy behind Caddy
- **[Entra.md](./deployment/Entra.md)** — Entra SSO via oauth2-proxy + Caddy
- **[Caddyfile.example](./deployment/Caddyfile.example)** — Reference Caddy config
- **[RhinoCompute.md](./RhinoCompute.md)** — Set up the Rhino.Compute server
- **[Caching.md](./Caching.md)** — The three solve caches, their settings, and costs

## Concepts & Operations

- **[permissions.md](permissions.md)** — Platform / org / project scopes, invites, share links
- **[admin.md](admin.md)** — The `/admin` operator area, section by section
- **[security-and-limits.md](security-and-limits.md)** — Rate limits, size/queue caps, SSRF guard, secrets, cookies

## Architecture

- **[architecture.md](architecture.md)** — System shape: plugin, web app, Rhino.Compute, schema codegen
- **[Scaling.md](./Scaling.md)** — Current limits of the compute/data path and the staged scaling roadmap
- **[ADR 0001 — Pre-Step Producers](./adr/0001-pre-step-producers.md)**
- **[ADR 0002 — Grasshopper Bridge Seam](./adr/0002-grasshopper-bridge-seam.md)**
- **[ADR 0003 — Large File Output Streaming](./adr/0003-large-file-output-streaming.md)**
- **[ADR 0004 — Compute Server Identity and LB Affinity](./adr/0004-compute-server-identity-and-lb-affinity.md)**
- **[ADR 0005 — UISchema Version and Disposable Schema Cache](./adr/0005-uischema-version-and-disposable-schema-cache.md)**
- **[ADR 0006 — Multi-org URL Shape and Reserved Slugs](./adr/0006-multi-org-url-shape-and-reserved-slugs.md)**

## Plans

- **[0. Data Access Efficiency Audit](./plans/0.data-access-efficiency-audit.md)** — Pre-scale audit of the compute/data path with open efficiency items
- **[1. API v1 Redesign](./plans/1.api-redesign-plan.md)** — One versioned `/api/v1` surface for both browser and token-based clients
- **[2. Token-based API Auth](./plans/2.token-plan.md)** — Personal access tokens (PATs) + managed public API; MCP designed-but-deferred
- **[3. Pre-solved Bundle + Prewarm](./plans/3.presolve-bundle.md)** — Ship a pre-solved definition bundle and prewarm the solve caches (F1)
- **[4. Edge Overlay Performance](./plans/4.edge-overlay-performance.md)** — Edge rendering cost in the Three.js viewer
- **[5. Display Pipeline Performance Audit](./plans/5.display-pipeline-performance-audit.md)** — End-to-end display pipeline profiling
- **[5. Plugin Compat Gate](./plans/5.plugin-compat-gate.md)** — Plugin/app compatibility gating
- **[Verify slider-drag solve path](./plans/verify-slider-drag-solve-path.md)** — Trace of the slider-drag solve path

Completed plans are archived under [`./plans/archive/`](./plans/archive/).

## Release Management

- **[Publishing.md](./Publishing.md)** — npm releases (Changesets) and Grasshopper plugin (Yak)
