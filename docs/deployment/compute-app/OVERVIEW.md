# Compute App Deployment Overview

Welcome! This guide helps you deploy the Selva Compute App to production. Follow the path that matches your situation.

---

## What is the Compute App?

The Compute App is a standalone web application that:

- Serves a user interface for solving Grasshopper definitions
- Communicates with a Rhino.Compute server to perform calculations
- Supports multiple Grasshopper definitions through query parameters
- Can be deployed to any cloud provider or on-premises server

**Key components:**

- **Frontend**: SvelteKit web UI (runs in the browser)
- **Backend**: Node.js server (serves the UI and proxies requests to Compute)
- **Compute Server**: Separate Rhino.Compute instance (performs calculations)

---

## Getting Started: Choose Your Path

### Path 1: First-Time Production Deployment

You're deploying the Compute App to production for the first time.

**Follow these steps in order:**

1. **[Review Deployment Prerequisites](./PREREQUISITES.md)** (15 min)
   - Understand system requirements
   - Set up network and firewall
   - Prepare environment variables

2. **[Complete Server Setup](./SERVER_SETUP.md)** (20 min)
   - Install Node.js and pnpm
   - Clone the repository
   - Build all packages

3. **Choose Your Deployment Method:**

   **Option A: [Node.js Deployment](./NODE_DEPLOYMENT.md)** (Recommended for most)
   - Simpler setup
   - Lower resource usage
   - Good for single-server deployments
   - Time: 30 minutes

   **Option B: [Docker Deployment](./DOCKER_DEPLOYMENT.md)** (Recommended for scale)
   - More flexible
   - Container-based (easier updates)
   - Good for cloud providers and scaling
   - Time: 45 minutes

4. **[compute-app deployment](./DEFINITIONS_SETUP.md)** (10 min)
   - Prepare your `.gh` files
   - Create `definitions-config.json`
   - Test definition loading

5. **Verify & Test**
   - Access the health check: `curl http://YOUR-IP:3000/api/health`
   - Open in browser: `http://YOUR-IP:3000/app?gh=your-definition`
   - Test with real data

**Total time: ~2 hours**

---

### Path 2: Updating an Existing Deployment

You already have the Compute App running and need to update it.

**With Node.js deployment:**

```bash
cd ~/selva
git pull
pnpm install
pnpm run build:all
cd packages/compute-app
export ADAPTER=node
pnpm build
pm2 restart selva-compute
pm2 logs selva-compute
```

**With Docker deployment:**

```bash
cd ~/selva-compute
docker-compose pull your-docker-username/selva-compute-app:latest
docker-compose down
docker-compose up -d
docker-compose logs -f web
```

See [Node.js Updating](./NODE_DEPLOYMENT.md#8-updating-the-application) or [Docker Updating](./DOCKER_DEPLOYMENT.md#7-updating-the-deployment) for details.

---

## Next Steps

**Ready to deploy?** Choose your path above and follow the link to get started.

**Need more information?**

- [Prerequisites & Setup](./PREREQUISITES.md)
- [Definitions Configuration](./DEFINITIONS_SETUP.md)
- [Full Deployment Guides](./NODE_DEPLOYMENT.md)
