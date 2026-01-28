# Selva Automation Scripts

Complete automation for deployment and updates with zero manual configuration.

## Quick Start (Recommended)

### Linux/macOS

```bash
bash scripts/setup.sh
```

That's it! The script handles everything:
- ✅ Checks/installs Node.js 18+
- ✅ Checks/installs pnpm
- ✅ Clones repository (if needed)
- ✅ Installs dependencies
- ✅ Generates `.env` configuration
- ✅ Builds application
- ✅ Sets up PM2 for production
- ✅ Auto-restart on reboot

### Windows

```cmd
scripts\setup.bat
```

Same features as Linux version.

---

## Interactive Configuration

Want to set custom values? Use interactive mode:

```bash
bash scripts/setup.sh --interactive
```

Prompts for:
- Definitions source (filesystem or environment)
- Compute server URL
- API key (optional)
- Port and origin URL

---

## Updates

### Linux/macOS

```bash
bash scripts/update.sh
```

Automatically:
- Pulls latest changes
- Installs updated dependencies
- Rebuilds everything
- Restarts with PM2 (zero downtime)
- Health checks the app

### Windows

```cmd
scripts\update.bat
```

---

## What Gets Automated

### Setup Process

1. **System Requirements**
   - Node.js 18+ (auto-installs if missing)
   - pnpm 9.0+ (auto-installs if missing)
   - git (required, must be pre-installed)

2. **Repository**
   - Clones from GitHub via SSH (requires SSH key)
   - Default location: `$HOME/selva` (Linux/macOS) or `%USERPROFILE%\selva` (Windows)

3. **Dependencies**
   - Runs `pnpm install` on entire monorepo

4. **Environment Configuration**
   - Creates `.env` file in `packages/compute-app/`
   - Sets reasonable defaults:
     - `COMPUTE_SERVER_URL=http://localhost:5000`
     - `GH_DEFINITIONS_PATH=./definitions`
     - `PORT=3000`
     - `BODY_SIZE_LIMIT=Infinity`

5. **Builds**
   - `pnpm run build:all` - All packages
   - `ADAPTER=node pnpm build` - Production Node.js build

6. **PM2 Setup**
   - Installs PM2 globally
   - Creates `ecosystem.config.cjs`
   - Starts application: `pm2 start ecosystem.config.cjs`
   - Auto-restart on reboot: `pm2 startup` + `pm2 save`

### Update Process

1. Fetches latest from GitHub
2. Checks if updates exist
3. Pulls changes
4. Updates dependencies
5. Rebuilds everything
6. Restarts application with PM2 (no downtime!)
7. Health checks the application

---

## SSH Key Setup (Required)

Both scripts assume you have SSH access to GitHub. Before running:

```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -C "your-email@example.com"

# Add to GitHub: https://github.com/settings/keys

# Test connection
ssh -T git@github.com
```

---

## Configuration Files

### `.env` (Auto-generated)

```bash
# Definitions source
DEFINITION_SOURCE="filesystem"
GH_DEFINITIONS_PATH="./definitions"

# Rhino.Compute server
COMPUTE_SERVER_URL="http://localhost:5000"
COMPUTE_API_KEY="your-key"  # Optional

# Server
PORT=3000
BODY_SIZE_LIMIT="Infinity"
```

Edit directly to change settings, then restart:

```bash
pm2 restart selva-compute --update-env
```

### `ecosystem.config.cjs` (Auto-generated)

PM2 configuration. Don't edit directly unless you know what you're doing.

Manage with:

```bash
pm2 restart selva-compute --update-env
pm2 logs selva-compute
pm2 status
```

---

## Custom Installation Directory

Change where the app installs:

```bash
# Linux/macOS
INSTALL_DIR=/opt/selva bash scripts/setup.sh

# Windows
set INSTALL_DIR=C:\Apps\selva
scripts\setup.bat
```

---

## Skip PM2 Setup

If you want to manage the app differently (systemd, Docker, etc.):

```bash
bash scripts/setup.sh --skip-pm2
```

Then start manually:

```bash
cd ~/selva/packages/compute-app
npm start
```

---

## Accessing the Application

Once running with PM2:

```bash
# Health check
curl http://localhost:3000/api/health

# App with definition
http://localhost:3000/app?gh=definition-name
```

---

## Common PM2 Commands

```bash
# Status
pm2 status

# View logs (live)
pm2 logs selva-compute

# View logs (last 20 lines)
pm2 logs selva-compute --lines 20

# Restart with new env vars
pm2 restart selva-compute --update-env

# Stop
pm2 stop selva-compute

# Start
pm2 start ecosystem.config.cjs

# Remove from PM2
pm2 delete selva-compute

# Auto-restart on reboot
pm2 startup    # Follow instructions
pm2 save
```

---

## Troubleshooting

### "git not found"

Install git from https://git-scm.com/

### "SSH key not found"

Set up SSH key:

```bash
ssh-keygen -t ed25519 -C "your-email@example.com"
ssh-add ~/.ssh/id_ed25519
# Then add public key to GitHub settings
```

### "pnpm install hangs"

Might be network issue. Try:

```bash
pnpm install --no-frozen-lockfile
```

### Application won't start

Check logs:

```bash
pm2 logs selva-compute
```

Common issues:
- Port already in use: Change `PORT` in `.env`, restart with `pm2 restart selva-compute --update-env`
- Missing definitions: Add `.gh` files to `packages/compute-app/definitions/`
- Compute server unreachable: Check `COMPUTE_SERVER_URL` in `.env`

### Health check fails

Server might still be starting:

```bash
pm2 logs selva-compute
sleep 5
curl http://localhost:3000/api/health
```

---

## Directory Structure

After setup:

```
~/selva/                                 # Installation dir
├── scripts/                             # This folder
│   ├── setup.sh                        # Setup script (Linux)
│   ├── update.sh                       # Update script (Linux)
│   ├── setup.bat                       # Setup script (Windows)
│   ├── update.bat                      # Update script (Windows)
│   └── README.md                       # This file
├── packages/
│   └── compute-app/
│       ├── .env                        # Auto-generated config
│       ├── ecosystem.config.cjs        # Auto-generated PM2 config
│       ├── definitions/                # Your .gh files go here
│       └── build/                      # Production build
└── ...
```

---

## Advanced: Manual Workflow

If you prefer not to use the automation:

```bash
# 1. Clone
git clone git@github.com:VektorNode/selva.git
cd selva

# 2. Install dependencies
pnpm install

# 3. Create .env
cp packages/compute-app/.env.example packages/compute-app/.env
# Edit .env with your config

# 4. Build
pnpm run build:all
cd packages/compute-app && ADAPTER=node pnpm build

# 5. Start with PM2
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 startup
pm2 save

# 6. Later, to update
cd ~/selva
git pull
pnpm install
pnpm run build:all
cd packages/compute-app && ADAPTER=node pnpm build
pm2 restart selva-compute --update-env
```

---

## Scripts Source Code

Both scripts are fully transparent and safe:
- `setup.sh` - ~450 lines, handles first-time setup
- `update.sh` - ~150 lines, handles updates
- `setup.bat` - ~400 lines, Windows equivalent
- `update.bat` - ~150 lines, Windows equivalent

Read the source to understand exactly what's happening.

---

## Features

✅ Zero manual configuration
✅ Auto-installs missing dependencies
✅ SSH key authentication (secure)
✅ PM2 auto-restart on reboot
✅ Zero-downtime updates
✅ Health checks
✅ Detailed logging and status
✅ Cross-platform (Linux/macOS/Windows)
✅ Custom installation directory
✅ Optional interactive configuration

---

## Support

If scripts fail:

1. Read error message carefully
2. Check logs: `pm2 logs selva-compute`
3. Run manually and see what breaks
4. Check GitHub issues: https://github.com/VektorNode/selva/issues

Report issues with:
- Output of failed script
- Output of `node -v`, `pnpm -v`, `git --version`
- Output of `pm2 logs selva-compute` (if PM2 started)
