# Node.js Deployment Guide for Selva Compute App

Deploy the Selva Compute App using Node.js and PM2 for direct process management.

**Prerequisites:** Complete [SERVER_SETUP.md](./SERVER_SETUP.md) and [PREREQUISITES.md](./PREREQUISITES.md) first.

---

## Quick Start

```bash
# 1. Configure environment
cd packages/compute-app
nano ecosystem.config.cjs  # Update ORIGIN, COMPUTE_SERVER_URL, etc.

# 2. Add Grasshopper definitions
mkdir -p definitions
cp /path/to/your/*.gh definitions/

# 3. Build for production
export ADAPTER=node
pnpm build

# 4. Install and start PM2
sudo npm install -g pm2
pm2 start ecosystem.config.cjs

# 5. Test
curl http://localhost:3000/api/health
```

---

## Configuration

Edit `packages/compute-app/ecosystem.config.cjs`:

```javascript
env: {
	PORT: 3000,
	ORIGIN: 'http://your-public-ip',              // Recommended (required for strict origin/CSRF setups)
	COMPUTE_SERVER_URL: 'http://compute-server',
	GH_DEFINITIONS_PATH: './definitions',
	COMPUTE_API_KEY: 'your-key-if-needed',
	NODE_ENV: 'production'
}
```

**Required variables:**

- `COMPUTE_SERVER_URL` - Rhino.Compute server address
- `COMPUTE_API_KEY` - API key for your compute server
- Use either `GH_DEFINITIONS_PATH` (local) or `GH_DEFINITIONS_BASE_URL` (remote), not both

**Recommended for production:**

- `ORIGIN` - Public URL for origin/CSRF checks

---

## PM2 Commands

```bash
pm2 start ecosystem.config.cjs      # Start
pm2 status                          # Check status
pm2 logs selva-compute              # View logs
pm2 restart selva-compute           # Restart
pm2 restart selva-compute --update-env  # Restart with updated environment variables
pm2 stop selva-compute              # Stop
pm2 delete selva-compute            # Remove

# Auto-restart on reboot
pm2 startup
pm2 save
```

**Important:** When updating environment variables in `ecosystem.config.cjs`, use `--update-env` to reload them:

```bash
pm2 restart selva-compute --update-env
```

---

## Access the Application

```
http://YOUR-SERVER-IP:3000/app?gh=definition-name
```

Test health: `curl http://YOUR-SERVER-IP:3000/api/health`

---

## Updating

```bash
cd ~/selva
git pull
pnpm install
pnpm run build:all
cd packages/compute-app
export ADAPTER=node && pnpm build
pm2 restart selva-compute
```

---

## Common Issues

**Port already in use:**

```bash
lsof -i :3000
# Change PORT in ecosystem.config.cjs and restart
```

**Can't reach Compute server:**

```bash
curl http://YOUR-COMPUTE-SERVER/health
# Verify COMPUTE_SERVER_URL and firewall rules
```

**Definitions not loading:**

```bash
ls -la definitions/
# Check filenames match query parameters
```

**Request body size limit exceeded:**

If you see errors like `Content-length of 1715807 exceeds limit of 524288 bytes`, increase the body size limit:

```bash
# Edit ecosystem.config.cjs and add/update:
env: {
  BODY_SIZE_LIMIT: "Infinity"  # or "50mb", "100MB", etc.
}

# Restart with updated environment
pm2 restart selva-compute --update-env
```

This error occurs when uploading large geometry files that exceed the default 512KB limit.
