# Node.js Deployment with PM2

**Prerequisites:** Complete [SERVER_SETUP.md](./SERVER_SETUP.md) first.

---

## Quick Start

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

```javascript
env: {
    PORT: 3000,
    ORIGIN: 'http://your-public-ip',          // No trailing slash
    GH_DEFINITIONS_PATH: '/absolute/path/to/definitions',  // Always use absolute path
    BODY_SIZE_LIMIT: 'Infinity',              // Needed for large file uploads
    ADMIN_PASSWORD: 'your-secure-password',
    NODE_ENV: 'production',
    ALLOW_INSECURE_COOKIES: 'true'            // HTTP deployments only
}
// Rhino.Compute URL + API key are configured in /admin/compute after first boot
```

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

| Issue                    | Fix                                                                         |
| ------------------------ | --------------------------------------------------------------------------- |
| Port in use              | `lsof -i :3000` → change `PORT` in config                                   |
| Can't reach Compute      | `curl http://YOUR-COMPUTE/health` → verify the URL in `/admin/compute` and firewall |
| Definitions not loading  | `ls definitions/` → verify filenames match `?gh=` param                     |
| Body size limit exceeded | Set `BODY_SIZE_LIMIT: 'Infinity'` and restart with `--update-env`           |
