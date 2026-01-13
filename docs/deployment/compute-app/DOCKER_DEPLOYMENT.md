# Docker Deployment Guide for Selva Compute App

A complete start-to-finish guide for deploying the Selva Compute App using Docker.

---

## Prerequisites

**IMPORTANT:** Before starting this guide, complete all prerequisites in [PREREQUISITES.md](./PREREQUISITES.md), including:

- Rhino.Compute server setup and testing
- Grasshopper definition files preparation
- Network and firewall configuration
- Basic understanding of environment variables

---

## 1. Docker-Specific Requirements

### System Requirements

- **OS**: Linux (Ubuntu 20.04+), Windows Server 2019+, or macOS
- **Docker**: Version 20.10+
- **Docker Compose**: Version 1.29+
- **Hardware**: Minimum 2GB RAM, 2 CPU cores (adjust based on definition complexity)

---

## 2. Install Docker & Node.js for Building

You only need Node.js + pnpm if you plan to build the image from source on the server.
If you deploy a prebuilt image from a registry, Docker alone is enough.

### Install Node.js and pnpm

See [SERVER_SETUP.md](./SERVER_SETUP.md) for detailed Node.js and pnpm installation instructions.

### Install Docker

**On Linux (Ubuntu):**

```bash
# Install Docker
sudo apt-get update
sudo apt-get install docker.io docker-compose

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# (Optional) Allow non-root docker commands
sudo usermod -aG docker $USER
```

**On Windows:**

- Download [Docker Desktop](https://www.docker.com/products/docker-desktop)
- Enable WSL 2 backend or Hyper-V

**On macOS:**

- Download [Docker Desktop](https://www.docker.com/products/docker-desktop)

---

## 3. Network Configuration

See [PREREQUISITES.md](./PREREQUISITES.md#2-network-configuration) for detailed network and firewall configuration.

### Docker-Specific Port Mapping

The app runs on **port 3000 by default**. To change it:

**In `docker-compose.yml`:**

```yaml
services:
  web:
    ports:
      - '3001:3000' # Maps container port 3000 to host port 3001
```

Then restart:

```bash
docker-compose down
docker-compose up -d
```

Access the app at `http://YOUR-SERVER-IP:3001` instead.

---

## 4. Deploying to a Linux Server

Choose one of two approaches below:

---

## 5. Option 1: Build Directly on Server (Recommended for Most Cases)

The most practical approach: clone and build directly on your Linux server. No need to manage Docker registries or image transfers.

### Step 1: Complete Common Server Setup

Follow [SERVER_SETUP.md](./SERVER_SETUP.md) to:

- Set up SSH key authentication
- Install Node.js and pnpm
- Clone the repository
- Install dependencies
- Build all packages

Then return here to configure Docker.

**After completing SERVER_SETUP.md, navigate to compute-app:**

```bash
cd packages/compute-app
```

### Step 2: Install Docker & Configure Environment

**Install Docker:**

```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
sudo apt-get install -y docker.io docker-compose

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker
```

### Step 3: Configure Environment

Create a `.env` file next to `docker-compose.yml` (this repo already includes an `.env` template):

```bash
cp .env.example .env
nano .env
```

At minimum, set:

- `COMPUTE_SERVER_URL`
- One of: `GH_DEFINITIONS_PATH` (recommended) or `GH_DEFINITIONS_BASE_URL`

If your Compute server requires authentication, also set `COMPUTE_API_KEY` (sent as `RhinoComputeKey`).

### Step 4: Prepare Definition Files

```bash
# Create definitions folder
mkdir -p definitions

# Copy your .gh files here
# Option A: From local machine via SCP
# scp /path/to/your/definitions/*.gh user@YOUR-VM-IP:~/selva/packages/compute-app/definitions/

# Option B: If already on the server
# cp /path/to/your/*.gh definitions/

# Verify files are there
ls -la definitions/
```

### Step 5: Build & Run Docker Image

**Note:** With older Docker Compose versions, use `docker-compose` (with hyphen) instead of `docker compose`.

```bash
# Build the Docker image (takes 5-10 minutes)
docker-compose build

# Start the container in the background
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f web
```

### Step 6: Verify & Access

```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Expected response:
# {"status":"healthy","message":"Compute app is running"}
```

Then open your browser:

```
http://YOUR-VM-EXTERNAL-IP:3000/app?gh=your-definition-name
```

**Pros:**

- Simple, no image registry needed
- Always builds with latest code from your repo
- Easy updates: `git pull && pnpm install && pnpm run build:all && docker-compose up -d`
- Full control over build process

**Cons:**

- Requires Node.js, build tools, and git on server
- Initial build takes 10-15 minutes
- Takes disk space during build (~3-4GB)

---

## 6. Option 2: Push to Docker Registry (For Frequent Updates)

Build locally, push to a Docker registry, then pull on the server. This is cleaner and more scalable.

**Step 1: Build and Tag Image Locally**

On your local machine:

```bash
# From the monorepo root
docker build \
  --file packages/compute-app/Dockerfile \
  --tag your-docker-username/selva-compute-app:latest \
  .
```

Or use Docker Compose:

```bash
cd packages/compute-app
docker compose build
# This creates image: selva-compute-app:latest (or your service name)
```

**Step 2: Push to Docker Hub (or Private Registry)**

```bash
# Tag the image for Docker Hub
docker tag selva-compute-app:latest your-docker-username/selva-compute-app:latest

# Login to Docker Hub
docker login

# Push the image
docker push your-docker-username/selva-compute-app:latest
```

**For a Private Registry** (GitHub Container Registry, AWS ECR, etc.):

```bash
# Example: GitHub Container Registry
docker tag selva-compute-app:latest ghcr.io/your-username/selva-compute-app:latest
docker login ghcr.io
docker push ghcr.io/your-username/selva-compute-app:latest
```

**Step 3: On Your Linux Server**

**Setup Docker & Basic Dependencies (one-time):**

```bash
# Install Docker (if not already done)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose
sudo systemctl start docker
sudo systemctl enable docker
```

**Deploy the Image:**

```bash
# Create a directory for the deployment
mkdir -p ~/selva-compute && cd ~/selva-compute

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  web:
    image: your-docker-username/selva-compute-app:latest
    container_name: selva-compute-app
    restart: unless-stopped
    ports:
      - '3000:3000'
    env_file: .env
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
      - ADAPTER=node
    volumes:
      - ./definitions:/app/definitions
    extra_hosts:
      - 'host.docker.internal:host-gateway'
EOF

# Create .env (use the same variable names as PREREQUISITES.md)
cat > .env << 'ENV'
COMPUTE_SERVER_URL=http://YOUR-COMPUTE-SERVER:5000
GH_DEFINITIONS_PATH=./definitions
HOST=0.0.0.0
PORT=3000
NODE_ENV=production
# COMPUTE_API_KEY=your-secret-key
# ORIGIN=https://your-public-domain.com
ENV

# Edit values
nano .env
```

Create a `definitions/` folder and copy your `.gh` files into it:

```bash
mkdir -p definitions
# scp /path/to/your/definitions/*.gh user@YOUR-VM-IP:~/selva-compute/definitions/

docker-compose pull
docker-compose up -d
docker-compose logs -f web
```

**Pros:**

- Clean separation between build and deploy
- Easy to update: `docker pull && docker compose up -d`
- Works with CI/CD pipelines
- Server doesn't need Node.js or build tools
- Versioning support (tag images with version numbers)

**Cons:**

- Requires Docker Hub account or private registry setup
- Network bandwidth for image transfer (~500MB)

---

## 7. Updating the Deployment

**With Option 1 (Build on Server):**

```bash
cd ~/selva/packages/compute-app
git pull
pnpm install
pnpm run build:all
docker-compose down
docker-compose build
docker-compose up -d
```

**With Option 2 (Docker Registry):**

```bash
cd ~/selva-compute
docker-compose pull your-docker-username/selva-compute-app:latest
docker-compose down
docker-compose up -d
```

---

## 8. Production Checklist

- [ ] Rhino.Compute server is running and accessible
- [ ] Environment variables are configured (via `.env`)
- [ ] Definitions folder contains all required `.gh` files
- [ ] Docker image builds without errors
- [ ] Container starts and responds to health check
- [ ] App is accessible from the browser
- [ ] Logs are monitored (use `docker compose logs`)
- [ ] Docker is configured to restart containers on failure (`restart: unless-stopped`)

---

## 9. Troubleshooting

**Container won't start:**

```bash
docker-compose logs web
```

**Can't reach Compute server:**

- Verify `COMPUTE_SERVER_URL` in `.env`
- Check network connectivity:

  ```bash
  # Without API key
  curl http://YOUR-COMPUTE-SERVER:5000/version

  # With API key (if required)
  curl -H "RhinoComputeKey: your-api-key-here" http://YOUR-COMPUTE-SERVER:5000/version
  ```

- Ensure `COMPUTE_API_KEY` is set if your Compute server requires authentication

**Definitions not loading:**

- Verify files are in `definitions/` folder
- Check spelling matches the `?gh=` query parameter
- Restart container: `docker-compose restart`

**Port already in use:**

- Change port in `docker-compose.yml`: `ports: ['3001:3000']`
- Then run: `docker-compose up -d`

**Node.js version too old (build fails):**

- Must have Node.js 20.19+ or 22+
- Update: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`

**pnpm not found:**

- Install: `sudo npm install -g pnpm`

---

## See Also

- [Deployment Overview](./OVERVIEW.md) - Quick start and deployment paths
- [Server Setup](./SERVER_SETUP.md) - Common setup steps
- [Prerequisites](./PREREQUISITES.md) - System requirements and network setup
- [Definitions Configuration](./DEFINITIONS_SETUP.md) - Configure Grasshopper definitions
- [Node.js Deployment](./NODE_DEPLOYMENT.md) - Alternative deployment method
- [Rhino.Compute Documentation](https://developer.rhino3d.com/guides/compute/deployment/)
