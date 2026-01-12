# Node.js Deployment Guide for Selva Compute App

Deploy the Selva Compute App using Node.js and PM2 for direct process management.

**Prerequisites:** Complete [SERVER_SETUP.md](./SERVER_SETUP.md) and [PREREQUISITES.md](./PREREQUISITES.md) first.

**Requirements:** Node.js 20.19+, pnpm 9.0+, 2GB RAM, 2 CPU cores

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
	ORIGIN: 'http://your-public-ip',              // Required
	COMPUTE_SERVER_URL: 'http://compute-server',  // Required
	GH_DEFINITIONS_PATH: './definitions',
	COMPUTE_API_KEY: 'your-key-if-needed',
	NODE_ENV: 'production'
}
```

**Required variables:**
- `ORIGIN` - Public URL for CSRF checks
- `COMPUTE_SERVER_URL` - Rhino.Compute server address
- Use either `GH_DEFINITIONS_PATH` (local) or `GH_DEFINITIONS_BASE_URL` (remote), not both

---

## PM2 Commands

```bash
pm2 start ecosystem.config.cjs      # Start
pm2 status                          # Check status
pm2 logs selva-compute              # View logs
pm2 restart selva-compute           # Restart
pm2 stop selva-compute              # Stop
pm2 delete selva-compute            # Remove

# Auto-restart on reboot
pm2 startup
pm2 save
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
curl http://YOUR-COMPUTE-SERVER:5000/version
# Verify COMPUTE_SERVER_URL and firewall rules
```

**Definitions not loading:**
```bash
ls -la definitions/
# Check filenames match query parameters
```

**Node.js too old:**
```bash
node --version  # Need 20.19+
# Update: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

---

## See Also

- [Deployment Overview](./OVERVIEW.md)
- [Server Setup](./SERVER_SETUP.md)
- [Prerequisites](./PREREQUISITES.md)
- [Docker Deployment](./DOCKER_DEPLOYMENT.md)
