# Deployment Prerequisites for Selva Compute App

This document covers the common prerequisites and setup requirements needed before deploying the Selva Compute App, whether using Node.js directly or Docker.

---

## Overview

The Selva Compute App requires two critical external dependencies to function:

1. **Rhino.Compute Server** - Performs the actual Grasshopper definition solving. See [Compute Guide](../../RHINO_COMPUTE.md).
2. **Grasshopper Definition Files (.gh)** - Define your application logic. See [Definition Setup](./DEFINITIONS_SETUP.md).

## 1. System Requirements

### Minimum Hardware

- **CPU**: 2 cores
- **RAM**: 2GB (4GB+ recommended for complex definitions)
- **Disk**: 5GB free space
- **Network**: Stable connection to Rhino.Compute server

**Recommended:** Linux (Ubuntu 22.04 LTS) for production deployments

---

## 2. Network Configuration

### Port Setup

**Internal Application Port:**

- Default: 3000 (configurable via `PORT` environment variable)
- Compute Server: Typically 5000 (configured separately in Rhino.Compute)
- Dev Mode WebSocket: 8765 (dev only, not needed in production)

**External Access:**

The app is designed to run behind a **reverse proxy** (recommended for production):

| Scenario                     | Setup                                     | Firewall                                             |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| **Development**              | Direct: `http://localhost:3000`           | No changes needed                                    |
| **Production (Recommended)** | Behind nginx/caddy on 80/443, app on 3000 | Allow 80/443 externally, restrict 3000 to proxy only |
| **Direct Exposure**          | `http://yourip:3000` (not recommended)    | Allow 3000 externally (no SSL/DDoS protection)       |

**If using a reverse proxy**, set the `ORIGIN` environment variable to your public URL (e.g., `ORIGIN=https://yourapp.com`).

## 3. Environment Configuration

The Compute App is configured via environment variables. Set these during deployment using `.env` files or deployment configs (e.g., `ecosystem.config.cjs`).

### Required Variables

| Variable             | Description                      | Example                   |
| -------------------- | -------------------------------- | ------------------------- |
| `COMPUTE_SERVER_URL` | URL of your Rhino.Compute server | `http://your-compute.com` |

### Definition Source (choose one)

The app auto-detects the definition source. Configure via one of:

- **Filesystem (default):** Set `GH_DEFINITIONS_PATH` to a local folder containing `definitions-config.json`
- **Environment Variables:** Set `DEFINITION_SOURCE=environment` and define `GH_DEF_*` variables (for cloud/serverless)

See [Definitions Setup](./DEFINITIONS_SETUP.md) for detailed configuration.

### Optional Variables

| Variable          | Description                                                   | Default       |
| ----------------- | ------------------------------------------------------------- | ------------- |
| `COMPUTE_API_KEY` | API key for compute server (sent as RhinoComputeKey header)   | None          |
| `GH_DEF_PREFIX`   | Prefix for env var definitions (only if using env var source) | `GH_DEF_`     |
| `PORT`            | Server port                                                   | `3000`        |
| `HOST`            | Host binding                                                  | `localhost`   |
| `NODE_ENV`        | Environment mode                                              | `development` |
| `ORIGIN`          | Public URL used for origin/CSRF checks (recommended in prod)  | None          |

---

## Next Steps

After reviewing the prerequisites, proceed to set up your server environment:

1. **[Server Setup](./SERVER_SETUP.md)** - Install tools, clone the repository, and build the project.
2. **Choose a Deployment Method:**
   - **[Node.js Deployment Guide](./NODE_DEPLOYMENT.md)** - Direct Node.js deployment with PM2
   - **[Docker Deployment Guide](./DOCKER_DEPLOYMENT.md)** - Container-based deployment
