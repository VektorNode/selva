# Node.js Deployment Guide for Selva Compute App

A complete guide for deploying the Selva Compute App directly using Node.js without Docker.

---

## Overview

This guide covers deploying the Selva Compute App as a standalone Node.js application. This approach is simpler than Docker for single-server deployments and provides direct control over the Node.js process.

**When to use Node.js deployment:**

- Single server deployment
- You prefer direct process management
- Lower resource overhead is important
- You're comfortable with Node.js tooling

**When to use Docker instead:**

- Multi-container orchestration needed
- Consistent environments across dev/staging/prod
- Easy rollbacks and version management
- See [DOCKER_DEPLOYMENT_GUIDE.md](./DOCKER_DEPLOYMENT.md)

---

## Prerequisites

**IMPORTANT:** Before starting this guide, complete all prerequisites in [DEPLOYMENT_PREREQUISITES.md](./PREREQUISITES.md), including:

- Rhino.Compute server setup and testing
- Grasshopper definition files preparation
- Network and firewall configuration
- Understanding of environment variables

### Additional Node.js Requirements

- **OS**: Linux (Ubuntu 20.04+), Windows Server 2019+, or macOS
- **Node.js**: Version 20.19+ or 22+ (required)
- **pnpm**: Version 9.0+ (package manager)
- **Hardware**: Minimum 2GB RAM, 2 CPU cores (adjust based on definition complexity)

---

## 1. Server Setup & Build Preparation

Complete the common server setup steps first:

**See [SERVER_SETUP.md](./SERVER_SETUP.md) for:**

- Installing Node.js and pnpm
- SSH key setup for private repositories
- Cloning the repository
- Installing dependencies
- Building all packages

**After completing SERVER_SETUP.md, continue below.**

### Configure Firewall

See [DEPLOYMENT_PREREQUISITES.md](./PREREQUISITES.md#2-network-configuration) for detailed firewall configuration instructions.

---

## 2. Configure Environment

Navigate to the compute-app directory:

```bash
cd packages/compute-app
```

Create a `.env` file with your configuration:

```bash
# Create .env file
cat > .env << 'EOF'
COMPUTE_SERVER_URL=http://localhost:5000
GH_DEFINITIONS_PATH=./definitions
# GH_DEFINITIONS_BASE_URL=https://storage.example.com/definitions
COMPUTE_API_KEY=your-api-key-here
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
EOF
```

**Replace the following values:**

| Variable             | Replace With                      | Example                      |
| -------------------- | --------------------------------- | ---------------------------- |
| `COMPUTE_SERVER_URL` | Your Rhino.Compute server URL     | `http://compute-server:5000` |
| `COMPUTE_API_KEY`    | Your actual API key (if required) | `abc-123-secret`             |

### Environment Variable Reference

See [DEPLOYMENT_PREREQUISITES.md](./PREREQUISITES.md#3-environment-configuration) for complete environment variable documentation.

**Quick Reference:**

| Variable                  | Required | Description                | Default       |
| ------------------------- | -------- | -------------------------- | ------------- |
| `COMPUTE_SERVER_URL`      | Yes      | Rhino.Compute server URL   | None          |
| `GH_DEFINITIONS_PATH`     | Yes\*    | Local path to `.gh` files  | None          |
| `GH_DEFINITIONS_BASE_URL` | Yes\*    | Remote URL for `.gh` files | None          |
| `COMPUTE_API_KEY`         | No       | API key for compute server | None          |
| `PORT`                    | No       | Server port                | `3000`        |
| `HOST`                    | No       | Host binding               | `localhost`   |
| `NODE_ENV`                | No       | Environment mode           | `development` |

\*Use either `GH_DEFINITIONS_PATH` (local files) or `GH_DEFINITIONS_BASE_URL` (remote URL), not both.

---

## 3. Prepare Grasshopper Definitions

Create a definitions folder and add your `.gh` files:

```bash
# Create definitions directory
mkdir -p definitions

# Copy your Grasshopper files
# Option A: From local machine via SCP
scp /path/to/your/definitions/*.gh user@YOUR-SERVER-IP:~/selva/packages/compute-app/definitions/

# Option B: If files are already on server
cp /path/to/your/*.gh definitions/

# Verify files are present
ls -la definitions/
```

---

## 4. Build for Production

Set the adapter to Node.js and build the application:

```bash
# Set Node adapter and build
export ADAPTER=node
pnpm build
```

**What this does:**

- Compiles SvelteKit application for Node.js runtime
- Uses `@sveltejs/adapter-node`
- Creates a `build/` directory with production-ready code
- Optimizes assets and bundles

**Verify the build:**

```bash
# Check build directory exists
ls -la build/

# Should see:
# - index.js (main server file)
# - client/ (static assets)
# - server/ (server-side code)
```

---

## 5. Run the Application with PM2

[PM2](https://pm2.keymetrics.io/) is a production process manager for Node.js applications.

**Install PM2:**

```bash
# Install globally
sudo npm install -g pm2
```

**Start the application:**

PM2 will load environment variables from the `env` object in `ecosystem.config.cjs`:

```bash
# Start with PM2
pm2 start ecosystem.config.cjs

# View status
pm2 status

# View logs
pm2 logs selva-compute

# View real-time logs
pm2 logs selva-compute --lines 100

# Monitor CPU/memory
pm2 monit
```

**Note:** The environment variables are defined in `ecosystem.config.cjs` in the `env` object. The `.env` file is optional and serves as a reference for local development.

**Stop or restart the application:**

```bash
# Restart
pm2 restart selva-compute

# Stop
pm2 stop selva-compute

# Delete
pm2 delete selva-compute

# Restart all
pm2 restart all
```

**If port is already in use:**

```bash
# Stop all PM2 processes
pm2 stop all
pm2 delete all

# Check what's using the port
lsof -i :3000
# or
sudo netstat -tulpn | grep :3000

# Update PORT in .env if needed
# Then restart
pm2 start ecosystem.config.js
```

**Enable auto-restart on server reboot:**

```bash
# Generate startup script
pm2 startup

# Follow the command it outputs (usually requires sudo)
# Example: sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u username --hp /home/username

# Save current process list
pm2 save
```

**PM2 Commands:**

```bash
# Restart application
pm2 restart selva-compute

# Stop application
pm2 stop selva-compute

# Delete from PM2
pm2 delete selva-compute

# Monitor CPU/memory
pm2 monit

# Show detailed info
pm2 show selva-compute
```

---

## 6. Verify Deployment

### Health Check

```bash
# Local test
curl http://localhost:3000/api/health

# Remote test (from another machine)
curl http://YOUR-SERVER-IP:3000/api/health

# Expected response:
# {"status":"healthy","message":"Compute app is running"}
```

### Access the Application

Open in browser:

```
http://YOUR-SERVER-IP:3000/app?gh=your-definition-name
```

Replace:

- `YOUR-SERVER-IP` with your actual server IP or domain
- `your-definition-name` with the name of your `.gh` file (without extension)

### Test Multiple Definitions

If you have multiple `.gh` files in `definitions/`:

```
http://YOUR-SERVER-IP:3000/app?gh=solver-1
http://YOUR-SERVER-IP:3000/app?gh=parametric-design
http://YOUR-SERVER-IP:3000/app?gh=analysis-tool
```

Each query parameter loads a different Grasshopper definition.

---

## 7. Updating the Application

When you need to deploy updates:

```bash
# Navigate to repository
cd ~/selva

# Pull latest changes
git pull

# Install any new dependencies
pnpm install

# Rebuild all packages
pnpm run build:all

# Navigate to compute-app
cd packages/compute-app

# Rebuild with Node adapter
export ADAPTER=node
pnpm build

# Restart with PM2
pm2 restart selva-compute

# Monitor logs for errors
pm2 logs selva-compute --lines 50
```

### Zero-Downtime Updates

For mission-critical applications, use PM2 cluster mode:

**Update `ecosystem.config.js`:**

```javascript
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: 'build/index.js',
			instances: 2, // Run multiple instances
			exec_mode: 'cluster',
			autorestart: true
			// ... rest of config
		}
	]
};
```

**Reload without downtime:**

```bash
pm2 reload selva-compute
```

This gracefully restarts instances one at a time.

---

## 8. Monitoring and Maintenance

### View Application Logs

```bash
# Real-time logs
pm2 logs selva-compute

# Last 100 lines
pm2 logs selva-compute --lines 100

# Only error logs
pm2 logs selva-compute --err

# Log files location
~/.pm2/logs/
```

### Monitor Performance

```bash
# Real-time monitoring
pm2 monit

# Detailed status
pm2 show selva-compute

# List all processes
pm2 list
```

### Check Process Health

```bash
# Ensure PM2 is running
pm2 status

# Restart if crashed
pm2 restart selva-compute

# View crash logs
pm2 logs selva-compute --err --lines 200
```

## 9. Production Checklist

Before going live, verify:

- [ ] Node.js 20.19+ or 22+ installed
- [ ] pnpm installed globally
- [ ] All dependencies installed (`pnpm install`)
- [ ] All packages built (`pnpm run build:all`)
- [ ] `.env` file configured with production values
- [ ] Grasshopper definitions in `definitions/` folder
- [ ] Firewall allows traffic on application port
- [ ] Application builds successfully (`ADAPTER=node pnpm build`)
- [ ] Health check responds (`/api/health`)
- [ ] PM2 installed and application started
- [ ] PM2 startup script configured for auto-restart
- [ ] Logs are accessible and monitored (`pm2 logs`)
- [ ] Reverse proxy configured (nginx recommended)
- [ ] Compute server is reachable from application
- [ ] Definition files load correctly via query parameters

---

## Troubleshooting

### Application won't start

**Check PM2 logs:**

```bash
pm2 logs selva-compute --err
```

**Common causes:**
- Node.js version too old (need 20.19+ or 22+)
- Missing dependencies (`pnpm install`)
- Port already in use (change PORT in `.env`)
- Build failed (`export ADAPTER=node && pnpm build`)

### Can't reach Compute server

**Verify configuration:**

```bash
# Check .env file
cat .env | grep COMPUTE_SERVER_URL

# Test connectivity
curl http://YOUR-COMPUTE-SERVER:5000/version

# With API key (if required)
curl -H "RhinoComputeKey: your-api-key-here" http://YOUR-COMPUTE-SERVER:5000/version
```

**Common causes:**
- Wrong URL in `COMPUTE_SERVER_URL`
- Compute server not running
- Network/firewall blocking connection
- Missing API key

### Definitions not loading

**Verify files:**

```bash
# List definition files
ls -la definitions/

# Check config
cat definitions/definitions-config.json
```

**Common causes:**
- Files not in `definitions/` folder
- Filename doesn't match config (without `.gh` extension)
- Typo in query parameter (`?gh=name`)

### Port already in use

```bash
# Find what's using port 3000
lsof -i :3000

# Change port in .env
echo "PORT=3001" >> .env

# Restart PM2
pm2 restart selva-compute
```

### Node.js version too old

```bash
# Check current version
node --version

# Update (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version
```

### pnpm not found

```bash
# Install globally
sudo npm install -g pnpm

# Verify
pnpm --version
```

---

## See Also

- [Deployment Overview](./OVERVIEW.md) - Quick start and deployment paths
- [Server Setup](./SERVER_SETUP.md) - Common setup steps
- [Prerequisites](./PREREQUISITES.md) - System requirements and network setup
- [Definitions Configuration](./DEFINITIONS_SETUP.md) - Configure Grasshopper definitions
- [Docker Deployment](./DOCKER_DEPLOYMENT.md) - Alternative deployment method
