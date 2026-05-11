# Server Setup for Selva Compute App

The [setup.sh](../../../scripts/setup.sh) script handles everything automatically: Node.js, pnpm, cloning, dependencies, building, and PM2.

⚠️ **Note:** The setup script requires `sudo` privileges for installing Node.js, pnpm, PM2, and configuring auto-restart on reboot. Run the script with `sudo` or ensure your user has passwordless sudo access for npm/package manager commands.

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
SELVA_HMAC_KEY=yoursecret SELVA_AT_REST_KEY=$(openssl rand -hex 32) \
bash setup.sh --no-interactive

# After setup, create the first admin user via the in-app setup page,
# then register your Rhino.Compute server at /admin/compute

# Set up Caddy reverse proxy (run after setup.sh)
bash setup-caddy.sh                           # HTTP on port 80
bash setup-caddy.sh --domain app.example.com  # HTTPS via Let's Encrypt
```

## Configuration Variables

`setup.sh` defaults to the **local provider**. Provider-specific vars (`DATA_PATH`, `SELVA_HMAC_KEY`, `SELVA_AT_REST_KEY`) are documented in the [@selvajs/local-provider README](../../../packages/local-provider/README.md). For Supabase, see the [@selvajs/supabase-provider README](../../../packages/supabase-provider/README.md).

Vars `setup.sh` itself reads:

| Variable         | Default                               | Description                                                                                       |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `REPO_URL`       | `git@github.com:VektorNode/selva.git` | Repository SSH URL                                                                                |
| `DATA_PATH`      | `../../.selva-data`                   | Local provider data directory, relative to `packages/compute-app/` (resolves to `.selva-data/` at the repo root). |
| `SELVA_HMAC_KEY`     | auto-generated                    | HMAC signing key for sessions + share/invite tokens (local provider only)                         |
| `SELVA_AT_REST_KEY`  | auto-generated                    | AES key encrypting the Rhino.Compute API key at rest (local provider only)                        |
| `PORT`           | `3000`                                | Internal app port                                                                                 |
| `ORIGIN`         | `http://your-server-ip`               | Public-facing URL — no port suffix, no trailing slash                                             |
| `INSTALL_DIR`    | `~/selva`                             | Install directory                                                                                 |

Rhino.Compute URL + API key are configured post-install via the admin dashboard
(`/admin/compute`), not env vars.

---

## Next Steps

- **[Node.js Deployment](./NODE_DEPLOYMENT.md)** — PM2 configuration and management
