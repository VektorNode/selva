# Documentation

## Getting Started

- **[QuickStart.md](QuickStart.md)** — Setup, development, and initial configuration
- **[MultiOrg-LocalDev.md](MultiOrg-LocalDev.md)** — Test multi-org / multi-tenant locally (works with either provider)
- **[Turborepo.md](Turborepo.md)** — How tasks are wired across the monorepo

## Backend Providers

Selva's auth, data, and storage are pluggable. Pick one when configuring the compute-app:

- **[@selvajs/local-provider](../packages/local-provider/README.md)** — Filesystem + JSON + HMAC. Default. Single-instance.
- **[@selvajs/supabase-provider](../packages/supabase-provider/README.md)** — Supabase Auth + Postgres + Storage. Multi-instance, RLS.

## Deployment

- **[Compute App Deployment](./deployment/compute-app/README.md)** — Start here for deploying the Compute App
  - [Prerequisites](./deployment/compute-app/PREREQUISITES.md) — System requirements, network, provider choice
  - [Server Setup](./deployment/compute-app/SERVER_SETUP.md) — Install tools, clone, build
  - [Node.js Deployment](./deployment/compute-app/NODE_DEPLOYMENT.md) — Deploy with PM2
  - [Reverse Proxy (Caddy)](./deployment/compute-app/REVERSE_PROXY_LOAD_BALANCER.md) — HTTPS and reverse proxy
- **[Rhino Compute Setup](./RHINO_COMPUTE.md)** — Set up the Rhino.Compute server

After the app is up, definitions are uploaded through the admin UI — there is no on-disk setup step.

## Release Management

- **[Releasing.md](./Releasing.md)** — Managing changelogs and versioning with Changesets
