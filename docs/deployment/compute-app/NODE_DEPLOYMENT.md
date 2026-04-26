# Node.js Deployment with PM2

**Prerequisites:** Complete [SERVER_SETUP.md](./SERVER_SETUP.md) first, then pick a backend provider:

- [@selvajs/local-provider](../../../packages/local-provider/README.md) — filesystem (default, single instance)
- [@selvajs/supabase-provider](../../../packages/supabase-provider/README.md) — Supabase Auth + Postgres + Storage

---

## Quick start

```bash
# 1. Configure environment
cd packages/compute-app
nano ecosystem.config.cjs

# 2. Build for production
export ADAPTER=node && pnpm build

# 3. Install PM2 and start
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 startup && pm2 save  # auto-restart on reboot
```

Test: `curl http://localhost:3000/api/health`

---

## ecosystem.config.cjs

The example below assumes the **local provider**. Swap the `DATA_PATH` / `SESSION_SECRET` block for the corresponding Supabase vars when using `@selvajs/supabase-provider` (see that package's README).

```javascript
env: {
    PORT: 3000,
    ORIGIN: 'http://your-public-ip',          // No trailing slash
    BODY_SIZE_LIMIT: 'Infinity',              // Needed for large file uploads
    NODE_ENV: 'production',
    ALLOW_INSECURE_COOKIES: 'true',           // HTTP deployments only

    // ---- Local provider ----
    DATA_PATH: '/absolute/path/to/data',      // Always absolute
    SESSION_SECRET: 'your-random-32-byte-hex-secret'
}
// First admin user is created via the in-app setup page on first boot.
// Rhino.Compute URL + API key are configured in /admin/compute after first boot.
```

See [`example.ecosystem.config.cjs`](../../../example.ecosystem.config.cjs) at the repo root for the canonical template.

---

## PM2 Commands

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs selva-compute
pm2 restart selva-compute --update-env   # use --update-env when env vars change
pm2 stop selva-compute
pm2 delete selva-compute
```

---

## Updating

```bash
# Automated
bash ~/selva/scripts/update.sh

# Manual
cd ~/selva && git pull && pnpm install && pnpm run build:all
cd packages/compute-app && export ADAPTER=node && pnpm build
pm2 restart selva-compute --update-env
```

---

## Troubleshooting

| Issue                                 | Fix                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Port in use                           | `lsof -i :3000` → change `PORT` in config                                           |
| Can't reach Compute                   | `curl http://YOUR-COMPUTE/health` → verify the URL in `/admin/compute` and firewall |
| Definitions not loading               | `ls $DATA_PATH/` → verify filenames match `?gh=` param                              |
| Body size limit exceeded              | Set `BODY_SIZE_LIMIT: 'Infinity'` and restart with `--update-env`                   |
| `Missing required env var: DATA_PATH` | Local provider can't find the data dir — set `DATA_PATH` to an absolute path        |
