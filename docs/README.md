# Documentation

## Getting Started

- **[QuickStart.md](QuickStart.md)** — Setup, development, and initial configuration
- **[MultiOrg-LocalDev.md](MultiOrg-LocalDev.md)** — Test multi-org / multi-tenant locally (works with either provider)

## Backend Providers

Selva's auth, data, and storage are pluggable. Pick one when configuring the compute-app:

- **[selva-local-provider](../packages/local-provider/README.md)** — Filesystem + JSON + HMAC. Default. Single-instance.
- **[@selva/supabase-provider](../packages/supabase-provider/README.md)** — Supabase Auth + Postgres + Storage. Multi-instance, RLS.

## Deployment

- **[Compute App Deployment](./deployment/compute-app/README.md)** — Start here for deploying the Compute App
  - [Prerequisites](./deployment/compute-app/PREREQUISITES.md) — System requirements, network, provider choice
  - [Server Setup](./deployment/compute-app/SERVER_SETUP.md) — Install tools, clone, build
  - [Node.js Deployment](./deployment/compute-app/NODE_DEPLOYMENT.md) — Deploy with PM2
  - [Reverse Proxy (Caddy)](./deployment/compute-app/REVERSE_PROXY_LOAD_BALANCER.md) — HTTPS and reverse proxy
  - [Definitions Configuration](./deployment/compute-app/DEFINITIONS_SETUP.md) — Configure Grasshopper definitions (local provider)
- **[Rhino Compute Setup](./RHINO_COMPUTE.md)** — Set up the Rhino.Compute server

## Release Management

- **[CHANGELOG.md](./CHANGELOG.md)** — Managing changelogs and versioning with Changesets
