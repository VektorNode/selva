# Deployment Prerequisites

The Selva Compute App requires two external dependencies:

1. **Rhino.Compute Server** — See [Rhino Compute Setup](../../RHINO_COMPUTE.md)
2. **Grasshopper Definition Files (.gh)** — See [Definitions Setup](./DEFINITIONS_SETUP.md)

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

### Rhino.Compute Server

Compute server URL and API key are configured in the admin dashboard
(`/admin/compute`) — not env vars. The config is persisted by the active data
provider (filesystem JSON or Supabase Postgres).

### Definition Source

Set `GH_DEFINITIONS_PATH` to a local folder containing your `.gh` files and `definitions-config.json`.

See [Definitions Setup](./DEFINITIONS_SETUP.md) for details.

### Optional Variables

| Variable   | Description                                             | Default       |
| ---------- | ------------------------------------------------------- | ------------- |
| `PORT`     | Server port                                             | `3000`        |
| `HOST`     | Host binding                                            | `localhost`   |
| `NODE_ENV` | Environment mode                                        | `development` |
| `ORIGIN`   | Public URL for origin/CSRF checks (recommended in prod) | None          |
