# Server Setup for Selva Compute App

The [setup.sh](../../../scripts/setup.sh) script handles everything automatically: Node.js, pnpm, cloning, dependencies, building, and PM2.

## Prerequisites

The repository is private — you need a **GitHub Classic PAT** with `repo` scope:
1. Go to GitHub → Settings → Developer settings → [Personal access tokens (classic)](https://github.com/settings/tokens)
2. Generate new token → select **`repo`** scope → copy the token

## Quick Start

```bash
# Download scripts
curl -fsSL https://raw.githubusercontent.com/VektorNode/selva/main/scripts/setup.sh -o setup.sh
curl -fsSL https://raw.githubusercontent.com/VektorNode/selva/main/scripts/setup-caddy.sh -o setup-caddy.sh

# Run — interactive by default, prompts for all values
GITHUB_TOKEN=ghp_yourtoken bash setup.sh

# Non-interactive (CI/automation) — uses env vars / defaults
GITHUB_TOKEN=ghp_yourtoken \
COMPUTE_SERVER_URL=https://your-compute.com \
ADMIN_PASSWORD=yourpassword \
ADMIN_SECRET=yoursecret \
bash setup.sh --no-interactive

# Set up Caddy reverse proxy (run after setup.sh)
bash setup-caddy.sh                           # HTTP on port 80
bash setup-caddy.sh --domain app.example.com  # HTTPS via Let's Encrypt
```

## Configuration Variables

| Variable | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | — | Classic PAT with `repo` scope |
| `COMPUTE_SERVER_URL` | `http://localhost:5000` | Rhino.Compute URL |
| `GH_DEFINITIONS_PATH` | `./example-definitions` | Path to `.gh` files |
| `COMPUTE_API_KEY` | — | Rhino.Compute API key |
| `ADMIN_PASSWORD` | — | Admin panel password |
| `ADMIN_SECRET` | — | Admin session secret |
| `PORT` | `3000` | Internal app port |
| `ORIGIN` | `http://your-server-ip` | Public-facing URL — no port suffix, no trailing slash |
| `INSTALL_DIR` | `~/selva` | Install directory |

---

## Next Steps

- **[Node.js Deployment](./NODE_DEPLOYMENT.md)** — PM2 configuration and management
- **[Docker Deployment](./DOCKER_DEPLOYMENT.md)** — Docker image setup
