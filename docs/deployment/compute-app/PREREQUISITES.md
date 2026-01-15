# Deployment Prerequisites for Selva Compute App

This document covers the common prerequisites and setup requirements needed before deploying the Selva Compute App, whether using Node.js directly or Docker.

---

## Overview

The Selva Compute App requires two critical external dependencies to function:

1. **Rhino.Compute Server** - Performs the actual Grasshopper definition solving. See [Compute Guide](../../RHINO_COMPUTE.md).
2. **Grasshopper Definition Files (.gh)** - Define your application logic. See [Definition Setup](./DEFINITIONS_SETUP.md).

## 1. System Requirements

### Minimum Hardware

- **CPU**: 2 cores
- **RAM**: 2GB (4GB+ recommended for complex definitions)
- **Disk**: 5GB free space
- **Network**: Stable connection to Rhino.Compute server

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

The Compute App is configured via environment variables. You will apply these settings during the deployment phase (Step 3) using configuration files (like `.env` or `ecosystem.config.cjs`) found in the repository.

Prepare the following values before starting the deployment:

### Required Variables

| Variable                  | Description                             | Example                   |
| ------------------------- | --------------------------------------- | ------------------------- |
| `COMPUTE_SERVER_URL`      | URL of your Rhino.Compute server        | `http://your-compute.com` |
| `GH_DEFINITIONS_PATH`     | Local path to `.gh` files               | `./definitions`           |
| `GH_DEFINITIONS_BASE_URL` | Alternative: Remote URL for `.gh` files | `https://example.com/gh/` |

**Note:** Use either `GH_DEFINITIONS_PATH` (recommended) OR `GH_DEFINITIONS_BASE_URL`, not both.

### Optional Variables

| Variable          | Description                                                  | Default       |
| ----------------- | ------------------------------------------------------------ | ------------- |
| `COMPUTE_API_KEY` | API key for compute server (sent as RhinoComputeKey header)  | None          |
| `PORT`            | Server port                                                  | `3000`        |
| `HOST`            | Host binding                                                 | `localhost`   |
| `NODE_ENV`        | Environment mode                                             | `development` |
| `ORIGIN`          | Public URL used for origin/CSRF checks (recommended in prod) | None          |

---

## Next Steps

After reviewing the prerequisites, proceed to set up your server environment:

1. **[Server Setup](./SERVER_SETUP.md)** - Install tools, clone the repository, and build the project.
2. **Choose a Deployment Method:**
   - **[Node.js Deployment Guide](./NODE_DEPLOYMENT.md)** - Direct Node.js deployment with PM2
   - **[Docker Deployment Guide](./DOCKER_DEPLOYMENT.md)** - Container-based deployment
