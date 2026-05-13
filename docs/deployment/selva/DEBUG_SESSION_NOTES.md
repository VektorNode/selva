# Compute-app deploy debug notes

Session: 2026-05-09. Server: GCP `selva-compute-app`, zone `europe-west6-a`, IP `34.65.79.16`.

SSH: `gcloud compute ssh selva@selva-compute-app --zone europe-west6-a`

> **2026-05-11 update — env_file issue resolved.** Root cause: PM2's `env_file` is a `pm2-runtime`-only feature and is silently ignored by the regular `pm2 start` daemon. Switched `ecosystem.config.cjs` to `node_args: '--env-file=.env'` (Node >= 20.6 native flag), which loads `.env` reliably regardless of how PM2 was invoked. The `pm2 kill` + `set -a; . ./.env` workaround described below is no longer needed.
>
> **Env-var names below are pre-rename.** Same-day refactor (commit `16642ca9`, 2026-05-11) renamed the two local-provider secrets:
>
> - `SESSION_SECRET` → `SELVA_HMAC_KEY`
> - `SELVA_SECRET_KEY` → `SELVA_AT_REST_KEY`
>
> Translate as you read. The authoritative current names live in [`packages/selva/.env.example`](../../../packages/selva/.env.example).

## Current state

- Caddy on `:80` reverse-proxying to `127.0.0.1:3000`. Caddyfile: `/etc/caddy/Caddyfile` (vanilla reverse_proxy, no body limits, HTTP only).
- App: SvelteKit (adapter-node) at `/home/selva/selva/packages/selva/`, run via PM2.
- PM2 ecosystem: `/home/selva/selva/ecosystem.config.cjs`. `cwd` = `/home/selva/selva/packages/selva`, `script` = `./build/index.js`.
- `.env` at `/home/selva/selva/packages/selva/.env` — chmod 600. PM2 doesn't read `env_file` reliably; current workaround is `set -a && . ./.env && set +a` in the shell, then `pm2 kill && pm2 start ecosystem.config.cjs`. Daemon must be killed (not just restarted) for new env to take effect.
- `.env` contents (working values, all `KEY=VALUE` format, LF line endings):
  - `PORT=3000`
  - `ORIGIN="http://34.65.79.16"`
  - `ALLOW_INSECURE_COOKIES="true"` (because plain HTTP)
  - `BODY_SIZE_LIMIT=62914560` (60 MB as bytes — adapter-node rejects `"60mb"` and `"Infinity"`)
  - `SESSION_SECRET=...` (32-byte hex, set)
  - `SELVA_SECRET_KEY=...` (32-byte hex, set)
  - `DATA_PATH="/home/selva/selva/.selva-data"` (absolute; `.selva-data` exists, owned by `selva`, writable, contains auth-users.json + setup data)
- App boots cleanly. `curl -I http://34.65.79.16/` → 200 OK. Setup completed, can sign in.
- Browser uses `chrome://flags/#unsafely-treat-insecure-origin-as-secure` with `http://34.65.79.16` to satisfy `crypto.randomUUID` (secure-context API). Required because we're on HTTP.

## The remaining bug

POST `/api/definitions` (file upload, 173 KB) returns **502** in the browser. Caddy log: `read tcp 127.0.0.1:NNN->127.0.0.1:3000: read: connection reset by peer`. Origin matches, cookie present.

Confirmed NOT the cause:

- CSRF / Origin (matches `ORIGIN` env exactly)
- Body size (173 KB << 60 MB cap)
- `.selva-data` permissions (writable, other endpoints write fine)
- Multipart parsing itself (anonymous multipart POST returns clean 401, no reset)

## Root-cause hypothesis: OOM kill

Foreground node test surfaced `Killed` on its own line — that's `SIGKILL` from the kernel, almost certainly the OOM killer. No stack trace because SIGKILL is unblockable. Explains:

- Connection reset by peer (process vanished mid-request)
- Empty PM2 err log (no exception path)
- 173 KB file is enough to OOM if VM has ~1 GB RAM (e2-micro)

## Resume here

1. **Confirm OOM diagnosis on the server:**

   ```bash
   sudo dmesg | grep -i -E 'killed process|out of memory|oom-killer' | tail -20
   free -h
   cat /proc/meminfo | grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree'
   ```

   Expect to see an OOM event matching the timestamp of an upload attempt.

2. **Pick a fix:**
   - **Resize VM** (preferred): GCP console → stop instance → e2-small (2 GB) or e2-medium (4 GB) → start. Most likely solves it outright.
   - **Add swap** (stopgap):
     ```bash
     sudo fallocate -l 2G /swapfile
     sudo chmod 600 /swapfile
     sudo mkswap /swapfile
     sudo swapon /swapfile
     echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
     ```
   - **Diagnostic only**: run with `node --max-old-space-size=512` to convert OOM-kill into a JS heap error with stack — tells us _which_ allocation explodes, useful if a code fix is wanted instead of throwing more RAM at it.

3. **After fixing, verify:** retry browser upload, check `pm2 logs --err` (should stay clean), confirm 200 on `/api/definitions`.

## Outstanding cleanup (after upload works)

- **Reboot survival**: PM2 currently inherits env from the shell where it was last `pm2 start`'d. After a reboot, secrets are gone. Either set up `pm2 startup` with a systemd `EnvironmentFile=` pointing at `.env`, or inline secrets into `ecosystem.config.cjs`'s `env: { … }` (and `chmod 600` it).
- **TLS**: required before any real users. Easiest = point a domain at `34.65.79.16`, change Caddyfile site block to the domain, Caddy auto-issues Let's Encrypt. Then update `.env`: `ORIGIN=https://your-domain`, remove `ALLOW_INSECURE_COOKIES`. After that, drop the Chrome insecure-origins flag.
- **Rotate the secrets**. `SESSION_SECRET` and `SELVA_SECRET_KEY` were pasted in chat — fine for this test box, must not reuse on production.
- `BODY_SIZE_LIMIT`: currently 60 MB which is sane. `.env.example` claims `"60mb"` / `"Infinity"` work; in this adapter-node version they don't — only raw bytes are accepted. Worth fixing the docstring in `packages/selva/.env.example`.

## Concrete file state (copy as reference)

### `/home/selva/selva/packages/selva/.env`

`chmod 600`, owner `selva:selva`, LF line endings only:

```
PORT=3000
ORIGIN="http://34.65.79.16"
ALLOW_INSECURE_COOKIES="true"

# Request body size limit for large geometry uploads (bytes; this adapter-node
# version does NOT accept "60mb" or "Infinity" — must be a raw integer)
BODY_SIZE_LIMIT=62914560

SESSION_SECRET="585ead9558fdd15caa0f70f612fe4b4d4d2281621cf8203ef41b929dfb2896d1"
SELVA_SECRET_KEY="3530396b403b792f97d34b4016470c4717486653311d71e383c5909bc37c4bfd"
DATA_PATH="/home/selva/selva/.selva-data"
```

(Secrets above were pasted in chat during the session — rotate before any real launch.)

### `/home/selva/selva/ecosystem.config.cjs`

```js
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './build/index.js',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			cwd: '/home/selva/selva/packages/selva',
			env_file: '/home/selva/selva/packages/selva/.env'
		}
	]
};
```

`env_file` is set but not relied on (this PM2 version doesn't read it consistently — see workaround below). Both `env:` block and `env_file` cannot coexist; the `env:` block clobbers `env_file`.

### `/etc/caddy/Caddyfile`

Unchanged from initial deploy:

```caddy
:80 {
    reverse_proxy localhost:3000 {
        header_up X-Forwarded-Proto "http"
        header_up X-Forwarded-Host {http.request.host}
        header_up X-Real-IP {http.request.remote.host}
    }

    encode gzip

    header / X-Content-Type-Options nosniff
    header / X-Frame-Options DENY
    header / X-XSS-Protection "1; mode=block"
}
```

Caddy itself logs a warning that `header_up X-Forwarded-Host` is redundant (default behavior). Harmless but worth cleaning up.

## Changes made during session

1. **`ecosystem.config.cjs`**:
   - `cwd` was `/home/selva/selva` (repo root) → changed to `/home/selva/selva/packages/selva`. This was needed because `DATA_PATH=../../.selva-data` (the `.env.example` default) is documented as resolved relative to `packages/selva/`. With cwd at the repo root it resolved to `/home/.selva-data`, which doesn't exist.
   - `script` was `./packages/selva/build/index.js` → changed to `./build/index.js` to match the new cwd.
   - Added `env_file:` line (then made it absolute path).
   - Removed the `env: { NODE_ENV: 'production' }` block — having `env` and `env_file` together silently disables `env_file`. `NODE_ENV` is intended to be in `.env` instead (currently not set; see cleanup list).

2. **`.env`** evolution:
   - Started missing `SESSION_SECRET`, `SELVA_SECRET_KEY` → added both (32-byte hex via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - Had a malformed `DATA_PATH: '/home/selva/selva-data',` (YAML/JS object syntax with colon and trailing comma) which caused `DATA_PATH:: command not found` when shell-sourced. Fixed to `DATA_PATH="/home/selva/selva/.selva-data"` (absolute, dotenv format).
   - `BODY_SIZE_LIMIT` was `"Infinity"` → `"60mb"` → finally `62914560` (raw bytes; adapter-node rejected the string forms with `Invalid BODY_SIZE_LIMIT: ... Please provide a numeric value`).
   - Added `ORIGIN="http://34.65.79.16"` (required by SvelteKit CSRF check behind a proxy).
   - Added `ALLOW_INSECURE_COOKIES="true"` (required because we're on plain HTTP — drop once TLS is in front).

3. **Filesystem**:
   - Created `/home/selva/selva/.selva-data/` (owner `selva:selva`, mode 775). Now contains `auth-users.json`, `local-org.json`, `user-data.json`, `compute.config.json` from completed setup.
   - `.env` set to `chmod 600`.

## How to bring the app back up cleanly (cheat sheet)

```bash
# Confirm we're the selva user on the right box
gcloud compute ssh selva@selva-compute-app --zone europe-west6-a

# Source env into the shell (PM2 inherits this on daemon start)
cd /home/selva/selva
set -a && . /home/selva/selva/packages/selva/.env && set +a

# Sanity check
echo "$DATA_PATH"          # /home/selva/selva/.selva-data
echo "$SESSION_SECRET"     # hex string
echo "$ORIGIN"             # http://34.65.79.16

# Kill any stragglers + restart
pm2 kill
pkill -9 -f 'node.*build/index.js'      # only if 'ss -tlnp | grep 3000' is non-empty
pm2 start /home/selva/selva/ecosystem.config.cjs
pm2 save
sleep 3

# Verify
pm2 status                                                        # online, ↺ 0
pm2 env 0 | grep -E '(SESSION_SECRET|DATA_PATH|ORIGIN|BODY_SIZE)'  # all four present
ss -tlnp | grep 3000                                              # node bound
curl -I http://34.65.79.16/                                       # 200 OK

# Tail live logs
pm2 logs selva-compute --lines 0
```

## Foreground-debug recipe (when PM2 is hiding errors)

```bash
pm2 kill
pkill -9 -f 'node.*build/index.js'
sleep 1
ss -tlnp | grep 3000      # MUST be empty

cd /home/selva/selva/packages/selva
set -a && . ./.env && set +a
node --unhandled-rejections=strict --trace-warnings build/index.js
# leave running; trigger the failing flow from a SECOND ssh session or browser
# whatever prints in this terminal IS the answer
```
