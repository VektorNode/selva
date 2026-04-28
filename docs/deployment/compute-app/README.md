# Compute App Deployment

The Compute App is a SvelteKit + Node.js web application that serves a UI for solving Grasshopper definitions via Rhino.Compute.

---

## First-Time Deployment

Follow these steps in order:

1. **[Prerequisites](./PREREQUISITES.md)** — System requirements, network config, provider choice
2. **Pick a backend provider:**
   - **[@selvajs/local-provider](../../../packages/local-provider/README.md)** — filesystem (default, single-instance)
   - **[@selvajs/supabase-provider](../../../packages/supabase-provider/README.md)** — Supabase Auth + Postgres + Storage
3. **[Server Setup](./SERVER_SETUP.md)** — Install tools, clone repo, build (automated via `setup.sh`)
4. **[Node.js with PM2](./NODE_DEPLOYMENT.md)** — PM2 ecosystem config and lifecycle
5. **[Caddy Reverse Proxy](./REVERSE_PROXY_LOAD_BALANCER.md)** — HTTPS and port 80 forwarding (recommended for production)
6. **[Configure Definitions](./DEFINITIONS_SETUP.md)** — Set up your `.gh` files (local provider)

**Verify:** `curl http://YOUR-IP/api/health`

---

## Updating an Existing Deployment

```bash
# Node.js (automated)
bash ~/selva/scripts/update.sh

# Node.js (manual)
cd ~/selva && git pull && pnpm install && ADAPTER=node pnpm build --filter=@selvajs/compute-app
pm2 restart selva-compute --update-env
```
