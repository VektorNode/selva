# Setup Script

Automated setup for Selva Compute App from zero to production-ready.

## Quick Start

```bash
bash scripts/setup.sh
```

Handles:
- Node.js 18+ (auto-installs if missing)
- pnpm 9+ (auto-installs if missing)
- Repository cloning
- Dependencies
- Environment configuration (`.env`)
- Production build
- PM2 setup with auto-restart on reboot

## Interactive Mode

```bash
bash scripts/setup.sh --interactive
```

Prompts for custom values:
- Definitions source (filesystem or environment)
- Path to definitions directory
- Rhino.Compute server URL
- API key (optional)
- Port
- Public origin URL (auto-detected from public IP)

## Skip PM2

```bash
bash scripts/setup.sh --skip-pm2
```

Useful if you want to manage the app differently (systemd, Docker, etc.).

## Custom Install Directory

```bash
INSTALL_DIR=/opt/selva bash scripts/setup.sh
```

## What Gets Created

- `.env` - Environment configuration
- `ecosystem.config.cjs` - PM2 configuration
- `definitions/` - Directory for `.gh` files
- Built application in `packages/compute-app/build/`

## Access the App

Once running:

```bash
# Health check
curl http://<server-ip>:3000/api/health

# App with definition
http://<server-ip>:3000/app?gh=definition-name
```

## Common Issues

**Port already in use:** Edit `.env`, change `PORT`, then restart:
```bash
pm2 restart selva-compute --update-env
```

**SSH key not found:** Set up GitHub SSH key first:
```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
# Add public key to GitHub settings
```

**Check logs:**
```bash
pm2 logs selva-compute
```

## PM2 Management

```bash
pm2 status                              # Check status
pm2 logs selva-compute                  # View logs
pm2 restart selva-compute --update-env  # Restart with new env
pm2 stop selva-compute                  # Stop
pm2 start ecosystem.config.cjs          # Start
```

## Manual Start (without PM2)

```bash
cd ~/selva/packages/compute-app
npm start
```
