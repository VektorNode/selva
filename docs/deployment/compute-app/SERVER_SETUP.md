# Server Setup for Selva Compute App

The [setup.sh](../../../scripts/setup.sh) script handles everything automatically: Node.js, pnpm, cloning, dependencies, building, and PM2.

## Prerequisites

The repository is private — you need **SSH access** to the GitHub repository:

1. Generate an SSH key on your server (skip if you already have one):
   ```bash
   ssh-keygen -t ed25519 -C "your-email@example.com"
   # Press Enter for all prompts
   ```
2. Display your public key:
   ```bash
   cat ~/.ssh/id_ed25519.pub
   ```
3. Add it to your GitHub account: [github.com/settings/keys](https://github.com/settings/keys) → **New SSH key**
4. Ask a maintainer to grant your GitHub account access to the repository

## Quick Start

```bash
# Download scripts
curl -fsSL https://raw.githubusercontent.com/VektorNode/selva/main/scripts/setup.sh -o setup.sh
curl -fsSL https://raw.githubusercontent.com/VektorNode/selva/main/scripts/setup-caddy.sh -o setup-caddy.sh

# Run — interactive by default, prompts for all values
bash setup.sh

# Non-interactive (CI/automation) — uses env vars / defaults
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
| `REPO_URL` | `git@github.com:VektorNode/selva.git` | Repository SSH URL |
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
