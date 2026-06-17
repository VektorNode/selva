# Deploying Selva to a Linux VM (GCE / Ubuntu)

End-to-end walkthrough for a CLI-scaffolded Selva on a single Linux VM behind Caddy. Written after a real first-run — every footgun in the debug section actually happened.

**Target shape:** one VM, public IP, local provider (filesystem JSON + HMAC), PM2 + systemd, Caddy proxying port 80 → Selva on port 3000.

Do **not** install PM2 globally — use the deployment-local `pm2` in `node_modules/.bin/`. Two PM2s managing the same daemon causes version-skew issues.

---

## Step 1 — Install Node 20

```bash
sudo apt-get update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v20.x
```

## Step 2 — Find the VM's external IP

```bash
curl -s ifconfig.me; echo
```

You'll paste this as `ORIGIN` in Step 4.

## Step 3 — Open port 80 in the GCP firewall

From your **laptop**:

```bash
gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server

gcloud compute instances add-tags <VM_NAME> --tags=http-server --zone=<ZONE>
```

Do **not** open port 3000 publicly — only Caddy should reach it.

## Step 4 — Scaffold the deployment

```bash
mkdir -p ~/apps && cd ~/apps
npx @selvajs/cli selva
```

Prompt answers for local-provider, single-tenant:

| Prompt                              | Answer                                        |
| ----------------------------------- | --------------------------------------------- |
| Tenancy mode                        | `single`                                      |
| Auth backend                        | `local`                                       |
| Use local for data and storage too? | `yes`                                         |
| DATA_PATH                           | Enter (default: `./.selva-data`)              |
| First instance-admin email          | your login email                              |
| Behind a reverse proxy?             | `yes`                                         |
| ORIGIN                              | `http://<VM-EXTERNAL-IP>` (no trailing slash) |
| Feature flags                       | Enter to skip                                 |

## Step 5 — Enable insecure cookies (HTTP-only)

> Skip if you're setting up HTTPS in Step 9.

Without this, session cookies (which default to `Secure`) are dropped by the browser over plain HTTP. Use a text editor — **not `echo >>`** (see debug section):

```bash
nano ~/apps/selva/.env
# Add at end of file:
ALLOW_INSECURE_COOKIES=true
```

## Step 6 — Sanity-check and start

```bash
cd ~/apps/selva
npm run doctor
npm start
npx pm2 save        # persist process list across reboots
```

To make PM2 auto-start on reboot:

```bash
npx pm2 startup systemd -u $USER --hp $HOME
```

PM2 prints a `sudo env PATH=...` command. **Before pasting it, verify it references your deployment-local `pm2`** (e.g. `/home/you/apps/selva/node_modules/pm2/bin/pm2`), not a global one. If it doesn't, rewrite it to the local path. Then run `npx pm2 save` again.

Confirm the systemd unit uses the local binary:

```bash
grep -E 'ExecStart|ExecStop' /etc/systemd/system/pm2-$USER.service
```

## Step 7 — Install Caddy

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt-get update && sudo apt-get install -y caddy
```

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
:80 {
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

Verify: `curl -I http://localhost` should return `Via: 1.1 Caddy`.

## Step 8 — Create the admin user

Visit `http://<VM-EXTERNAL-IP>/setup`. Enter the email from Step 4, set a password, provide an org name. You should land at `/admin`.

## Step 9 — Upgrade to HTTPS

Once a domain points at the VM:

1. Open port 443: `gcloud compute firewall-rules create allow-https --allow=tcp:443 --source-ranges=0.0.0.0/0 --target-tags=http-server`

2. Update Caddyfile:

   ```bash
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   selva.yourdomain.com {
       reverse_proxy 127.0.0.1:3000
   }
   EOF
   sudo systemctl reload caddy
   ```

3. Update `.env`: change `ORIGIN` to `https://selva.yourdomain.com`, remove `ALLOW_INSECURE_COOKIES=true`.

4. `npm run restart`

---

## Day-2 operations

| Command                          | What it does                                               |
| -------------------------------- | ---------------------------------------------------------- |
| `npm run doctor`                 | Re-validate env + providers. Run after editing `.env`.     |
| `npm run restart`                | Restart with env changes picked up.                        |
| `npm run logs`                   | Tail PM2 stdout/stderr.                                    |
| `npm run update`                 | Update `@selvajs/*` and restart.                           |
| `npm stop`                       | Stop the PM2 process.                                      |
| `npx selva keys rotate hmac`     | Rotate `SELVA_HMAC_KEY` (logs everyone out).               |
| `npx selva keys rotate at-rest`  | Rotate `SELVA_AT_REST_KEY` (Rhino API key needs re-entry). |
| `npx pm2 describe selva-compute` | Inspect live process: cwd, env, uptime, restarts.          |

---

## Debug section

### `echo >> .env` corrupts the file

If the last line of `.env` has no trailing newline, `echo >>` concatenates onto it — turning `ORIGIN=http://1.2.3.4` into `ORIGIN=http://1.2.3.4ALLOW_INSECURE_COOKIES=true`. Always use `nano`.

### Login appears to succeed but I'm not signed in

Session cookie has `Secure` flag but you're on HTTP — browser drops it. Diagnose:

```bash
curl -i -X POST http://localhost:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: http://<VM-IP>" \
  --data-urlencode "email=<email>" --data-urlencode "password=<password>" \
  2>&1 | grep -iE "HTTP/|set-cookie|location"
```

If `set-cookie` contains `Secure` and you're on HTTP → add `ALLOW_INSECURE_COOKIES=true`. If response is `200` + `401` JSON → wrong password. To reset: `cp .selva-data/auth-users.json{,.bak} && rm .selva-data/auth-users.json`, then visit `/setup`.

### "Cross-site POST form submissions are forbidden"

`ORIGIN` in `.env` must exactly match the browser URL — same scheme, same host, no trailing slash. Fix with `nano`, then `npm run restart`.

### PM2 online but app 502s through Caddy

```bash
npm run logs   # look for ERR_MODULE_NOT_FOUND
sudo ss -tlnp | grep -E ':80|:3000'  # expect caddy on :80, node on :3000
```

If `:3000` is missing, the app isn't listening — check `npx pm2 list`.

### `npm run update` shows same version before/after

npm packument cache. Force-clear:

```bash
npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online
npm run restart
```

### `@selvajs/selva@0.10.2` fails with unresolved `workspace:*`

That version was published incorrectly. Force past the cache:

```bash
npm cache clean --force && cd ~/apps && rm -rf selva
npx --yes @selvajs/cli@latest selva
```

### PM2 version-skew warning on boot

The systemd unit is pointing at a different `pm2` than you manage with. Rewrite the `ExecStart`/`ExecStop` lines in `/etc/systemd/system/pm2-$USER.service` to the local binary, then `sudo systemctl daemon-reload && sudo systemctl restart pm2-$USER`.

---

## What this guide doesn't cover

- **HTTPS via own cert** — use Caddy's `tls /path/to/cert /path/to/key`.
- **Behind another proxy** (Cloudflare, ALB) — forward `X-Forwarded-Proto`; set `ORIGIN` to match.
- **Supabase backend** — pick `supabase` at Step 4; local-provider-specific steps don't apply.
- **Header-auth deployments** — see `packages/providers/header-auth/README.md`.
- **Multi-instance** — local provider has no file locking; use Supabase for multi-instance.
