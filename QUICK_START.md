# Selva Compute App - Quick Start Guide

**TL;DR**: Run one script, get production-ready app with PM2.

## 30-Second Setup (Linux/macOS)

```bash
bash scripts/setup.sh
```

Wait 5-10 minutes. Done! App runs on http://localhost:3000

## 30-Second Setup (Windows)

```cmd
scripts\setup.bat
```

## What Happens Automatically

✅ Installs Node.js if missing
✅ Installs pnpm if missing
✅ Clones repository
✅ Installs all dependencies
✅ Creates `.env` configuration
✅ Builds everything for production
✅ Sets up PM2 process manager
✅ Auto-restarts on reboot

## Next: Add Your Definitions

Copy your `.gh` files to:

```
~/selva/packages/compute-app/definitions/
```

Restart (if running):

```bash
pm2 restart selva-compute --update-env
```

## Test It

```bash
# Health check
curl http://localhost:3000/api/health

# App with definition
http://localhost:3000/app?gh=my-definition
```

## Update Later

```bash
bash scripts/update.sh
```

Pulls latest, rebuilds, restarts (zero downtime).

## Check Status

```bash
pm2 status
pm2 logs selva-compute
```

## Need Custom Config?

Edit `.env` manually:

```bash
nano ~/selva/packages/compute-app/.env
```

Restart:

```bash
pm2 restart selva-compute --update-env
```

## Requires

- ✅ SSH access to GitHub (generate key if needed)
- ✅ `git` command-line tool

---

## More Info

- Full docs: [scripts/README.md](scripts/README.md)
- Original deployment guide: [docs/deployment/compute-app/NODE_DEPLOYMENT.md](docs/deployment/compute-app/NODE_DEPLOYMENT.md)
- Issue? Check: [pm2 logs selva-compute]

---

**That's it.** You now have a production-grade Selva Compute App with automatic restarts and zero-downtime updates.
