# Documentation

## Getting Started

- **[QuickStart.md](QuickStart.md)** — Setup, development, and initial configuration
- **[CLI.md](CLI.md)** — `npx @selvajs/cli` and the `selva` operator commands (init, doctor, start/stop/restart, logs, update, keys rotate)
- **[Turborepo.md](Turborepo.md)** — How tasks are wired across the monorepo
- **[Testing.md](Testing.md)** — Vitest (unit/integration) and Playwright (E2E) — how they're structured and run

## Backend Providers

Selva's auth, data, and storage are pluggable. Pick one when configuring the selva app:

- **[@selvajs/local-provider](../packages/providers/local/README.md)** — Filesystem + JSON + HMAC. Default. Single-instance.
- **[@selvajs/supabase-provider](../packages/providers/supabase/README.md)** — Supabase Auth + Postgres + Storage. Multi-instance, RLS.
- **[@selvajs/header-auth-provider](../packages/providers/header-auth/README.md)** — Auth-only provider that trusts identity headers from a reverse proxy (Caddy forward_auth, oauth2-proxy, Entra, etc.). Pair with one of the data providers above.

## Deployment

- **[GCE-Linux.md](./deployment/GCE-Linux.md)** — End-to-end walkthrough for deploying a CLI-scaffolded Selva on a Linux VM (Ubuntu/GCE) behind Caddy
- **[Caddyfile.example](./deployment/Caddyfile.example)** — Reference Caddy configuration for production HTTPS deployments
- **[RhinoCompute.md](./RhinoCompute.md)** — Set up the Rhino.Compute server

After the app is up, definitions are uploaded through the admin UI — there is no on-disk setup step.

## Design / Architecture Notes

- **[ADR 0001 — Pre-Step Producers](./adr/0001-pre-step-producers.md)** — Frozen decision record. V1 shipped 2026-05-08; later sections capture future-state design that informed V1.

## Release Management

- **[Publishing.md](./Publishing.md)** — Releasing Selva's npm packages with Changesets, plus the hotfix-bypass flow and operator-side recovery for stale npm caches
