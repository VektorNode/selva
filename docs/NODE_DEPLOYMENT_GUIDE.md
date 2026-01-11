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
- See [DOCKER_DEPLOYMENT_GUIDE.md](./DOCKER_DEPLOYMENT_GUIDE.md)

---

## Prerequisites

Before deploying, ensure you have:

### System Requirements

- **OS**: Linux (Ubuntu 20.04+), Windows Server 2019+, or macOS
- **Node.js**: Version 20.19+ or 22+ (required)
- **pnpm**: Version 9.0+ (package manager)
- **Hardware**: Minimum 2GB RAM, 2 CPU cores (adjust based on definition complexity)

### External Dependencies

- **Rhino.Compute Server**: Running and accessible instance
  - Server URL and port (e.g., `https://vektornode-compute.ch/`)
  - Optional API key if authentication is required
  - See [Rhino.Compute Documentation](https://developer.rhino3d.com/guides/compute/deployment/)
  - Custom fork: [VektorNode/compute.rhino3d](https://github.com/VektorNode/compute.rhino3d)

- **Grasshopper Definition Files**: Your `.gh` files that define the application logic
  - Place in a `definitions/` folder
  - Keep secure and access-controlled (never in public repos)

---

## 1. Server Setup

### Install Node.js and pnpm

**On Linux (Ubuntu/Debian):**

```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 22 (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm globally
sudo npm install -g pnpm

# Verify installations
node --version  # Should show v22.x.x
pnpm --version  # Should show 9.x.x
```

**On Windows Server:**

1. Download Node.js installer from [nodejs.org](https://nodejs.org/)
2. Run installer and ensure "Add to PATH" is checked
3. Open PowerShell as Administrator:
   ```powershell
   npm install -g pnpm
   node --version
   pnpm --version
   ```

**On macOS:**

```bash
# Using Homebrew
brew install node@22
brew install pnpm

# Or download from nodejs.org
node --version
pnpm --version
```

### Configure Firewall

Allow incoming connections on your application port (default: 3000).

**On Linux (using UFW):**

```bash
# Allow port 3000
sudo ufw allow 3000/tcp

# Allow SSH (if not already enabled)
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

**On Linux (using iptables):**

```bash
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
```

**On Cloud Providers (AWS, GCP, Azure):**

Create a security group/firewall rule:

- **Protocol**: TCP
- **Port**: 3000
- **Source**: `0.0.0.0/0` (public) or your specific IP range

---

## 2. Clone and Build the Application

### SSH Key Setup (for private repositories)

If your repository is private, set up SSH authentication:

```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your-email@example.com"
# Press Enter for all prompts

# Display public key
cat ~/.ssh/id_ed25519.pub

# Add this key to your GitHub account:
# https://github.com/settings/keys
```

### Clone Repository

```bash
# Clone via SSH (requires SSH key setup)
git clone git@github.com:your-username/selva.git
cd selva

# Or via HTTPS (requires credentials)
git clone https://github.com/your-username/selva.git
cd selva
```

### Install Dependencies

```bash
# Install all workspace dependencies
pnpm install

# This installs dependencies for all packages in the monorepo
```

### Build All Packages

The compute-app depends on other workspace packages, so build everything in order:

```bash
# Build all packages (core, shared, schemas, etc.)
pnpm run build:all

# This ensures all dependencies are compiled
```

---

## 3. Configure Environment

Navigate to the compute-app directory:

```bash
cd packages/compute-app
```

Create a `.env` file with your configuration:

```bash
# Create .env file
cat > .env << 'EOF'
# Required: Rhino.Compute server URL
COMPUTE_SERVER_URL=https://vektornode-compute.ch/

# Required: Local path to Grasshopper definition files
GH_DEFINITIONS_PATH=./definitions

# Optional: API key for compute server authentication
COMPUTE_API_KEY=your-secret-key-here

# Required for production: Public URL of your application
# This prevents CSRF errors on form submissions
ORIGIN=http://YOUR-SERVER-IP:3000

# Optional: Custom port (default: 3000)
PORT=3000

# Optional: Host binding (use 0.0.0.0 for external access)
HOST=0.0.0.0

# Optional: Node environment
NODE_ENV=production
EOF
```

**Replace the following values:**

| Variable             | Replace With                      | Example                        |
| -------------------- | --------------------------------- | ------------------------------ |
| `COMPUTE_SERVER_URL` | Your Rhino.Compute server URL     | `https://example-compute.com/` |
| `COMPUTE_API_KEY`    | Your actual API key (if required) | `abc-123-secret`               |
| `YOUR-SERVER-IP`     | Your actual server IP             | `203.0.113.42`                 |

### Environment Variable Reference

| Variable                  | Required | Description                | Default                 |
| ------------------------- | -------- | -------------------------- | ----------------------- |
| `COMPUTE_SERVER_URL`      | Yes      | Rhino.Compute server URL   | None                    |
| `GH_DEFINITIONS_PATH`     | Yes\*    | Local path to `.gh` files  | None                    |
| `GH_DEFINITIONS_BASE_URL` | Yes\*    | Remote URL for `.gh` files | None                    |
| `COMPUTE_API_KEY`         | No       | API key for compute server | None                    |
| `ORIGIN`                  | Yes      | Public URL of your app     | `http://localhost:3000` |
| `PORT`                    | No       | Server port                | `3000`                  |
| `HOST`                    | No       | Host binding               | `localhost`             |
| `NODE_ENV`                | No       | Environment mode           | `development`           |

\*Use either `GH_DEFINITIONS_PATH` (local files) or `GH_DEFINITIONS_BASE_URL` (remote URL), not both.

---

## 4. Prepare Grasshopper Definitions

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

**Security reminder:**

- Never commit `.gh` files to public repositories
- Keep definition files in secure, access-controlled locations
- These files contain your intellectual property

---

## 5. Build for Production

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

## 6. Run the Application

You have three options for running the application in production:

### Option A: Direct Node.js (For Testing)

Simple but not recommended for production (no auto-restart, no process management):

```bash
# Start the server
node build/index.js
```

**Test it's running:**

```bash
# In another terminal
curl http://localhost:3000/api/health

# Expected response:
# {"status":"healthy","message":"Compute app is running"}
```

Access from browser: `http://YOUR-SERVER-IP:3000/app?gh=your-definition-name`

**Limitations:**

- Process stops if you close terminal
- No automatic restart on crashes
- Manual log management
- Not suitable for production

### Option B: PM2 (Recommended for Production)

[PM2](https://pm2.keymetrics.io/) is a production process manager for Node.js applications.

**Install PM2:**

```bash
# Install globally
sudo npm install -g pm2
```

**Start the application:**

```bash
# Start with PM2
pm2 start build/index.js --name selva-compute

# View status
pm2 status

# View logs
pm2 logs selva-compute

# View real-time logs
pm2 logs selva-compute --lines 100
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

**PM2 with environment variables:**

You can pass environment variables directly:

```bash
pm2 start build/index.js \
  --name selva-compute \
  --env production \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -e NODE_ENV=production
```

Or create an ecosystem file (see Option C below).

### Option C: PM2 Ecosystem File (Best for Complex Configs)

Create `ecosystem.config.js` in `packages/compute-app/`:

```javascript
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: 'build/index.js',
			instances: 1,
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			env: {
				NODE_ENV: 'production',
				PORT: 3000,
				HOST: '0.0.0.0',
				COMPUTE_SERVER_URL: 'https://vektornode-compute.ch/',
				GH_DEFINITIONS_PATH: './definitions',
				COMPUTE_API_KEY: 'your-secret-key',
				ORIGIN: 'http://YOUR-SERVER-IP:3000'
			}
		}
	]
};
```

**Start with ecosystem file:**

```bash
pm2 start ecosystem.config.js

# Or update existing process
pm2 restart ecosystem.config.js

# Save configuration
pm2 save
```

**Benefits of ecosystem file:**

- All configuration in one place
- Version controlled (without secrets if you use `.env`)
- Easy to replicate across servers
- Supports multiple apps

---

## 7. Verify Deployment

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

## 8. Production Hardening

### Use a Reverse Proxy (Recommended)

For production, run behind nginx or another reverse proxy:

**Install nginx:**

```bash
sudo apt-get install nginx
```

**Configure nginx (`/etc/nginx/sites-available/selva`):**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Enable the site:**

```bash
sudo ln -s /etc/nginx/sites-available/selva /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Update ORIGIN in `.env`:**

```bash
ORIGIN=http://your-domain.com
```

### Add SSL/TLS with Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is set up automatically
```

**Update ORIGIN for HTTPS:**

```bash
ORIGIN=https://your-domain.com
```

### Set Up Log Rotation

PM2 handles logs automatically, but you can configure rotation:

```bash
# Install PM2 log rotate module
pm2 install pm2-logrotate

# Configure rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## 9. Updating the Application

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

## 10. Monitoring and Maintenance

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

### Disk Space Management

```bash
# Check disk usage
df -h

# Find large files
du -sh packages/compute-app/*

# Clean build artifacts (before rebuilding)
cd ~/selva
pnpm clean:reinstall
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

---

## 11. Troubleshooting

### Application Won't Start

**Check build output:**

```bash
# Verify build completed
ls -la build/

# Try running directly to see errors
node build/index.js
```

**Check environment variables:**

```bash
# Ensure .env exists
cat .env

# Required variables must be set
# COMPUTE_SERVER_URL, GH_DEFINITIONS_PATH, ORIGIN
```

**Check port availability:**

```bash
# See what's using port 3000
sudo lsof -i :3000

# Or use a different port
PORT=3001 node build/index.js
```

### Can't Access from External Network

**Verify HOST binding:**

```bash
# Must be 0.0.0.0, not localhost
HOST=0.0.0.0 node build/index.js
```

**Check firewall:**

```bash
# Ensure port is open
sudo ufw status
sudo ufw allow 3000/tcp
```

**Verify ORIGIN matches public URL:**

```bash
# In .env, must match how users access it
ORIGIN=http://YOUR-ACTUAL-IP:3000
```

### Definitions Not Loading

**Check file paths:**

```bash
# Verify files exist
ls -la definitions/

# Ensure GH_DEFINITIONS_PATH is correct
# Should be: ./definitions
```

**Check filenames:**

- File: `definitions/my-solver.gh`
- URL: `?gh=my-solver` (no extension, no path)

**Check permissions:**

```bash
# Ensure Node process can read files
chmod 644 definitions/*.gh
```

### High Memory Usage

**Restart the process:**

```bash
pm2 restart selva-compute
```

**Set memory limit in PM2:**

```javascript
// In ecosystem.config.js
max_memory_restart: '1G';
```

**Monitor memory:**

```bash
pm2 monit
# Or
pm2 show selva-compute
```

### Can't Connect to Compute Server

**Test connectivity:**

```bash
# Check if compute server is reachable
curl https://vektornode-compute.ch/version

# Check from your app
curl http://localhost:3000/api/health
```

**Verify COMPUTE_SERVER_URL:**

```bash
# In .env
COMPUTE_SERVER_URL=https://vektornode-compute.ch/
# Must be reachable from your server
```

**Check API key (if required):**

```bash
# Ensure COMPUTE_API_KEY is set correctly
echo $COMPUTE_API_KEY
```

### Build Fails

**Check Node.js version:**

```bash
node --version
# Must be 20.19+ or 22+

# Update if needed
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Clean and rebuild:**

```bash
# From monorepo root
pnpm clean:reinstall
pnpm install
pnpm run build:all

# Then rebuild compute-app
cd packages/compute-app
export ADAPTER=node
pnpm build
```

---

## 12. Production Checklist

Before going live, verify:

- [ ] Node.js 20.19+ or 22+ installed
- [ ] pnpm installed globally
- [ ] All dependencies installed (`pnpm install`)
- [ ] All packages built (`pnpm run build:all`)
- [ ] `.env` file configured with production values
- [ ] `ORIGIN` matches public URL
- [ ] Grasshopper definitions in `definitions/` folder
- [ ] Firewall allows traffic on application port
- [ ] Application builds successfully (`ADAPTER=node pnpm build`)
- [ ] Health check responds (`/api/health`)
- [ ] PM2 installed and application started
- [ ] PM2 startup script configured for auto-restart
- [ ] Logs are accessible and monitored (`pm2 logs`)
- [ ] Reverse proxy configured (nginx recommended)
- [ ] SSL/TLS certificate installed (for HTTPS)
- [ ] Compute server is reachable from application
- [ ] Definition files load correctly via query parameters
- [ ] `.gh` files kept secure (not in public repos)

---

## 13. Comparison with Docker Deployment

| Aspect                 | Node.js Direct                       | Docker                            |
| ---------------------- | ------------------------------------ | --------------------------------- |
| **Setup complexity**   | Simple                               | Moderate                          |
| **Dependencies**       | Node.js + pnpm                       | Docker + Docker Compose           |
| **Process management** | PM2 or systemd                       | Built-in restart policies         |
| **Updates**            | `git pull && rebuild && pm2 restart` | `docker-compose pull && restart`  |
| **Resource overhead**  | Lower                                | Additional container layer        |
| **Isolation**          | Process-level                        | Container-level                   |
| **Portability**        | Manual setup per server              | Consistent across environments    |
| **Best for**           | Single server, simple deployments    | Multi-container, scalable systems |
| **Debugging**          | Direct access to Node process        | Requires exec into container      |

---

## See Also

- [Docker Deployment Guide](./DOCKER_DEPLOYMENT_GUIDE.md) - Container-based deployment
- [Compute App Deployment Guide](../packages/compute-app/DEPLOYMENT.md) - Environment variables and strategies
- [Rhino.Compute Documentation](https://developer.rhino3d.com/guides/compute/deployment/)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)
