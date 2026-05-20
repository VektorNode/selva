# Deploying Selva to a Linux VM (GCE / Ubuntu)

End-to-end walkthrough for getting a CLI-scaffolded Selva deployment running on a single Linux VM behind Caddy. Written after a real first-run on Google Compute Engine — every footgun in the "Things that bit us" section actually bit somebody.

**Target shape:** one VM, public IP, plain HTTP for now (HTTPS upgrade path documented at the end). Local provider (filesystem JSON + HMAC sessions). PM2 (installed per-deployment) + systemd for process supervision. Caddy reverse-proxying port 80 → Selva on port 3000.

---

## Prerequisites

| Need                                                          | Why                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Ubuntu 22.04+ VM** (e.g. GCE `e2-small` is enough to start) | Anything that can run Node 20 + Caddy. The commands below assume `apt-get`.  |
| **`gcloud` CLI configured** on your laptop                    | For the firewall rule. Skip if you'll add the rule in the GCP web console.   |
| **`@selvajs/cli` published to npm**                           | The CLI fetches `@selvajs/selva` (and PM2) from the public registry.         |

The VM does **not** need git, pnpm, or a checkout of the monorepo. Everything is installed via `npx` and `npm`. **Do not** install PM2 globally — `@selvajs/cli` ships its own pinned `pm2` as a deployment dependency and the wrappers refuse to fall back to a global binary (two PM2s managing the same daemon causes persistent version-skew warnings).

---

## Step 1 — Install Node 20 on the VM

SSH in (`gcloud compute ssh <vm-name>` or whatever your access method is), then:

```bash
sudo apt-get update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

node -v        # expect v20.x
npm -v         # expect 10.x
```

PM2 is installed as part of `npm install` in Step 4 — see [packages/cli/src/commands/create.js](../../packages/cli/src/commands/create.js) where it's listed as a dependency. The `selva start/stop/restart/logs/update` wrappers always resolve to the deployment-local `./node_modules/.bin/pm2`, never a global one.

---

## Step 2 — Find the VM's external IP

```bash
curl -s ifconfig.me; echo
```

Write this down — you'll paste it as `ORIGIN` in the next step.

---

## Step 3 — Open port 80 in the GCP firewall

From your **laptop** (not the VM). Replace `<VM_NAME>` and `<ZONE>`:

```bash
gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 --source-ranges=0.0.0.0/0 --target-tags=http-server

gcloud compute instances add-tags <VM_NAME> \
  --tags=http-server --zone=<ZONE>
```

Find your zone with `gcloud compute instances list` if you don't remember it.

**Do not** open port 3000 to the public internet. Selva binds there but only Caddy (running on the same host) should reach it.

---

## Step 4 — Scaffold the deployment

Back on the VM, pick a directory name and run the CLI. `~/apps/selva` and `~/selva` are both common — the path is purely convention, the CLI just `mkdir`s whatever you pass. Substitute your chosen path everywhere below.

```bash
mkdir -p ~/apps && cd ~/apps
npx @selvajs/cli selva
```

The CLI prompts. Answer like this for a local-provider, single-tenant install:

| Prompt                              | Answer                                                            |
| ----------------------------------- | ----------------------------------------------------------------- |
| Tenancy mode                        | `single`                                                          |
| Auth backend                        | `local`                                                           |
| Use local for data and storage too? | `yes`                                                             |
| DATA_PATH                           | press Enter (default: `./.selva-data`)                            |
| First instance-admin email          | the email you'll use to log in (e.g. `admin@your-org.com`)        |
| Behind a reverse proxy?             | `yes`                                                             |
| ORIGIN                              | `http://<VM-EXTERNAL-IP>` (the IP from Step 2; no trailing slash) |
| Feature flags                       | press Enter to skip all                                           |

The CLI will:

1. Write `package.json`, `.env`, `ecosystem.config.cjs` into the chosen directory.
2. Run `npm install` — pulls `@selvajs/selva` (the prebuilt SvelteKit app, which bundles all providers internally), `@selvajs/cli` itself (so `selva` lands in `node_modules/.bin/`), and a pinned `pm2` (so `pm2` also lands in `node_modules/.bin/` — no global install). Watch the live progress; install takes 30–90s.
3. Print "next steps" referencing `npm run doctor` and `npm start`.

When it's done you should see:

```
└  Scaffolded /home/<you>/apps/selva
```

---

## Step 5 — Enable insecure cookies (HTTP-only deployments)

> **Skip this step if you'll set up HTTPS in Step 9.**

SvelteKit's session cookies default to `Secure`, which means the browser refuses to send them back over plain HTTP. The symptom is: login appears to succeed (303 redirect) but you keep bouncing back to `/login` because the cookie was dropped client-side.

`ALLOW_INSECURE_COOKIES=true` strips the `Secure` flag so cookies stick on HTTP. **Don't leave this on for any real deployment** — anyone on the network path can sniff session cookies.

**Use a text editor**, not `echo >> .env`:

```bash
nano ~/apps/selva/.env
```

Add a new line at the end:

```
ALLOW_INSECURE_COOKIES=true
```

Save (`Ctrl+O`, Enter, `Ctrl+X`).

> **Why not `echo "..." >> .env`?** If the previous line of `.env` lacks a trailing newline, `echo >>` concatenates onto the end of it. We've seen this corrupt `ORIGIN=http://1.2.3.4` into `ORIGIN=http://1.2.3.4ALLOW_INSECURE_COOKIES=true`. Login then fails silently because the browser's `Origin` header doesn't match the corrupted value, and CSRF rejects the POST.

---

## Step 6 — Sanity-check and start

```bash
cd ~/apps/selva
npm run doctor    # validate config without starting the app
```

Expected output (mostly green checks):

```
┌   selva doctor
  ✓ .env present
  ✓ ecosystem.config.cjs present
  ✓ deployment layout is current
  ✓ SELVA_HMAC_KEY is a 32-byte hex string
  ✓ SELVA_AT_REST_KEY is a 32-byte hex string
  ! DATA_PATH=./.selva-data doesn't exist yet — will be created on first run
  ✓ SELVA_TENANCY=single
  ✓ @selvajs/selva installed
  ✓ ORIGIN=http://<your-ip>
└  All checks passed.
```

The yellow `DATA_PATH doesn't exist yet` is expected on a fresh install. The local provider creates the directory on the first **write**, not the first request — under password auth that's when someone submits `/setup`; under header-auth it's the first request whose injected UPN matches `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`. A `GET /` that returns 401/403 doesn't trigger it.

Selva no longer ships separate `@selvajs/local-provider` / `@selvajs/supabase-provider` packages — all providers are bundled into `@selvajs/selva`, which is why doctor checks only that one. If you see `@selvajs/local-provider installed` in older docs or screenshots, that's pre-bundling.

If `ORIGIN` shows garbage like `http://1.2.3.4SOMETHING=true`, you hit the `.env` concatenation bug from Step 5 — re-open `.env`, fix the line, save.

Then:

```bash
npm start                              # selva start → pm2 start ecosystem.config.cjs
npx pm2 save                           # persist process list across reboots
```

`npx pm2 ...` resolves to the deployment-local `pm2` because you're inside the deploy directory — no global install needed (and don't add one; see Prerequisites). `pm2 save` writes the current process list to `~/.pm2/dump.pm2`. To make PM2 itself auto-start on VM reboot:

```bash
npx pm2 startup systemd -u $USER --hp $HOME
```

PM2 prints a `sudo env PATH=... pm2 startup ...` line. **Copy and paste that exact line back into the shell** — that's what actually installs the systemd unit. The printed line will reference the full path to your local pm2 (e.g. `/home/you/<deploy>/node_modules/pm2/bin/pm2`); leave it as-is, that's correct.

---

## Step 7 — Install Caddy and reverse-proxy port 80

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg

curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list

sudo apt-get update && sudo apt-get install -y caddy
```

Replace `/etc/caddy/Caddyfile` with:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
:80 {
    reverse_proxy 127.0.0.1:3000
}
EOF

sudo systemctl reload caddy
```

Verify the chain locally:

```bash
curl -I http://localhost:3000    # Selva direct — expect 200 or 302
curl -I http://localhost         # via Caddy — same response, with "Via: 1.1 Caddy"
```

Then open `http://<VM-EXTERNAL-IP>` in your laptop browser. First visit lands on `/setup` (after you've completed setup once, it redirects authenticated users elsewhere).

---

## Step 8 — Create the admin user

In the browser at `http://<VM-EXTERNAL-IP>/setup`:

1. Enter the email you set as `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` in Step 4.
2. Set a password (the local provider hashes with HMAC + the `SELVA_HMAC_KEY`).
3. Provide a company / org name.
4. Submit.

You should be redirected to `/admin`.

If you stay on `/setup` or get bounced back to `/login` after submitting, see **"Login appears to succeed but I'm not signed in"** in the debug section below.

---

## Step 9 — Upgrading to HTTPS (recommended)

Plain HTTP is fine for poking around but unsafe for real use. Once you have a domain pointing at the VM:

1. Open port 443 in GCP:

   ```bash
   gcloud compute firewall-rules create allow-https \
     --allow=tcp:443 --source-ranges=0.0.0.0/0 --target-tags=http-server
   ```

2. Rewrite the Caddyfile to use your domain (Caddy auto-provisions a Let's Encrypt cert):

   ```bash
   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   selva.yourdomain.com {
       reverse_proxy 127.0.0.1:3000
   }
   EOF
   sudo systemctl reload caddy
   ```

3. Update `.env`:
   - Change `ORIGIN=http://...` to `ORIGIN=https://selva.yourdomain.com`.
   - **Remove** the `ALLOW_INSECURE_COOKIES=true` line entirely (use `nano`, not sed).

4. Restart:

   ```bash
   cd ~/apps/selva
   npm run restart    # pm2 restart selva-compute --update-env
   ```

5. Visit `https://selva.yourdomain.com`. Caddy fetches the cert on first request — first load may take a few seconds.

---

## Testing header-auth locally (dev note)

The header-auth provider trusts identity headers set by an upstream proxy. In production those come from a forward-auth helper (OIDC, Entra, etc.). For local development you can skip the helper and have **Caddy inject the headers directly** — useful for iterating on permissions, allowlist UX, or admin flows without standing up an IdP.

> **Security:** this configuration makes anyone who can reach Caddy authenticate as the injected user. Lock port 80 to your own IP in the GCP firewall (Source IPv4 ranges: `<your-laptop-ip>/32`) before turning this on, and never leave it in this state on a publicly reachable VM.

**1. Switch the deployment to header-auth.** In `.env`:

```bash
SELVA_AUTH_PROVIDER=header
SELVA_TENANCY=single
HEADER_AUTH_DATA_DIR=./.selva-data         # or rely on DATA_PATH
BOOTSTRAP_INSTANCE_ADMIN_EMAIL=admin@corp.com
HOST=127.0.0.1                              # critical — must NOT be 0.0.0.0
```

`HOST=127.0.0.1` is non-negotiable: header-auth trusts what the request claims, so the Selva process must be unreachable except via Caddy. `selva doctor` yellow-flags anything else but does not block startup — the deployment is the security boundary, and only you can confirm the proxy is actually in front.

Run `npm run doctor` after editing — under header-auth it additionally checks:

- `HEADER_AUTH_DATA_DIR` (or `DATA_PATH` fallback) is set and writable.
- `header-allowlist.json` is present (yellow if missing — provider creates it lazily, but until then no one can log in).
- `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` is set (**red** if missing — without it you have no way to claim admin on first visit).
- `ORIGIN` is set (red if missing).
- Resolved header names — prints what the provider will read so you can diff against the Caddyfile. Partial overrides (one of the three `HEADER_AUTH_*_HEADER` vars set, others not) get yellow-flagged because that's almost always a typo.

Then restart: `npm run restart`.

**2. Inject the test identity in the Caddyfile.** Strip any inbound copies first (a browser must not be able to spoof these), then set the trusted headers:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
:80 {
    request_header -SELVA-UserPrincipalName
    request_header -SELVA-Email
    request_header -SELVA-DisplayName

    request_header SELVA-UserPrincipalName "admin@corp.com"
    request_header SELVA-Email             "admin@corp.com"
    request_header SELVA-DisplayName       "Test Admin"

    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

**3. First request bootstraps the admin.** Because the injected UPN matches `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`, the bootstrap policy auto-allowlists `admin@corp.com` and grants every platform permission. There is no `/setup` or `/login` under header-auth — visit the site and you're in.

```bash
curl -I http://<vm-external-ip>
```

After this request, `.selva-data/header-allowlist.json` and `.selva-data/user-data.json` should exist in your deployment directory. That's the only thing that proves the bootstrap actually ran — the directory is created on the first **write**, not on boot or on the first GET. If `.selva-data` is still empty after a curl, the most common causes are: (a) the UPN in the Caddyfile doesn't match `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` exactly, (b) PM2's `cwd` isn't your deploy directory so the relative `DATA_PATH=./.selva-data` resolved somewhere else (`npx pm2 describe selva-compute | grep cwd`), or (c) headers were stripped by an intermediate proxy.

**4. Test additional users.** Change the injected values in the Caddyfile (e.g. `bob@corp.com`) and reload Caddy. Bob will be **rejected** until you log in as admin and pre-allowlist him under **Admin → Users → New user**. That's the production behaviour — the bootstrap window has closed after the first admin exists.

For the production-shaped wiring (real `forward_auth` against an OIDC sidecar instead of static `request_header` injection), see [packages/providers/header-auth/README.md](../../packages/providers/header-auth/README.md).

---

## Day-2 operations

All from inside the deployment directory:

| Command                         | What it does                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run doctor`                | Re-validate env + providers + paths. Run after editing `.env`.                              |
| `npm run restart`               | `pm2 restart selva-compute --update-env` — picks up env changes.                            |
| `npm run logs`                  | Tail PM2 stdout/stderr (`Ctrl+C` to exit).                                                  |
| `npm run update`                | `npm update --save --prefer-online` for all `@selvajs/*` packages, then restart.            |
| `npm stop`                      | Stop the PM2 process.                                                                       |
| `npx selva keys rotate hmac`    | Rotate `SELVA_HMAC_KEY` (logs everyone out).                                                |
| `npx selva keys rotate at-rest` | Rotate `SELVA_AT_REST_KEY` (Rhino API key needs re-entry).                                  |
| `npx pm2 describe selva-compute`| Inspect the live process: cwd, env vars actually seen, uptime, restarts. Useful for debug.  |
| `npx pm2 list`                  | Quick "is it running" check. Equivalent to `pm2 ls` if you had pm2 on PATH (you don't).     |

The admin dashboard at `/admin/system` exposes the same `update` flow with live SSE output.

---

## Things that bit us — debug section

What follows is every failure mode we actually hit during the first deployment, with diagnostics and fixes. Read this if anything in Steps 1–8 doesn't behave as described.

> **Note on package names below.** Entries that reference `@selvajs/create@0.1.x` describe historical bugs from before the package was renamed to `@selvajs/cli`. The fixes still apply if you encounter the symptom on a legacy `@selvajs/create` install; everything new uses `@selvajs/cli`.

### "npm install failed" during scaffold, no useful error

The CLI used to call `execSync('npm install', { stdio: 'pipe' })` which buffered npm's output and silently discarded it on failure. All you'd see was `Command failed: npm install`.

Fixed in `@selvajs/create@0.1.3+`: install runs via `spawn`, streams progress to the spinner, and on failure dumps the last 80 lines of npm output before exiting.

If you're stuck on an older CLI version, find the real error here:

```bash
ls -t ~/.npm/_logs/ | head -3
tail -120 ~/.npm/_logs/<newest>-debug-0.log
```

Common causes:

- **sharp's native build fails** because `libvips` isn't installed. Fix: `sudo apt-get install -y build-essential python3 libvips-dev`, then `cd ~/apps/selva && npm install`.
- **Stale npm cache resolving an unpublished version.** Symptom in the log: `placeDep ROOT @selvajs/selva@<old-version> OK for: selva@... want: latest` where `<old-version>` no longer matches what's on npm. See the next entry — same fix applies.

### `npm run update` reports success but the version didn't change

Symptom: you ran `npm run update`, it said "Restarted selva-compute" without error, but `node -e "console.log(require('./node_modules/@selvajs/selva/package.json').version)"` shows the same version as before. The "current" and "new" runtime versions printed by `selva update` are identical.

Cause: **npm's packument cache.** Selva now calls `npm update --save --prefer-online`, which greatly reduces this problem by revalidating cached package metadata. But npm can still no-op if a publish is extremely fresh or not fully propagated yet, so the symptom is still worth recognizing.

This is not a Selva bug — it's npm metadata caching and registry propagation. The current CLI also warns when it detects `Current = New`, but the manual recovery below is still the fallback.

Confirm the registry actually has the version you expect:

```bash
# From your laptop or any machine that hasn't talked to the registry recently:
npm view @selvajs/selva version
npm view @selvajs/selva versions --json
```

If the registry shows a newer version than your VM installed, force npm to revalidate:

```bash
cd ~/apps/selva
npm cache clean --force
rm -rf node_modules package-lock.json
npm install --prefer-online
npm run restart
```

`--prefer-online` tells npm to revalidate cached manifests against the registry before using them. It helps, but it doesn't completely eliminate CDN or registry propagation delays.

`selva update` already uses `--prefer-online`. If it still prints identical current/new versions, use the manual cache-clear above.

### `Cannot find package 'tailwind-merge'` at runtime

Pre-`@selvajs/selva@0.10.1` shipped without `tailwind-merge` and `clsx` in its `dependencies`, even though the bundled SvelteKit build imports them via `tailwind-variants`.

Fixed in 0.10.1+. If you somehow land on an older runtime, the unblock is:

```bash
cd ~/apps/selva
npm install tailwind-merge clsx
npm run restart
```

### "Cross-site POST form submissions are forbidden"

SvelteKit's CSRF check compares the `Origin` header on POST requests against `env.ORIGIN`. If they don't match (including scheme — `http://` vs `https://`), the form submission is rejected.

```bash
grep ORIGIN ~/apps/selva/.env
```

The value here must exactly match the URL the browser is using — same scheme, same host, no trailing slash. Common mistakes:

- `ORIGIN=https://...` set but you're hitting `http://...` in the browser.
- `ORIGIN=http://1.2.3.4/` (trailing slash) but browser sends `Origin: http://1.2.3.4`.
- `.env` line corrupted by `echo >>` concatenation (see Step 5).

Fix `.env` with `nano`, then `npm run restart`.

### Login appears to succeed but I'm not signed in

Symptom: you click "Sign in", page reloads, you're back on `/login` with no visible error. Most common cause: **the session cookie has the `Secure` flag but you're on HTTP**, so the browser drops it.

Diagnose by hand:

```bash
curl -i -X POST http://localhost:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: http://<VM-IP>" \
  --data-urlencode "email=<your-admin-email>" \
  --data-urlencode "password=<your-password>" \
  2>&1 | grep -iE "HTTP/|set-cookie|location"
```

Expected on a healthy install:

```
HTTP/1.1 303 See Other
location: /admin
set-cookie: admin_session=...; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax
```

If you see `Secure` in the `set-cookie` line and you're on HTTP, add `ALLOW_INSECURE_COOKIES=true` to `.env` (see Step 5) and restart.

If you see `HTTP/1.1 200` and `{"type":"failure","status":401,"data":"[...]Invalid credentials"}`, the password really is wrong. The local provider stores its users in `~/apps/selva/.selva-data/auth-users.json`. To reset:

```bash
# Backup first
cp ~/apps/selva/.selva-data/auth-users.json{,.bak}
rm ~/apps/selva/.selva-data/auth-users.json
# Visit /setup again in the browser
```

### `npx selva ...` fails with "could not determine executable to run"

This was a bug in `@selvajs/create@0.1.0` — the `bin` entries were named `create-selva` and `selva`, neither matched the package short name `create`, so `npx` gave up.

Fixed in 0.1.1+. If stuck on 0.1.0:

```bash
npx -p @selvajs/create create-selva selva    # for scaffolding
./node_modules/.bin/selva doctor              # for operator commands (after scaffold)
```

After scaffold, the npm scripts (`npm run doctor`, `npm start`, etc.) always work regardless of CLI version — they invoke `selva` via `node_modules/.bin/` directly.

### `selva` not found after scaffold

Symptom: `npx selva doctor` errors with "could not determine executable to run", and `ls node_modules/.bin/ | grep selva` is empty.

Cause: `@selvajs/create@0.1.0`'s scaffolded `package.json` didn't list `@selvajs/create` as a dependency, so the `selva` bin never got linked into `node_modules/.bin/`.

Fixed in 0.1.1+. Unblock on the old version:

```bash
cd ~/apps/selva
npm install --save @selvajs/create
./node_modules/.bin/selva doctor
```

### `@selvajs/selva@0.10.2` pulls in unresolved `workspace:*` specs

If your scaffold's `npm install` shows `placeDep ROOT @selvajs/selva@0.10.2` and then dies with no error message, you've hit a broken publish. 0.10.2 was published via `npm publish` instead of `pnpm publish`, so its tarball contains literal `"workspace:*"` and `"catalog:"` specs that npm can't resolve.

0.10.2 has been unpublished. Force npm past the cache:

```bash
npm cache clean --force
cd ~/apps && rm -rf selva
npx --yes @selvajs/cli@latest selva
```

The runtime build script should hand-flatten these specs before publish to prevent this from recurring regardless of which publish tool is used.

### PM2 says `online` but the app is 502'ing through Caddy

```bash
npm run logs                              # or: npx pm2 logs selva-compute --lines 50 --nostream
```

If you see `ERR_MODULE_NOT_FOUND` for a package, that's a missing dependency in the published runtime. Workaround: `npm install <package>` in the deploy directory, then `npm run restart`. Report the missing package so the runtime can declare it.

If logs are clean but Caddy still 502s:

```bash
sudo ss -tlnp | grep -E ':80|:3000'
```

Expect to see `caddy` on `:80` and `node` on `:3000`. If `:3000` is missing, the app isn't listening — check `npx pm2 list` and `npm run logs` again.

### Doctor reports green but admin can't load `/admin`

Hard refresh the browser (`Ctrl+Shift+R`) — service workers from a previous deploy can serve stale routes.

If that doesn't fix it:

```bash
npx pm2 logs selva-compute --err --lines 40 --nostream
```

500s on `/admin` typically mean a permissions check threw. The local provider needs `.selva-data/` (under your deploy directory, or wherever `DATA_PATH` resolves) to be readable and writable by the user PM2 is running as — check ownership with `ls -la`.

---

## What this guide doesn't cover

- **HTTPS via your own cert** (not Let's Encrypt). Use Caddy's `tls /path/to/cert /path/to/key` directive.
- **Behind another proxy** (Cloudflare, AWS ALB, etc.). You'll likely need to set the proxy to forward `X-Forwarded-Proto` and configure the upstream Origin header so SvelteKit's CSRF check matches `ORIGIN` in your `.env`.
- **Supabase backend.** Pick `supabase` at Step 4 and provide URL + keys when prompted. The local-provider-specific sections (DATA_PATH, etc.) don't apply.
- **Header-auth (forward-auth) deployments.** Different setup story — the proxy authenticates and forwards identity headers; Selva doesn't run a login form. See `packages/providers/header-auth/README.md` for the full deployment checklist.
- **Multi-instance / load-balanced.** The local provider's JSON stores have no file locking; switching to PM2 cluster mode will corrupt data. Use Supabase or another concurrency-safe backend for multi-instance setups.
