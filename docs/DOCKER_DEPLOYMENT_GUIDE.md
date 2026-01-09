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

### Network Configuration

Ensure your server can reach the Rhino.Compute server:

```bash
# Test connectivity (from your server)
curl http://compute-server:8081/api/version
```

If the Compute server is on a different machine, update `COMPUTE_SERVER_URL` in your `.env` file to use the correct hostname/IP.

---

## 3. Building a Docker Image for Production

### Step 1: Prepare the Environment

Navigate to the `packages/compute-app` directory:

```bash
cd packages/compute-app
```

Create a `.env` file (use `.env.example` as a template):

```bash
# .env
COMPUTE_SERVER_URL=http://compute-server:8081
GH_DEFINITIONS_BASE_URL=/definitions
COMPUTE_API_KEY=your-secret-key-here
ORIGIN=http://localhost:3000
```

**Environment variables:**
- `COMPUTE_SERVER_URL`: URL of your Rhino.Compute server
- `GH_DEFINITIONS_BASE_URL`: Path where definitions are served from (`/definitions` for mounted volumes)
- `COMPUTE_API_KEY`: (Optional) Authentication key for Compute server
- `ORIGIN`: Your app's public URL (prevents CSRF errors)

### Step 2: Prepare Definitions Folder

Create a `definitions/` folder in `packages/compute-app/` and place your `.gh` files there:

```bash
# From packages/compute-app directory
mkdir -p definitions
cp /path/to/your/definitions/*.gh definitions/
```

Example structure:

```
packages/compute-app/
├── definitions/
│   ├── solver-1.gh
│   ├── solver-2.gh
│   └── analysis-tool.gh
├── .env
├── docker-compose.yml
└── Dockerfile
```

### Step 3: Build the Docker Image

From the **root of the monorepo**:

```bash
# Build the Docker image
docker build \
  --file packages/compute-app/Dockerfile \
  --tag selva-compute-app:latest \
  .
```

Or use Docker Compose (simpler):

```bash
cd packages/compute-app
docker compose build
```

### Step 4: Run the Container

**With Docker Compose (recommended):**

```bash
cd packages/compute-app
docker compose up -d
```

This:
- Starts the container in the background
- Mounts the `definitions/` folder
- Loads variables from `.env`
- Exposes the app on port `3000`

**Check logs:**

```bash
docker compose logs -f web
```

**Verify the app is running:**

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{
  "status": "healthy",
  "message": "Compute app is running"
}
```

### Step 5: Access the Application

Open your browser and visit:

```
http://your-server-ip:3000/app?gh=solver-1
```

Replace `solver-1` with the name of your definition file (without the `.gh` extension).

### Adding More Definitions

To add new definitions without rebuilding:

1. Place new `.gh` files in the `definitions/` folder
2. Restart the container: `docker compose restart`
3. Access via: `http://your-server-ip:3000/app?gh=new-definition`

### Stopping the Container

```bash
docker compose down
```

---

## 4. Deploying the Image to Your Linux Server

Once you have a Docker image, you need to get it onto your Linux server. Choose one of these options:

### Option 1: Build Directly on the Server (Simplest)

Clone your repository directly on the Linux server and build there.

**On your Linux server:**

```bash
# Clone the repository
git clone https://github.com/your-username/selva.git
cd selva/packages/compute-app

# Create .env with your production configuration
cat > .env << EOF
COMPUTE_SERVER_URL=http://compute-server:8081
GH_DEFINITIONS_BASE_URL=/definitions
COMPUTE_API_KEY=your-secret-key-here
ORIGIN=https://your-domain.com
EOF

# Copy your Grasshopper definition files
mkdir -p definitions
# (copy your .gh files into the definitions folder)

# Build the image on the server
docker compose build

# Run the container
docker compose up -d

# Verify it's running
docker compose logs -f web
```

**Pros:**
- Simple, no image transfer needed
- Always builds with latest code
- Easy to update (just `git pull && docker compose up -d`)

**Cons:**
- Requires Node.js, build tools, and git on server
- Slower initial deployment (build takes 5-10 minutes)
- Takes up more disk space during build

---

### Option 2: Push to Docker Registry (Best for Production)

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
COMPUTE_SERVER_URL=http://compute-server:8081
GH_DEFINITIONS_BASE_URL=/definitions
COMPUTE_API_KEY=your-secret-key-here
ORIGIN=https://your-domain.com
EOF

# Create definitions folder
mkdir -p definitions
# (copy your .gh files into the definitions folder)

# Pull and run the image
docker pull your-docker-username/selva-compute-app:latest
docker compose up -d

# Verify it's running
docker compose logs -f web
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

## Updating the Deployment

**With Option 1 (Build on Server):**
```bash
cd ~/selva/packages/compute-app
git pull
docker compose down
docker compose build
docker compose up -d
```

**With Option 2 (Docker Registry):**
```bash
cd ~/selva-compute
docker pull your-docker-username/selva-compute-app:latest
docker compose down
docker compose up -d
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

## Troubleshooting

**Container won't start:**
```bash
docker compose logs web
```

**Can't reach Compute server:**
- Verify `COMPUTE_SERVER_URL` in `.env`
- Check network connectivity: `curl http://compute-server:8081/api/version`

**Definitions not loading:**
- Verify files are in `definitions/` folder
- Check spelling matches the `?gh=` query parameter
- Restart container: `docker compose restart`

**Port already in use:**
- Change port in `docker-compose.yml`: `ports: ['3001:3000']`

---

## See Also

- [Selva Deployment Guide](../packages/compute-app/DEPLOYMENT.md) - Environment variables and deployment strategies
- [Rhino.Compute Documentation](https://developer.rhino3d.com/guides/compute/deployment/)
