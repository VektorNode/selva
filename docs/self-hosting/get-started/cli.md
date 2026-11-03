---
title: CLI
order: 3
published: true
description: 'Scaffold, configure, and operate a Selva deployment from the command line.'
---

# Selva CLI

- **`npx @selvajs/cli <dir>`** creates a deployment, once.
- **`npx selva <cmd>`** operates it, from inside the deployment directory. `selva` is not on your `PATH`; the tables below drop the `npx`. `selva <cmd> --help` explains one command, `selva help` lists them, `selva --version` prints the version.

## Create a deployment

```bash
npx @selvajs/cli my-deployment
cd my-deployment
npm run doctor    # validates the config before anything starts
npm start         # runs under pm2
```

It prompts for provider, origin, and tenancy, generates your secrets, and runs `npm install`. Flags: `--force` (non-empty target), `--skip-install`, `--yes` / `-y`.

`--yes` skips the prompts and reads the answers from env vars (`SELVA_TENANCY`, `SELVA_AUTH_PROVIDER`, `SELVA_DATA_PROVIDER`, `SELVA_STORAGE_PROVIDER`, `ORIGIN`, `SUPABASE_*`). It fails when a required one is missing, such as `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` with header auth or multi-tenancy. `CI=1` implies it.

**With Supabase, apply the database schema first.** The scaffold prints the commands but doesn't run them, and `npm run doctor` fails until you do. See [Apply the schema](../providers/supabase.md#3-apply-the-schema).

The directory gets `.env`, `ecosystem.config.cjs` (pm2), and a `package.json` that pins `pm2`. **Back up `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` from `.env`.** They're generated once, and [Secrets](../deployment/security-and-limits.md#secrets) says what losing each breaks. Settings are documented in [`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example).

### First boot, before HTTPS

Session cookies are `Secure`, so over plain HTTP logins appear to succeed but don't stick. Add `ALLOW_INSECURE_COOKIES=true` to `.env` until HTTPS is live. It isn't in `.env.example`. Use an editor, not `echo >>`: a missing trailing newline glues your line onto the last one.

## Operate a deployment

| Command                             | What it does                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `selva doctor [--fix]`              | Checks config, versions, and host tooling; exits non-zero.                      |
| `selva start`                       | `pm2 start ecosystem.config.cjs`                                                |
| `selva stop`                        | `pm2 stop selva-compute`                                                        |
| `selva restart`                     | `pm2 restart selva-compute --update-env`                                        |
| `selva logs`                        | Tails logs. Extra args pass through (`--lines 200`).                            |
| `selva update`                      | Updates `@selvajs/cli` and `@selvajs/selva`, then restarts.                     |
| `selva init`                        | Re-asks the setup questions and rewrites `.env`.                                |
| `selva migrate`                     | Brings an old deployment onto the current scaffold layout.                      |
| `selva setup-proxy`                 | Installs Caddy with TLS in front of the app. Flags: `--domain`, `--acme-email`. |
| `selva keys rotate <hmac\|at-rest>` | Replaces a secret (see below).                                                  |

`npm start`, `npm run stop|restart|logs|doctor|update` alias the matching commands.

- **`doctor` first.** It prints the fixing command for each failure. `--fix` repairs what it safely can, prompting first.
- **Use `selva restart`, not `pm2 restart`.** Without `--update-env`, pm2 keeps its old environment and your `.env` edit does nothing.
- **`init` keeps your secrets** and `package.json`. Restart afterwards.

### `keys rotate` is destructive

- **`hmac`:** everyone is logged out, and every share link, pending invite and API token stops working. That includes plugin sign-ins and MCP connections.
- **`at-rest`:** the stored Rhino.Compute API key becomes unreadable; re-enter it at `/admin/compute`.

It asks for confirmation first. Restart afterwards.

## About pm2

The deployment pins its own pm2 in `node_modules/.bin/` (`npx pm2`). **Don't install pm2 globally or from your distro.** Two versions on one daemon cause skew warnings and hung restarts, so `selva` refuses to use a global copy. When a release changes the pin, or `doctor` reports a global pm2, replace the daemon by hand (the app goes down briefly): see [Upgrading pm2](../deployment/prerequisites.md#upgrading-pm2).

## Running other Node apps on the same server

Give the other app its own pm2 daemon. pm2 picks its daemon from `$PM2_HOME` (default `~/.pm2`), so use either:

- **A separate OS user.**
- **A separate `PM2_HOME`**, set in every context that runs pm2 for that app (shell, systemd unit, cron). Miss one and it rejoins Selva's daemon. Each needs its own `pm2 startup` and `pm2 save`.

Don't `npm install -g pm2` for the other app: it wins the daemon, and `selva start` refuses because `pm2 update` would downgrade it and drop its process table.

## Troubleshooting

**Login succeeds but I'm not signed in.** Usually the `Secure` cookie problem above. Check whether `set-cookie` carries `Secure`:

```bash
curl -i -X POST http://localhost:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: http://<host>" \
  --data-urlencode "email=<email>" --data-urlencode "password=<password>" \
  2>&1 | grep -iE "HTTP/|set-cookie|location"
```

A `401`, in the status line or the JSON body, means a wrong password.

**Locked out of the local admin.** `/setup` redirects to `/login` while any user in `user-data.json` holds `instance_admin`, so deleting `auth-users.json` alone does not reopen it. Stop the app, then either:

- delete `.selva-data/` (`DATA_PATH`), which also wipes every definition and user; or
- delete `.selva-data/auth-users.json` and remove `instance_admin` from `platformPermissions` in `.selva-data/user-data.json`.

Start the app and visit `/setup`. In single-tenant mode it also creates a new org and project; the old ones stay.

**"Cross-site POST form submissions are forbidden".** `ORIGIN` in `.env` must match the browser URL exactly: same scheme and host, no trailing slash. Fix it and `npm run restart`.

**Unreachable from outside.** `HOST` defaults to `0.0.0.0`, so check your firewall. Only the header-auth scaffold sets `HOST=127.0.0.1`. Either way, put a [reverse proxy](../deployment/reverse-proxy.md) in front rather than opening port 3000.

**`npm run update` reports the same version.** npm's cache is stale:

```bash
npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online
npm run restart
```

**pm2 version-skew warning on boot.** The systemd unit points at a different pm2. Rewrite `ExecStart` and `ExecStop` in `/etc/systemd/system/pm2-$USER.service` to the deployment-local `…/node_modules/pm2/bin/pm2`, check them with `grep -E 'ExecStart|ExecStop' /etc/systemd/system/pm2-$USER.service`, then `sudo systemctl daemon-reload && sudo systemctl restart pm2-$USER`. If `selva start` says the running daemon is _newer_ than the local pm2, a global pm2 owns it: don't run `pm2 update`. Find it with `which -a pm2`, `pm2 -v`, `pm2 ping`.
