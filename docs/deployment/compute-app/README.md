# Compute App Deployment

The Compute App is a SvelteKit + Node.js web application that serves a UI for solving Grasshopper definitions via Rhino.Compute.

---

## First-Time Deployment

Follow these steps in order:

1. **[Prerequisites](./PREREQUISITES.md)** — System requirements, network config, environment variables
2. **[Server Setup](./SERVER_SETUP.md)** — Install tools, clone repo, build (automated via `setup.sh`)
3. **Choose a deployment method:**
   - **[Node.js with PM2](./NODE_DEPLOYMENT.md)** — Simpler, lower overhead (recommended for most)
4. **[Caddy Reverse Proxy](./REVERSE_PROXY_LOAD_BALANCER.md)** — HTTPS and port 80 forwarding (recommended for production)
5. **[Configure Definitions](./DEFINITIONS_SETUP.md)** — Set up your `.gh` files

**Verify:** `curl http://YOUR-IP/api/health`

---

## Updating an Existing Deployment

```bash
# Node.js (automated)
bash ~/selva/scripts/update.sh

# Node.js (manual)
cd ~/selva && git pull && pnpm install && pnpm run build:all
cd packages/compute-app && export ADAPTER=node && pnpm build
pm2 restart selva-compute --update-env
```
