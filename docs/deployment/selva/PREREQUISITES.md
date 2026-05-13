# Deployment Prerequisites

## 1. System requirements

- **CPU**: 2 cores (4+ for complex definitions)
- **RAM**: 2 GB minimum, 4 GB+ recommended
- **Disk**: 5 GB free
- **OS**: Ubuntu 22.04 LTS recommended for production
- **Network**: stable connection to your Rhino.Compute server

## 2. External dependencies

| Dependency              | Setup                                         |
| ----------------------- | --------------------------------------------- |
| Rhino.Compute server    | [Rhino Compute Setup](../../RHINO_COMPUTE.md) |
| Grasshopper definitions | Uploaded through the admin UI after install   |

The server URL + API key are registered post-install via `/admin/compute` — not env vars.

## 3. Choose a backend provider

Selva's auth, data, and storage are pluggable. Pick one before configuring the app:

| Provider            | When to use                                                      | Setup                                                                              |
| ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Local** (default) | Single-instance deployments, dev, evaluation. Filesystem + JSON. | [@selvajs/local-provider README](../../../packages/local-provider/README.md)       |
| **Supabase**        | Multi-instance, managed auth + Postgres + storage, RLS.          | [@selvajs/supabase-provider README](../../../packages/supabase-provider/README.md) |

The provider you pick determines the env vars the app needs at runtime — see the provider's README.

## 4. Network configuration

**Internal port:** `3000` (configurable via `PORT`).

The app is designed to run behind a reverse proxy:

| Scenario                 | Setup                               | Firewall                                             |
| ------------------------ | ----------------------------------- | ---------------------------------------------------- |
| Production (recommended) | Caddy/nginx on 80/443 → app on 3000 | Allow 80/443 externally; restrict 3000 to proxy only |
| Direct exposure          | `http://yourip:3000`                | Allow 3000; no SSL/DDoS protection                   |
| Development              | `http://localhost:3000`             | None                                                 |

When behind a proxy, set `ORIGIN` to the public URL (no trailing slash) — SvelteKit's CSRF check uses it.

## 5. Generic app env vars

These apply regardless of provider:

| Variable                 | Default       | Description                                                                             |
| ------------------------ | ------------- | --------------------------------------------------------------------------------------- |
| `PORT`                   | `3000`        | Server port                                                                             |
| `HOST`                   | `0.0.0.0`     | Bind address                                                                            |
| `NODE_ENV`               | `development` | Set `production` to hide stack traces                                                   |
| `ORIGIN`                 | —             | Public URL — **required behind a reverse proxy**                                        |
| `BODY_SIZE_LIMIT`        | `150M`        | Cap for largest legitimate request (.gh + image). Suffix is K/M/G — `150mb` won't parse |
| `ALLOW_INSECURE_COOKIES` | —             | Set `true` for HTTP-only deployments (dev/testing)                                      |
