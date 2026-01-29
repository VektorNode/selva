# Selva Automation Scripts

## Setup

```bash
bash scripts/setup.sh
```

Installs Node.js 18+, pnpm, clones repo, installs dependencies, generates `.env`, builds, and sets up PM2 with auto-restart on reboot.

For custom configuration:

```bash
bash scripts/setup.sh --interactive
```

## Update

```bash
bash scripts/update.sh
```

Pulls latest, installs dependencies, rebuilds, and restarts with zero downtime.

## Configuration

Edit `.env` in `packages/compute-app/`:

```bash
COMPUTE_SERVER_URL=http://localhost:5000
GH_DEFINITIONS_PATH=./definitions
PORT=3000
```

Restart with: `pm2 restart selva-compute --update-env`

## Essential Commands

```bash
pm2 status                              # Check status
pm2 logs selva-compute                  # View logs
pm2 restart selva-compute --update-env  # Restart with new env
pm2 stop selva-compute                  # Stop
```

## Troubleshooting

**SSH key required:** `ssh-keygen -t ed25519` and add public key to GitHub.

**Port in use:** Change `PORT` in `.env`, then `pm2 restart selva-compute --update-env`.

**Won't start:** Check `pm2 logs selva-compute` for errors.

**Missing definitions:** Add `.gh` files to `packages/compute-app/definitions/`.

**Compute server unreachable:** Verify `COMPUTE_SERVER_URL` in `.env`.
