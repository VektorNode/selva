# Node.js Deployment with PM2

**Prerequisites:** Complete [SERVER_SETUP.md](./SERVER_SETUP.md) first, then pick a backend provider:

- [@selvajs/local-provider](../../../packages/local-provider/README.md) — filesystem (default, single instance)
- [@selvajs/supabase-provider](../../../packages/supabase-provider/README.md) — Supabase Auth + Postgres + Storage

---

## Quick start

```bash
# 1. Configure environment — copy the template and fill in values
cp packages/selva/.env.example packages/selva/.env
nano packages/selva/.env

# 2. Build for production
export ADAPTER=node && pnpm build --filter=@selvajs/selva

# 3. Install PM2 and start (from the repo root)
sudo npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 startup && pm2 save  # auto-restart on reboot
```

Test: `curl http://localhost:3000/api/health`

---

## ecosystem.config.cjs

Runtime config lives in `packages/selva/.env` and is loaded by Node itself via `--env-file` (Node >= 20.6). The committed [`ecosystem.config.cjs`](../../../ecosystem.config.cjs) is provider-agnostic — switching from local to Supabase only requires editing `.env`.

> **Why `--env-file` instead of PM2's `env_file`:** PM2's `env_file` option only works under `pm2-runtime`. The regular `pm2 start` daemon silently ignores it, causing the app to crash on boot with `Missing required env var: SELVA_HMAC_KEY`. Letting Node load `.env` directly avoids that footgun.

```javascript
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './build/index.js',
			cwd: './packages/selva',
			node_args: '--env-file=.env',
			instances: 1, // local provider is not safe across processes
			exec_mode: 'fork', // switch to 'cluster' only with Supabase
			autorestart: true,
			max_memory_restart: '1G',
			env: { NODE_ENV: 'production' }
		}
	]
};
```

A minimal `.env` for the local provider (see [`packages/selva/.env.example`](../../../packages/selva/.env.example) for every option):

```bash
# Local provider
DATA_PATH=/absolute/path/to/data
SELVA_HMAC_KEY=your-random-32-byte-hex-key       # signs session cookies + share/invite tokens
SELVA_AT_REST_KEY=your-random-32-byte-hex-key    # encrypts Rhino.Compute API keys at rest

# Server
PORT=3000
ORIGIN=http://your-public-ip                     # no trailing slash
ALLOW_INSECURE_COOKIES=true                      # HTTP deployments only
BODY_SIZE_LIMIT=150M                             # adapter-node suffix: K / M / G only
```

First admin user is created via the in-app setup page on first boot. Rhino.Compute URL + API key are configured in `/admin/compute` after first boot.

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
cd ~/selva && git pull && pnpm install && ADAPTER=node pnpm build --filter=@selvajs/selva
pm2 restart selva-compute --update-env
```

---

## Troubleshooting

| Issue                                 | Fix                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Port in use                           | `lsof -i :3000` → change `PORT` in config                                                   |
| Can't reach Compute                   | `curl http://YOUR-COMPUTE/health` → verify the URL in `/admin/compute` and firewall         |
| Definitions not loading               | `ls $DATA_PATH/` → verify filenames match `?gh=` param                                      |
| Body size limit exceeded              | Bump `BODY_SIZE_LIMIT` in `.env` (e.g. `150M`) and `pm2 restart selva-compute --update-env` |
| `Missing required env var: DATA_PATH` | Local provider can't find the data dir — set `DATA_PATH` to an absolute path                |
