# Deployment Prerequisites for Selva Compute App

This document covers the common prerequisites and setup requirements needed before deploying the Selva Compute App, whether using Node.js directly or Docker.

---

## Overview

The Selva Compute App requires two critical external dependencies to function:

1. **Rhino.Compute Server** - Performs the actual Grasshopper definition solving see guide [Compute Guide](../../RHINO_COMPUTE.md)
2. **Grasshopper Definition Files (.gh)** - Define your application logic see [Definition Setup](./DEFINITIONS_SETUP.md)

## 1. System Requirements

### Minimum Hardware

- **CPU**: 2 cores
- **RAM**: 2GB (4GB+ recommended for complex definitions)
- **Disk**: 5GB free space
- **Network**: Stable connection to Rhino.Compute server

### Operating Systems

**Supported:**

- Linux (Ubuntu 20.04+, Debian, CentOS)
- Windows Server 2019+
- macOS (for development)

**Recommended:** Linux (Ubuntu 22.04 LTS) for production deployments

---

## 2. Network Configuration

### Firewall Rules

You need to allow inbound traffic on your application port (default: 3000).

**On Linux (using UFW):**

```bash
# Allow application port
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
- **Port**: 3000 (or your custom port)
- **Source**: `0.0.0.0/0` (public) or your specific IP range

### Port Configuration

- **Default Application Port**: 3000
- **Compute Server Port**: Typically 5000 (varies by setup)
- **WebSocket Port** (dev mode only): 8765

If port 3000 is already in use, you can change it via environment variables.

---

## 3. Environment Configuration

Both deployment methods (Node.js and Docker) require a `.env` file with the following configuration:

### Required Variables

| Variable                  | Description                             | Example                   |
| ------------------------- | --------------------------------------- | ------------------------- |
| `COMPUTE_SERVER_URL`      | URL of your Rhino.Compute server        | `http://localhost:5000`   |
| `GH_DEFINITIONS_PATH`     | Local path to `.gh` files               | `./definitions`           |
| `GH_DEFINITIONS_BASE_URL` | Alternative: Remote URL for `.gh` files | `https://example.com/gh/` |

**Note:** Use either `GH_DEFINITIONS_PATH` (recommended) OR `GH_DEFINITIONS_BASE_URL`, not both.

### Optional Variables

| Variable          | Description                                                 | Default       |
| ----------------- | ----------------------------------------------------------- | ------------- |
| `COMPUTE_API_KEY` | API key for compute server (sent as RhinoComputeKey header) | None          |
| `PORT`            | Server port                                                 | `3000`        |
| `HOST`            | Host binding                                                | `localhost`   |
| `NODE_ENV`        | Environment mode                                            | `development` |

### Example .env File

```bash
# Required: Rhino.Compute server
COMPUTE_SERVER_URL=http://localhost:5000

# Required: Path to Grasshopper definitions
GH_DEFINITIONS_PATH=./definitions

# Optional: API key for authentication
# Sent as 'RhinoComputeKey' HTTP header to the compute server
# COMPUTE_API_KEY=your-secret-key-here

# Optional: Custom port
PORT=3000

# Optional: Host binding (use 0.0.0.0 for external access)
HOST=0.0.0.0

# Optional: Environment
NODE_ENV=production
```

---

## 4. Grasshopper Definition Loading

### How Definitions Are Loaded

The app loads Grasshopper definitions based on the `?gh=` query parameter:

```
http://YOUR-SERVER:3000/app?gh=solver-1
```

This loads `definitions/solver-1.gh`.

### File Resolution

**With `GH_DEFINITIONS_PATH=./definitions`:**

1. User visits: `?gh=my-solver`
2. App looks for: `./definitions/my-solver.gh`
3. File is read from disk and sent to Compute server

**With `GH_DEFINITIONS_BASE_URL=https://example.com/gh/`:**

1. User visits: `?gh=my-solver`
2. App fetches: `https://example.com/gh/my-solver.gh`
3. File url will be forwared to the Compute server

### Multiple Definitions

You can serve multiple definitions from one deployment:

```
http://YOUR-SERVER:3000/app?gh=solver-1
http://YOUR-SERVER:3000/app?gh=parametric-design
http://YOUR-SERVER:3000/app?gh=analysis-tool
```

Each loads a different `.gh` file from your definitions folder.

---

## Next Steps

After completing these prerequisites, choose your deployment method:

- **[Node.js Deployment Guide](./NODE_DEPLOYMENT.md)** - Direct Node.js deployment with PM2
- **[Docker Deployment Guide](./DOCKER_DEPLOYMENT.md)** - Container-based deployment

Both guides assume you have completed all prerequisites in this document.
