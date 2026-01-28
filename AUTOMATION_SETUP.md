# Complete Automation Setup for Selva Deployment

This guide covers the fully automated setup and update workflow for deploying Selva Compute App to production.

## Overview

Two scripts handle everything:

1. **`scripts/setup.sh`** - First-time installation (10-15 min, fully automated)
2. **`scripts/update.sh`** - Pull latest, rebuild, restart (2-3 min, zero downtime)

## Prerequisites

Before running the scripts, you need:

1. **SSH access to GitHub**
   - Generate key: `ssh-keygen -t ed25519 -C "your-email@example.com"`
   - Add to GitHub: https://github.com/settings/keys
   - Test: `ssh -T git@github.com`

2. **That's it!** Everything else installs automatically.

---

## Initial Setup (First Time)

### Step 1: SSH to Your Server

```bash
ssh user@your-server.com
```

### Step 2: Run Setup Script

```bash
bash <(curl -fsSL https://github.com/VektorNode/selva/raw/main/scripts/setup.sh)
```

**Or locally:**

```bash
cd /path/to/selva
bash scripts/setup.sh
```

### Step 3: What Gets Installed

✅ **Node.js 18+** - If not found, auto-installs via apt/brew/yum
✅ **pnpm 9+** - If not found, auto-installs via npm
✅ **Repository** - Clones to `$HOME/selva`
✅ **Dependencies** - `pnpm install` on entire monorepo
✅ **.env Configuration** - Auto-generated with sensible defaults
✅ **Production Build** - Optimized Node.js build
✅ **PM2 Manager** - Process management with auto-restart
✅ **Systemd Integration** - Auto-start on server reboot

### Step 4: The Script Will Prompt You (Optional)

Use interactive mode for custom settings:

```bash
bash scripts/setup.sh --interactive
```

Asks for:
- Grasshopper definitions source (filesystem or environment)
- Rhino.Compute server URL (default: http://localhost:5000)
- API key for Compute (optional)
- Port number (default: 3000)
- Public origin URL

Or just press Enter 5 times to accept defaults.

### Step 5: Add Your Grasshopper Definitions

Copy `.gh` files to:

```bash
~/selva/packages/compute-app/definitions/
```

Then restart:

```bash
pm2 restart selva-compute --update-env
```

### Step 6: Verify It Works

```bash
# Health check
curl http://localhost:3000/api/health

# View app logs
pm2 logs selva-compute

# Check status
pm2 status
```

---

## Ongoing Updates

### Update Every Time There's a New Version

```bash
bash ~/selva/scripts/update.sh
```

**Automatically:**
1. Fetches latest changes
2. Checks if updates exist
3. Installs new dependencies
4. Rebuilds everything
5. Restarts application (zero downtime via PM2)
6. Health checks the service

**Takes 2-3 minutes.**

---

## What's in `.env`?

Auto-generated configuration file. Edit manually if needed:

```bash
# Grasshopper definitions source
DEFINITION_SOURCE="filesystem"
GH_DEFINITIONS_PATH="./definitions"

# Rhino.Compute server (internal only)
COMPUTE_SERVER_URL="http://localhost:5000"
COMPUTE_API_KEY="your-key"  # Optional

# Server configuration
PORT=3000

# Large file support
BODY_SIZE_LIMIT="Infinity"
```

After editing, restart:

```bash
pm2 restart selva-compute --update-env
```

---

## Directory Structure

After setup:

```
~/selva/
├── scripts/
│   ├── setup.sh          ← Run once for initial setup
│   ├── update.sh         ← Run periodically for updates
│   └── README.md         ← Detailed documentation
├── packages/
│   └── compute-app/
│       ├── .env          ← Configuration (auto-generated)
│       ├── ecosystem.config.cjs  ← PM2 config (auto-generated)
│       ├── definitions/  ← Your .gh files
│       └── build/        ← Production build
└── ...other files...
```

---

## PM2 Management

Check what PM2 can do:

```bash
# See if app is running
pm2 status

# View live logs
pm2 logs selva-compute

# Restart (useful after config changes)
pm2 restart selva-compute --update-env

# View last 50 lines of logs
pm2 logs selva-compute --lines 50

# Stop the app
pm2 stop selva-compute

# Start the app
pm2 start ecosystem.config.cjs

# Remove from PM2
pm2 delete selva-compute

# View detailed info
pm2 describe selva-compute
```

---

## Monitoring & Logs

### View Real-Time Logs

```bash
pm2 logs selva-compute
```

Press `Ctrl+C` to exit.

### View Last 20 Lines

```bash
pm2 logs selva-compute --lines 20
```

### Check if App is Healthy

```bash
curl http://localhost:3000/api/health
```

Should return HTTP 200 if running.

### View Application Status

```bash
pm2 status
```

Shows:
- App name
- Status (online/stopped/error)
- Uptime
- Restarts
- Memory usage

---

## Troubleshooting

### "SSH key not found"

Set up SSH:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
ssh-add ~/.ssh/id_ed25519
```

Then add public key to GitHub: https://github.com/settings/keys

### "git not found"

Install git:

```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y git

# RedHat/CentOS
sudo yum install -y git

# macOS
brew install git
```

### "Port 3000 already in use"

Use a different port:

1. Edit `~/.selva/packages/compute-app/.env`
2. Change `PORT=3000` to `PORT=3001`
3. Restart: `pm2 restart selva-compute --update-env`

### "Can't reach Compute server"

Check URL in `.env`:

```bash
# Edit configuration
nano ~/selva/packages/compute-app/.env

# Should be accessible from server running the app
curl http://your-compute-server:5000/health

# Restart after changing
pm2 restart selva-compute --update-env
```

### "Definitions not loading"

Check if files exist:

```bash
ls -la ~/selva/packages/compute-app/definitions/
```

Should see your `.gh` files. If not, copy them there.

### "Application won't start"

Check logs:

```bash
pm2 logs selva-compute
```

Common errors:
- Port already in use → Change PORT in .env
- Missing definitions → Copy .gh files to definitions/
- Can't reach Compute server → Check COMPUTE_SERVER_URL
- Out of memory → Check: `pm2 describe selva-compute`

---

## Advanced: Manual Control

If you prefer not to use PM2:

```bash
# Run directly
cd ~/selva/packages/compute-app
npm start

# Stop with Ctrl+C
```

But **PM2 is recommended** for:
- Auto-restart on crashes
- Auto-start on reboot
- Easy log management
- Process monitoring
- Zero-downtime restarts

---

## Custom Installation Directory

Install to different location:

```bash
INSTALL_DIR=/opt/selva bash scripts/setup.sh
```

Then all subsequent commands:

```bash
INSTALL_DIR=/opt/selva bash scripts/update.sh
```

---

## Skip PM2 Setup

If you manage the app differently (systemd, Docker, etc.):

```bash
bash scripts/setup.sh --skip-pm2
```

Then start manually:

```bash
cd ~/selva/packages/compute-app
npm start
```

---

## Security Notes

1. **Never commit `.env`** - It contains API keys
   - Already ignored in `.gitignore`

2. **SSH key access required** - For cloning from GitHub
   - Use SSH, not HTTPS (more secure, no credentials in URL)

3. **Compute API key stored locally** - On the server only
   - Never exposed to web clients
   - Only used for server→Compute communication

4. **No credentials in ecosystem.config.cjs** - It's safe to version control
   - Sensitive values in `.env` only

---

## What the Scripts Do (Transparency)

### setup.sh (~450 lines)

1. Checks system requirements (Node.js, pnpm, git)
2. Auto-installs missing dependencies
3. Clones repository (if needed)
4. Runs `pnpm install`
5. Creates `.env` from defaults or user input
6. Runs `pnpm run build:all`
7. Builds compute-app for Node.js
8. Installs PM2 globally
9. Creates `ecosystem.config.cjs`
10. Starts application with `pm2 start`
11. Sets up auto-restart on reboot

### update.sh (~150 lines)

1. Checks current git status
2. Fetches latest from GitHub
3. Checks if updates exist
4. Pulls changes
5. Runs `pnpm install`
6. Runs `pnpm run build:all`
7. Builds compute-app
8. Restarts with PM2
9. Health checks the app
10. Reports status

**Both scripts are fully transparent.** Read the source to verify they're safe!

---

## Examples

### Complete Fresh Installation

```bash
# SSH to server
ssh user@server.com

# Run setup (all automated)
bash <(curl -fsSL https://github.com/VektorNode/selva/raw/main/scripts/setup.sh)

# Add your definitions
scp my-definition.gh user@server.com:~/selva/packages/compute-app/definitions/

# Check it works
curl http://server.com:3000/api/health
```

### Weekly Update Routine

```bash
# SSH to server
ssh user@server.com

# Update (2 minutes, zero downtime)
bash ~/selva/scripts/update.sh

# Check health
curl http://server.com:3000/api/health
```

### Monitor Application

```bash
# SSH to server
ssh user@server.com

# View live logs
pm2 logs selva-compute

# Check status
pm2 status
```

### Emergency Restart

```bash
pm2 restart selva-compute --update-env
```

### Emergency Stop

```bash
pm2 stop selva-compute
```

### Start After Stop

```bash
pm2 start ecosystem.config.cjs
```

---

## Architecture

```
GitHub (git@github.com:VektorNode/selva.git)
    ↓ [SSH clone]
~/selva/
    ├── .env (auto-generated)
    ├── ecosystem.config.cjs (auto-generated, PM2 managed)
    └── packages/compute-app/
        ├── build/ (production build)
        └── definitions/ (your .gh files)

PM2 manages process
    ↓
Node.js server (port 3000)
    ↓
Rhino.Compute (port 5000)
```

---

## Support

If something breaks:

1. **Check logs first:** `pm2 logs selva-compute`
2. **Test Compute server:** `curl http://your-compute:5000/health`
3. **Test definitions:** `ls ~/selva/packages/compute-app/definitions/`
4. **Check .env:** `cat ~/selva/packages/compute-app/.env`
5. **Report issue:** https://github.com/VektorNode/selva/issues

Include:
- Script output (copy/paste)
- `pm2 logs selva-compute` (last 20 lines)
- `pm2 status` output
- `node -v`, `pnpm -v`, `git --version` output

---

**You now have a fully automated, production-grade Selva Compute App deployment with zero manual configuration and zero-downtime updates!**
