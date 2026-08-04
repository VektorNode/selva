---
title: CLI
group: Get Started
order: 3
published: true
description: 'Scaffold, configure, and operate a Selva deployment from the command line.'
---

# Selva CLI

Two binaries ship with a deployment:

- **`@selvajs/cli`** — scaffolds a new deployment (`npx @selvajs/cli <dir>`).
- **`selva`** — operates an existing deployment (`node_modules/.bin/selva`), also exposed as `npm run <name>` scripts.

## Quick start

```bash
npx @selvajs/cli my-deployment
cd my-deployment
npm run doctor    # validate before starting
npm start         # selva start → pm2 start
npm run logs      # tail logs
npm run update    # update @selvajs/* and restart
```

## `npx @selvajs/cli <dir>`

Scaffolds a fresh deployment. Prompts for provider, origin, tenancy, and secrets; runs `npm install`.

```bash
npx @selvajs/cli my-deployment
npx @selvajs/cli my-deployment --force          # overwrite non-empty dir
npx @selvajs/cli my-deployment --skip-install
npx @selvajs/cli my-deployment --yes            # unattended: accept all defaults (also implied by CI=1)
```

What lands in `<dir>`:

| File                   | Purpose                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `.env`                 | All config. Contains `SELVA_HMAC_KEY` + `SELVA_AT_REST_KEY` — back these up.         |
| `ecosystem.config.cjs` | PM2 process definition.                                                              |
| `package.json`         | Depends on `@selvajs/selva` + `@selvajs/cli` (tracking `latest`) and a pinned `pm2`. |
| `.selva-version`       | Marker for CLI migrations.                                                           |

Secrets are generated once — use `selva keys rotate` to rotate them later. Env-var reference: [packages/selva/.env.example](../packages/selva/.env.example).

If HTTPS isn't live yet (e.g. first boot before a domain/reverse proxy is configured), session cookies default to `Secure` and get dropped by the browser over plain HTTP. Add `ALLOW_INSECURE_COOKIES=true` to `.env` temporarily, and remove it once HTTPS is live — edit with a real editor (`nano`), not `echo >>`: if the file's last line has no trailing newline, `echo >>` concatenates onto it instead of adding a new line.

## `selva` commands

All commands run from the deployment directory.

### `selva init`

Re-prompts for config and rewrites `.env` (uses existing values as defaults). Does not regenerate secrets or touch `package.json`. Restart afterwards.

### `selva doctor [--fix]`

Validates the deployment without starting it. Exits 0 on success, 1 on any failure. Checks: required files, secret key format, provider/tenancy values, `DATA_PATH` writability, `@selvajs/selva` installed, `ORIGIN` valid, Node engine compatibility, CLI/runtime version alignment, boot persistence, scaffold layout drift, provider-specific config (Supabase, header-auth), and deprecated env var names.

`--fix` applies the repairs it can make safely, prompting for confirmation on each.

### `selva start / stop / restart`

- `start` — `pm2 start ecosystem.config.cjs`
- `stop` — `pm2 stop selva-compute`
- `restart` — `pm2 restart selva-compute --update-env` (the `--update-env` flag picks up `.env` changes — always use this, never raw `pm2 restart`)

Do **not** install PM2 globally — use the deployment-local `pm2` in `node_modules/.bin/` (what `npx pm2` resolves to from inside the deployment directory). Two PM2s managing the same daemon causes version-skew issues.

To persist the process list across reboots: `npx pm2 save`. To auto-start PM2 on boot: `npx pm2 startup systemd -u $USER --hp $HOME` — it prints a `sudo env PATH=...` command. **Before pasting it, verify it references the deployment-local `pm2`** (e.g. `/home/you/apps/selva/node_modules/pm2/bin/pm2`), not a global one; rewrite it if not. Then run `npx pm2 save` again. Confirm the systemd unit uses the local binary with `grep -E 'ExecStart|ExecStop' /etc/systemd/system/pm2-$USER.service`.

### `selva logs`

`pm2 logs selva-compute`. Extra args pass through (e.g. `selva logs --lines 200`).

### `selva update`

Runs `npm update --save --prefer-online @selvajs/cli @selvajs/selva` and restarts. If before/after versions are identical despite a known new release, you've hit npm's stale packument cache — wait for the cache to expire and re-run.

### `selva migrate`

Brings an existing deployment's `package.json` onto the current scaffold layout (scripts, dependency shape). Run after major CLI upgrades; safe to re-run.

### `selva keys rotate <hmac|at-rest>`

Generates a fresh secret and writes it to `.env`. Asks for confirmation.

| Target    | Env var             | What it breaks                                                             |
| --------- | ------------------- | -------------------------------------------------------------------------- |
| `hmac`    | `SELVA_HMAC_KEY`    | Logs everyone out; invalidates share/invite tokens.                        |
| `at-rest` | `SELVA_AT_REST_KEY` | Encrypted Rhino API key becomes unreadable — re-enter at `/admin/compute`. |

Restart afterwards.

## npm script aliases

| `npm run …`       | Runs            |
| ----------------- | --------------- |
| `npm start`       | `selva start`   |
| `npm run stop`    | `selva stop`    |
| `npm run restart` | `selva restart` |
| `npm run logs`    | `selva logs`    |
| `npm run doctor`  | `selva doctor`  |
| `npm run update`  | `selva update`  |

## Troubleshooting

### Login appears to succeed but I'm not signed in

Session cookie has `Secure` flag but you're on HTTP — the browser drops it. Diagnose:

```bash
curl -i -X POST http://localhost:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: http://<host>" \
  --data-urlencode "email=<email>" --data-urlencode "password=<password>" \
  2>&1 | grep -iE "HTTP/|set-cookie|location"
```

If `set-cookie` contains `Secure` and you're on HTTP → add `ALLOW_INSECURE_COOKIES=true`. If the response is `200` + `401` JSON → wrong password. To reset a local-provider admin password: `cp .selva-data/auth-users.json{,.bak} && rm .selva-data/auth-users.json`, then visit `/setup`.

### "Cross-site POST form submissions are forbidden"

`ORIGIN` in `.env` must exactly match the browser URL — same scheme, same host, no trailing slash. Fix with `nano`, then `npm run restart`.

### App running but nothing reachable from outside

Expected before a reverse proxy is in front of it — see [Reverse proxy](deployment/reverse-proxy.md). Selva should only ever be bound to `127.0.0.1`.

### `npm run update` shows the same version before/after

npm packument cache. Force-clear:

```bash
npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online
npm run restart
```

### `@selvajs/selva@0.10.2` fails with unresolved `workspace:*`

That version was published incorrectly. Force past the cache:

```bash
npm cache clean --force && rm -rf node_modules package-lock.json
npx --yes @selvajs/cli@latest .   # re-scaffold in place, or into a fresh dir
```

### PM2 version-skew warning on boot

The systemd unit points at a different `pm2` than you manage with. Rewrite the `ExecStart`/`ExecStop` lines in `/etc/systemd/system/pm2-$USER.service` to the deployment-local binary, then `sudo systemctl daemon-reload && sudo systemctl restart pm2-$USER`.

## Source locations

- CLI source: [packages/cli/src/](../packages/cli/src/)
- Deployment templates: [packages/selva/templates/](../packages/selva/templates/)
- Env-var reference: [packages/selva/.env.example](../packages/selva/.env.example)
- Host prerequisites: [deployment/prerequisites.md](deployment/prerequisites.md)
- Reverse proxy: [deployment/reverse-proxy.md](deployment/reverse-proxy.md)
