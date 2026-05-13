# Compute-app dockerization & self-host UX plan

Drafted 2026-05-10. Companion to [DEBUG_SESSION_NOTES.md](./DEBUG_SESSION_NOTES.md).

## Why

Current deployment story is fragile:

- PM2 env handling is buggy (`env_file` unreliable, requires `pm2 kill` in a shell that has vars exported, no reboot survival without separate `pm2 startup` ritual).
- Secrets live inside the repo tree (`packages/selva/.env`).
- Caddy is HTTP-only on a bare IP — forces `ALLOW_INSECURE_COOKIES`, the Chrome insecure-origins flag, and blocks every secure-context Web API (`crypto.randomUUID`, `crypto.subtle`, clipboard, etc.).
- Nothing is reproducible — rebuilding the box is a multi-hour debug session, not a script.
- `update.sh` rebuilds on the box (`git pull` + `pnpm install` + `pnpm build` + `pm2 restart`), which is slow and couples runtime to a working dev toolchain.
- Self-hosters today have to read a long README and edit `.env` by hand. High install-time failure rate.

## Goal

Self-hosters install Selva by running one script, answering ~5 questions, and opening a browser. Updates are one command. The maintainer (you) never debugs PM2 or env files again.

## Recommended setup (the chosen path)

These are the picks the rest of the plan is written against. Alternatives are noted later but de-emphasized.

- **Storage**: bind-mount the data dir at a host path (default `/srv/selva/data`). Caddy state (`/data` — certs/ACME) stays in a named volume `caddy-data`. Reason: data is the lifelong asset and standard host tools (`rsync`, `restic`, ZFS snapshots, `du`) need to see it. Caddy state is regenerable, hide it.
- **Reverse proxy**: bundled Caddy by default; external proxy as a first-class alternative via a compose profile. The wizard asks once at install and persists the choice in `/etc/selva/install.json`.
- **Reboot survival**: a generated `selva.service` systemd unit runs `docker compose up -d` at boot. Don't rely on `restart: unless-stopped` alone — that only re-runs containers that were already running, not ones that need to come up after a host reboot.
- **Image versioning**: pin both tag and digest in compose (`image: ghcr.io/.../selva-compute:0.9.3@sha256:…`). Never `:latest` on prod. Rollback = revert two lines + `up -d`. No Watchtower.
- **Resource caps**: `mem_limit: 1g` on the app _only_ when host RAM ≥ 2GB. Always set `pids_limit: 256` and `restart: unless-stopped`. Leave `mem_limit` unset on 1GB hosts and resize the VM.
- **Log rotation**: `json-file` driver with `max-size: 10m` and `max-file: 5` on every service. Default is unbounded and will fill the disk.
- **Backup**: `backup.sh` wraps `restic` against the host bind-mount + `/etc/selva/{compute.env,Caddyfile,install.json}`. Restore = `restic restore` to a fresh path, then `systemctl start selva`.
- **Distribution**: `Dockerfile` lives in monorepo (`packages/selva/Dockerfile`); deploy artifacts (`docker-compose.yml`, `Caddyfile.template`, `setup.sh`, `backup.sh`) live in `deploy/` at repo root. Self-host install line: `git clone --depth 1 https://github.com/yourorg/selva && cd selva/deploy && ./setup.sh`. No separate `selva-deploy` repo, no curl-pipe-bash.

## Target user experience

```bash
git clone --depth 1 https://github.com/yourorg/selva
cd selva/deploy && ./setup.sh
```

Wizard prompts:

```
TLS termination:
  1) bundled Caddy with auto-Let's Encrypt (recommended)
  2) external — I have my own proxy / load balancer / Cloudflare in front
Domain (bundled Caddy only; "skip" for HTTP-only test setups):
Email for Let's Encrypt notifications (bundled Caddy only):
Public ORIGIN (external proxy only — e.g. https://compute.example.com):
Auth provider [local/supabase]:
Host data directory [/srv/selva/data]:    # bind-mounted into the container at /var/selva/data
Bootstrap admin email:
```

The host path is operator-visible (back it up, `du` it, snapshot the dataset it lives on). The container path is fixed at `/var/selva/data`; `DATA_PATH` in the generated env file points there. The wizard handles the host↔container mapping so users don't think about it, and `chown -R 1000:1000` the host dir so the container's non-root `node` user can write.

Script generates secrets, writes `/etc/selva/{compute.env,Caddyfile,install.json}`, installs `selva.service` (systemd unit), runs `systemctl enable --now selva`. Caddy auto-issues TLS in mode (1); the app publishes `127.0.0.1:3000` and Caddy stays out of the compose run in mode (2). User opens the URL, finishes setup in the admin UI (Rhino.Compute server, OAuth providers, feature flags). Never touches `.env` after first boot.

Day-to-day:

```bash
journalctl -u selva -f                          # tail systemd unit
docker compose -f /etc/selva/docker-compose.yml logs -f app    # tail app logs
systemctl restart selva                         # restart the whole stack
deploy/update.sh 0.9.4                          # pin new tag+digest, pull, up -d
```

## Deliverables

1. **`packages/selva/Dockerfile`** — multi-stage build, runtime image targeted at small-as-feasible (don't commit to a number in docs; SvelteKit + pnpm workspace lands closer to 300–500 MB on `node:20-slim` and only approaches ~150 MB with `node:20-alpine` _and_ `pnpm deploy` pruning).
2. **`deploy/docker-compose.yml`** — `app` service always present; `caddy` service behind a `bundled-caddy` compose profile so external-proxy users don't run it. Bind-mount for the data dir, named volume for `caddy-data`. Pinned image tag+digest. Log rotation configured. One external env file (`/etc/selva/compute.env`).
3. **`deploy/Caddyfile.template`** — domain-substitutable; auto-TLS when a domain is given, plain `:80` fallback when not. Easily editable post-install for users who want custom directives (basic auth, IP allowlists, headers).
4. **`deploy/setup.sh`** — interactive wizard. Generates secrets, asks the [wizard prompts](#target-user-experience), writes `/etc/selva/{compute.env,Caddyfile,install.json,docker-compose.yml}`, installs `selva.service`, runs `systemctl enable --now selva`. Persists answers to `install.json` so updates can regenerate config without re-asking. ~200 lines of bash.
5. **`deploy/selva.service`** (template) — systemd unit installed by `setup.sh`. Survives reboots without operator action.
6. **`deploy/install.json`** (runtime artifact, not source) — operator's wizard answers. Read by `setup.sh` on re-run / `update.sh` to regenerate compose + Caddyfile deterministically.
7. **`deploy/update.sh`** — takes a target version, resolves its image digest from GHCR, rewrites the pinned `image:` line in `/etc/selva/docker-compose.yml`, runs `docker compose pull && up -d`. Rollback is `update.sh <previous-version>`.
8. **`deploy/backup.sh`** — `restic` wrapper. Backs up the host data bind-mount + `/etc/selva/{compute.env,Caddyfile,install.json}`. Restore is documented in the README. Self-hosters need this on day one, not "later."
9. **CI workflow** (`.github/workflows/docker-publish.yml`) — builds + pushes the image to GHCR on release tags. Tags by version + git SHA. No `:latest` push on prod-targeted tags.
10. **Updated README** — replaces the current pnpm/PM2 install instructions with the Docker flow.
11. **Migration of env vars into in-app config** (see [Open decisions](#open-decisions)).
12. **Retire `update.sh` (the old one)** — replaced by `deploy/update.sh`.

## File shapes (provisional)

### `packages/selva/Dockerfile`

Multi-stage:

- **build stage**: `node:20-slim` + corepack + pnpm. Copies the workspace, runs `pnpm install --frozen-lockfile` and `pnpm run build:compute`. Then runs `pnpm deploy --filter=@selvajs/selva --prod /out` to produce a self-contained directory with the workspace symlinks resolved into real `node_modules/`. (Without `pnpm deploy`, copying `node_modules/` into the runtime image carries a forest of symlinks pointing at workspace packages that don't exist in the runtime stage.)
- **runtime stage**: `node:20-slim` (or `node:20-alpine` if size-driven). Copies `/out` and `build/` from the build stage. Runs as a non-root user (`node`, uid 1000). `EXPOSE 3000`. `CMD ["node", "build/index.js"]`.

**UID for bind-mounts**: data dir is bind-mounted by default, so `setup.sh` runs `chown -R 1000:1000` on the host path before first start. Container's `node` user (uid 1000) writes there.

### `deploy/docker-compose.yml`

```yaml
services:
  app:
    image: ghcr.io/yourorg/selva-compute:0.9.3@sha256:REPLACED_BY_setup.sh
    restart: unless-stopped
    env_file: /etc/selva/compute.env
    volumes:
      - /srv/selva/data:/var/selva/data # bind-mount; host path comes from install.json
    # In external-proxy mode setup.sh adds:
    #   ports: ["127.0.0.1:3000:3000"]
    # In bundled-caddy mode the app stays on the docker network only.
    pids_limit: 256
    # mem_limit: 1g       # only enabled on hosts with >= 2GB RAM (setup.sh decides)
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '5'

  caddy:
    profiles: ['bundled-caddy']
    image: caddy:2
    restart: unless-stopped
    ports: ['80:80', '443:443']
    volumes:
      - /etc/selva/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '5'

volumes:
  caddy-data:
```

`systemctl start selva` runs `docker compose --profile bundled-caddy up -d` in mode (1) and plain `docker compose up -d` in mode (2). The profile choice is read from `/etc/selva/install.json` by the systemd unit's `ExecStart`.

### `Caddyfile` shapes

**With domain** (bundled-caddy mode):

```caddy
{$DOMAIN} {
    reverse_proxy app:3000
    encode gzip
    header X-Content-Type-Options nosniff
    header X-Frame-Options DENY
}
```

Caddy auto-fetches a Let's Encrypt cert on first request. No manual cert management.

**No domain** (test/HTTP-only):

```caddy
:80 {
    reverse_proxy app:3000
}
```

Used only for IP-only test boxes; sets `ALLOW_INSECURE_COOKIES=true` in the env. Not recommended for any real users.

**External proxy mode**: no Caddyfile generated. `setup.sh` prints the integration snippet for the user's proxy of choice (Cloudflare, host nginx, GCP LB) — must forward to `http://127.0.0.1:3000` and pass `X-Forwarded-*` headers. `ORIGIN` is set from the wizard's "Public ORIGIN" answer.

### `deploy/selva.service`

```ini
[Unit]
Description=Selva compute-app
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/etc/selva
EnvironmentFile=/etc/selva/install.json.env    # written by setup.sh from install.json
ExecStart=/usr/bin/docker compose ${COMPOSE_PROFILE_FLAGS} up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

`COMPOSE_PROFILE_FLAGS` is `--profile bundled-caddy` or empty, depending on the install mode.

## Open decisions

These shape the work, decide before writing files.

### 1. Which env vars stay in `.env` vs move to in-app config?

Hard requirement: anything needed _before_ the data dir is readable must stay in env.

| Var                                                 | Stays in env                                                                                                                             | Could move to in-app config                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `SELVA_HMAC_KEY`                                    | ✅ (HMAC for cookies + share/invite tokens, needed at request time)                                                                      |                                                       |
| `SELVA_AT_REST_KEY`                                 | ✅ (decrypts at-rest secrets including… itself, chicken-and-egg)                                                                         |                                                       |
| `DATA_PATH`                                         | ✅ (literally where to find the rest)                                                                                                    |                                                       |
| `ORIGIN`                                            | ✅ (CSRF check runs before any DB read)                                                                                                  |                                                       |
| `PROVIDER_KIND` (local/supabase)                    | ✅                                                                                                                                       |                                                       |
| `SUPABASE_URL`, `SUPABASE_*_KEY`                    | ✅ (provider init reads at boot)                                                                                                         |                                                       |
| `BODY_SIZE_LIMIT`                                   | ✅ (adapter-node reads at boot)                                                                                                          |                                                       |
| `ALLOW_INSECURE_COOKIES`                            | ✅ (cookie-setting middleware reads at boot)                                                                                             |                                                       |
| Rhino.Compute URL + API key                         |                                                                                                                                          | ✅ (already in admin UI)                              |
| Feature flags (cross-org public, BYO compute, etc.) |                                                                                                                                          | ✅ (already in `selva.config.ts`)                     |
| OAuth provider list                                 |                                                                                                                                          | ✅ (could move; currently `SUPABASE_OAUTH_PROVIDERS`) |
| `BOOTSTRAP_INSTANCE_ADMIN_EMAIL`                    | ❓ — verify it's still load-bearing. If the in-app setup wizard already collects this, drop the env var rather than asking for it twice. |                                                       |

**Result**: env stays minimal. `setup.sh` only has to ask about provider, domain, admin email, data path — secrets are auto-generated. Most users never edit `compute.env` again after install.

### 2. Update mechanism

- **Phase 1 (now)**: `deploy/update.sh <version>` — looks up the digest for the requested tag, rewrites the pinned `image:` line, runs `docker compose pull && up -d`. Manual, deterministic, rollback-able.
- **Phase 2 (when there are real self-hosters)**: pick one of:
  - **Watchtower** (4 lines in compose, polls registry hourly). Best UX, least control. Rejected for now — pre-release wants known restarts.
  - **Host-side update agent** — small auth'd HTTP service the app calls. Keeps the admin-UI update button. ~50 lines.
  - **Webhook from CI** (registry push triggers server pull). Centralised but couples self-hosters to your CI.

Don't build phase 2 until phase 1 demonstrably hurts.

### 3. Image registry

- GitHub Container Registry (GHCR) — free for public, free for private up to org limits. Lives next to source.
- GCP Artifact Registry — fits if you're already on GCP.
- Docker Hub — works, rate-limits anonymous pulls.

Default: **GHCR**. No reason to add a vendor unless you need it.

### 4. Reverse proxy: keep Caddy or switch to Traefik?

Caddy: simpler, automatic TLS out of the box, what you have now.

Traefik: better at dynamic Docker discovery (auto-routes by container labels), but more config and bigger learning curve. No real benefit at this scale.

**Stick with Caddy.**

### 5. Bootstrap repo: separate or in-monorepo? — **DECIDED: in-monorepo `deploy/`**

- **In-monorepo `deploy/`** (chosen): one source of truth, install line is `git clone --depth 1 selva && cd selva/deploy && ./setup.sh`. Slightly longer than `curl | bash` but transparent and auditable.
- **Separate `selva-deploy` repo**: rejected — two repos to keep in sync at this scale is needless overhead.
- **`curl … | bash` install one-liner**: rejected — pre-release, no stable hosting, and self-hosters running our compute infra should be the kind of users who can `git clone`.

### 6. Storage: bind-mount or named volume? — **DECIDED: bind-mount data, named volume for Caddy state**

- **Data dir** (`/srv/selva/data` by default): bind-mount. Visible to `rsync`, `restic`, ZFS snapshots; survives `docker volume prune`; can sit on a chosen disk/dataset; backup integrates with whatever the host already runs. One-time cost: `chown -R 1000:1000` in `setup.sh`. Worth it.
- **Caddy `/data`** (cert/ACME state): named volume. Regenerable if lost, operators shouldn't edit it, hide it from the host filesystem.
- **Pure named volume for data**: rejected — long-term operability beats first-day ergonomics.

### 7. Reboot survival: how? — **DECIDED: systemd unit running `docker compose up -d`**

- **systemd unit** (chosen): `selva.service` invokes `docker compose up -d` at boot; OS handles ordering (`After=docker.service network-online.target`). Tested by the OS, not by the operator's memory.
- **`restart: unless-stopped` alone**: insufficient — only re-runs _already-running_ containers; doesn't help after a clean reboot if compose hasn't been invoked.
- **`pm2 startup`-equivalent for Docker** (Compose's built-in restart policies + Docker daemon enable): partial; still relies on the daemon's own boot ordering and offers no clean stop hook.

### 8. Image versioning: `:latest`, tag, or tag+digest? — **DECIDED: tag + digest, never `:latest` on prod**

- **Tag + digest** (chosen): `image: ghcr.io/.../selva-compute:0.9.3@sha256:…`. Reproducible, immune to tag mutation, rollback = revert two lines.
- **Tag only**: rejected — registry tags can be force-moved, breaks reproducibility silently.
- **`:latest`**: rejected outright on prod. Acceptable for local dev.
- **Watchtower / auto-update**: rejected — pre-release, you want to know when prod restarts.

## Migration plan

Order matters — each step lands a working improvement.

1. **Write `Dockerfile`** that builds locally. Smoke-test: `docker run -e SELVA_HMAC_KEY=... -e SELVA_AT_REST_KEY=... -e ... -p 3000:3000 selva-compute` boots and serves the app on localhost. No Caddy yet.
2. **Write `deploy/docker-compose.yml`** with app only. Run on local machine, verify it builds + boots from compose. Add the Caddy service behind the `bundled-caddy` profile and verify reverse-proxying works in both modes (with and without `--profile bundled-caddy`).
3. **Move `.env` decisions** — codify which vars are env vs in-app, update `.env.example`, fix the `BODY_SIZE_LIMIT` documentation bug found in the debug session.
4. **Write `deploy/setup.sh` + `deploy/selva.service` template** — wizard generates secrets, writes `/etc/selva/{compute.env,Caddyfile,install.json,docker-compose.yml}`, installs and enables the systemd unit. Test on a fresh GCP VM in both bundled-caddy and external-proxy modes.
5. **Write `deploy/update.sh` and `deploy/backup.sh`** — version pinning helper and `restic` backup wrapper. Test backup/restore round-trip on a throwaway VM.
6. **Write CI workflow** — builds + pushes image to GHCR on tag. Test by tagging a pre-release; confirm digest is reproducible.
7. **Cut over the running prod box** (bundled-caddy mode, since that's what's running now):
   - Snapshot the existing `.selva-data`: `tar czf /tmp/selva-data-pre-cutover.tgz -C /home/selva/selva .selva-data`.
   - Stop PM2 (`pm2 kill`), remove any prior systemd unit, stop host Caddy.
   - `mkdir -p /srv/selva/data && cp -a /home/selva/selva/.selva-data/. /srv/selva/data/ && chown -R 1000:1000 /srv/selva/data`.
   - Run `deploy/setup.sh`, point it at `/srv/selva/data` (it'll skip the `chown` if already correct).
   - `systemctl start selva`, verify admin login + uploads work, retain the snapshot for at least a week.
   - Tear down the old PM2 ecosystem.cjs / `.env` / host Caddy.
8. **Document** in [docs/deployment/selva/README](./README.md) — replaces the current `update.sh` and PM2 instructions.
9. **Reboot test**: `sudo reboot` the box, confirm the stack comes back without operator action. This is the acceptance test for the systemd unit.
10. **(Later)** address the OOM bug from the debug notes once the new setup is stable. Resize VM (preferred) — `mem_limit` only gets re-enabled in compose once the host has ≥ 2GB RAM.

## Risks / unknowns

- **pnpm + Docker monorepo nuances**: workspace symlinks and lockfile copying can produce images that "build" but don't run. Solvable but eats time. Mitigation: target ~half a day for the Dockerfile alone, multi-stage build with explicit `pnpm fetch`/`pnpm install --frozen-lockfile --offline`.
- **`@selvajs/builder-app` embedded assets** in the plugin build are a separate concern — they're built once at release time and embedded in the `.gha`, not served by the docker stack. Confirm the dockerization only affects compute-app, not the Grasshopper plugin pipeline.
- **The OOM bug isn't fixed by Dockerizing.** Still need to resize the VM or `mem_limit`. Dockerizing makes recovery cleaner (container restarts, Caddy keeps serving) but doesn't address root cause.
- **Cutover downtime**: ~5 minutes if the data volume mount is right. Plan for a maintenance window.
- **Backup story**: covered by `deploy/backup.sh` (restic wrapper) — bind-mounted data dir + `/etc/selva/{compute.env,Caddyfile,install.json}`. Restore documented in README.
- **`mem_limit` interaction with small VMs**: setting `mem_limit: 1g` on a 1GB host causes the container to be OOM-killed before the host's own process pressure does. On a 1GB e2-micro, leave `mem_limit` unset and resize the VM instead. `setup.sh` reads host RAM and only enables `mem_limit` when ≥ 2GB available.
- **systemd unit + docker compose timing**: on slow boots, `docker.service` may report ready before the daemon socket is fully responsive. If `selva.service` flaps on first reboot, the fix is `Type=oneshot` + a `docker info` precondition in `ExecStartPre` — known pattern, not a blocker.
- **External-proxy mode footgun**: if a user picks external-proxy mode but doesn't actually put a TLS-terminating proxy in front, the app exposes plain HTTP on `127.0.0.1:3000` only — but `ORIGIN` will be wrong and they'll see CSRF rejections. `setup.sh` should print a verification curl after install: `curl -H "Origin: $ORIGIN" -I http://127.0.0.1:3000/` and explain what success looks like.

## What this plan does NOT cover

- Cloud Run / managed-runtime alternative (separate decision; Dockerizing is a prerequisite either way, work isn't wasted).
- Multi-instance / horizontal scaling (single-tenant self-host is the target; scaling is a different doc).
- Observability beyond `docker compose logs` — metrics/tracing infrastructure is its own conversation.
- The Grasshopper plugin distribution (unchanged; still built into a `.gha`).
