# Docker Deployment

**Prerequisites:** Complete [PREREQUISITES.md](./PREREQUISITES.md) and [SERVER_SETUP.md](./SERVER_SETUP.md) first.

---

## Install Docker (Ubuntu)

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose
sudo systemctl start docker && sudo systemctl enable docker
sudo usermod -aG docker $USER  # optional: non-root docker
```

---

## Option 1: Build on Server (Recommended)

Clone and build directly on the server, then run via Docker Compose.

```bash
# After completing SERVER_SETUP.md, navigate to compute-app
cd packages/compute-app

# Configure environment
cp .env.example .env && nano .env
# Set: COMPUTE_SERVER_URL, GH_DEFINITIONS_PATH (or GH_DEFINITIONS_BASE_URL)

# Add Grasshopper definitions
mkdir -p definitions
# scp /path/to/*.gh user@YOUR-SERVER:~/selva/packages/compute-app/definitions/

# Build and start
docker-compose build
docker-compose up -d
docker-compose logs -f web
```

**Verify:** `curl http://localhost:3000/api/health`

**Update:**

```bash
cd ~/selva/packages/compute-app
git pull && pnpm install && pnpm run build:all
docker-compose down && docker-compose build && docker-compose up -d
```

---

## Option 2: Docker Registry (CI/CD)

Build locally, push to a registry, pull on the server.

**Build and push:**

```bash
# From monorepo root
docker build --file packages/compute-app/Dockerfile \
  --tag your-username/selva-compute-app:latest .

docker login
docker push your-username/selva-compute-app:latest
```

**Deploy on server:**

```bash
mkdir -p ~/selva-compute && cd ~/selva-compute

cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  web:
    image: your-username/selva-compute-app:latest
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

cat > .env << 'EOF'
COMPUTE_SERVER_URL=http://YOUR-COMPUTE-SERVER:5000
GH_DEFINITIONS_PATH=./definitions
HOST=0.0.0.0
PORT=3000
NODE_ENV=production
EOF

nano .env  # fill in your values
mkdir -p definitions  # copy .gh files here

docker-compose pull && docker-compose up -d
```

**Update:** `docker-compose pull && docker-compose down && docker-compose up -d`

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Container won't start | `docker-compose logs web` |
| Can't reach Compute | `curl -H "RhinoComputeKey: key" http://COMPUTE:5000/version` |
| Definitions not loading | Check `definitions/` folder and `?gh=` spelling |
| Port in use | Change host port in `docker-compose.yml`: `'3001:3000'` |
| Node.js too old | Install Node.js 20.19+: `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt-get install -y nodejs` |
