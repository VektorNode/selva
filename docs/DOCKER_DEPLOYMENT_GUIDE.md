# Docker Deployment Guide for Selva Compute App

A complete start-to-finish guide for deploying the Selva Compute App using Docker.

---

## 1. Preparation

Before deploying, understand the key components that will be running:

### Rhino.Compute Server

The Selva Compute App solves Grasshopper definitions by communicating with a **Rhino.Compute** server. You must have a running Compute server before deploying.

**Required:**

- Rhino.Compute instance (running on a server with Rhino installed)
- Compute server URL and port (e.g., `http://compute-server:8081`)
- (Optional) API key if your Compute server requires authentication

**Resources:**

- [Rhino.Compute Official Documentation](https://developer.rhino3d.com/guides/compute/deployment/) - Complete setup and deployment instructions
- Custom fork: [VektorNode/compute.rhino3d](https://github.com/VektorNode/compute.rhino3d)

### Grasshopper Definition Files (.gh)

Your Grasshopper definition files are the core of your application. They define what solvers/tools are available.

**[Placeholder: See Grasshopper files documentation for details on preparing definition files]**

**Key points:**

- Place `.gh` files in a `definitions/` folder for Docker to mount
- One container can serve multiple definitions via query parameters
- Definitions are **not** embedded in the Docker image; they're mounted as volumes
- Always keep `.gh` files in secure, access-controlled locations (never in public git repos)

---

## 2. Setting Up a Server for Docker

You'll need a server (VPS, local machine, or cloud instance) with Docker and Docker Compose installed.

### System Requirements

- **OS**: Linux (Ubuntu 20.04+), Windows Server 2019+, or macOS
- **Docker**: Version 20.10+
- **Docker Compose**: Version 1.29+
- **Hardware**: Minimum 2GB RAM, 2 CPU cores (adjust based on definition complexity)

### Installation

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

## 3. Deploying to a Linux Server

Choose one of two approaches below:

---

## 4. Option 1: Build Directly on Server (Recommended for Most Cases)

The most practical approach: clone and build directly on your Linux server. No need to manage Docker registries or image transfers.

### Step 1: SSH Access with Key-Based Authentication (Until in public version)

For secure access to your server, use SSH keys instead of passwords.

**Generate SSH key on your server:**

```bash
# On your Linux server via Google Cloud console or SSH terminal
ssh-keygen -t ed25519 -C "your-email@example.com"
# Press Enter for all prompts (no passphrase needed)

# Display the public key to add to GitHub
cat ~/.ssh/id_ed25519.pub
```

**Add key to GitHub:**

1. Go to [GitHub SSH Keys Settings](https://github.com/settings/keys)
2. Click "New SSH key"
3. Paste the public key content
4. Name it (e.g., "Selva Test VM")
5. Click "Add SSH key"

### Step 2: Update System & Install Dependencies

```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
sudo apt-get install -y docker.io docker-compose

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Install Node.js 22+ (required for build)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm (Node package manager)
sudo npm install -g pnpm

# Verify installations
node --version
pnpm --version
docker --version
docker-compose --version
```

### Step 3: Clone Repository & Install Dependencies

```bash
# Clone using SSH (requires GitHub SSH key setup)
git clone git@github.com:your-username/selva.git
cd selva

# Install all dependencies
pnpm install

# Build all packages in the correct order
pnpm run build:all

# Navigate to compute-app
cd packages/compute-app
```

### Step 4: Configure Environment

```bash
# Create .env file with your production configuration
cat > .env << EOF
COMPUTE_SERVER_URL=https://vektornode-compute.ch/
GH_DEFINITIONS_PATH=./definitions
COMPUTE_API_KEY=xxx
ORIGIN=http://YOUR-VM-EXTERNAL-IP:3000
EOF
```

Replace `YOUR-VM-EXTERNAL-IP` with your actual Google Cloud VM external IP.

### Step 5: Prepare Definition Files

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

### Step 6: Build & Run Docker Image

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

### Step 7: Verify & Access

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

## 5. Option 2: Push to Docker Registry (For Frequent Updates)

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
    volumes:
      - ./definitions:/app/definitions
    extra_hosts:
      - 'host.docker.internal:host-gateway'
EOF

# Create .env file with your production configuration
cat > .env << EOF
COMPUTE_SERVER_URL=https://vektornode-compute.ch/
GH_DEFINITIONS_PATH=./definitions
COMPUTE_API_KEY=xxx
ORIGIN=https://your-domain.com
EOF

# Create definitions folder and copy .gh files
mkdir -p definitions
# scp /path/to/your/definitions/*.gh user@YOUR-VM-IP:~/selva-compute/definitions/

# Pull and run the image
docker-compose pull
docker-compose up -d

# Verify it's running
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

## 6. Updating the Deployment

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

## Production Checklist

- [ ] Rhino.Compute server is running and accessible
- [ ] `.env` file is configured with correct server URLs
- [ ] Definitions folder contains all required `.gh` files
- [ ] Docker image builds without errors
- [ ] Container starts and responds to health check
- [ ] App is accessible from the browser
- [ ] ORIGIN environment variable matches your public URL
- [ ] `.gh` files are kept secure (not in public git repos)
- [ ] Logs are monitored (use `docker compose logs`)
- [ ] Docker is configured to restart containers on failure (`restart: unless-stopped`)

---

## 7. Troubleshooting

**Container won't start:**

```bash
docker-compose logs web
```

**Can't reach Compute server:**

- Verify `COMPUTE_SERVER_URL` in `.env`
- Check network connectivity: `curl https://vektornode-compute.ch/api/version`

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

- [Selva Deployment Guide](../packages/compute-app/DEPLOYMENT.md) - Environment variables and deployment strategies
- [Rhino.Compute Documentation](https://developer.rhino3d.com/guides/compute/deployment/)
