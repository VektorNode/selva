---
title: CLI
order: 3
published: true
description: 'Scaffold, configure, and operate a Selva deployment from the command line.'
---

# Selva CLI

- **`npx @selvajs/cli <dir>`** creates a deployment, once.
- **`selva <cmd>`** operates it, from inside the deployment directory. `selva <cmd> --help` explains one command.

## Create a deployment

```bash
npx @selvajs/cli my-deployment
cd my-deployment
npm run doctor    # validates the config before anything starts
npm start         # runs under pm2
```

It prompts for provider, origin, and tenancy, generates your secrets, and runs `npm install`. Flags: `--force` (non-empty target), `--skip-install`, `--yes` / `-y` (accept defaults; `CI=1` implies it).

**With Supabase, apply the database schema first.** The scaffold prints the commands but doesn't run them, and `npm run doctor` fails until you do. See [Apply the schema](../providers/supabase.md#3-apply-the-schema).

The directory gets `.env`, `ecosystem.config.cjs` (pm2), and a `package.json` that pins `pm2`. **Back up `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` from `.env`.** They're generated once. Losing the first logs everyone out; losing the second makes the stored Rhino.Compute API key unreadable. Every setting is documented in [`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example).

### First boot, before HTTPS

Session cookies are `Secure`, so over plain HTTP logins appear to succeed but don't stick. Add `ALLOW_INSECURE_COOKIES=true` to `.env` until HTTPS is live. Use an editor, not `echo >>`: a missing trailing newline glues your line onto the last one.

## Operate a deployment

| Command                             | What it does                                                |
| ----------------------------------- | ----------------------------------------------------------- |
| `selva doctor [--fix]`              | Checks config, versions, and host tooling; exits non-zero.  |
| `selva start`                       | `pm2 start ecosystem.config.cjs`                            |
| `selva stop`                        | `pm2 stop selva-compute`                                    |
| `selva restart`                     | `pm2 restart selva-compute --update-env`                    |
| `selva logs`                        | Tails logs. Extra args pass through (`--lines 200`).        |
| `selva update`                      | Updates `@selvajs/cli` and `@selvajs/selva`, then restarts. |
| `selva init`                        | Re-asks the setup questions and rewrites `.env`.            |
| `selva migrate`                     | Brings an old deployment onto the current scaffold layout.  |
| `selva setup-proxy`                 | Installs Caddy with TLS in front of the app.                |
| `selva keys rotate <hmac\|at-rest>` | Replaces a secret (see below).                              |

`npm start`, `npm run stop|restart|logs|doctor|update` alias the matching commands.

- **`doctor` first.** It prints the fixing command for each failure. `--fix` repairs what it safely can, prompting first.
- **Use `selva restart`, not `pm2 restart`.** Without `--update-env`, pm2 keeps its old environment and your `.env` edit does nothing.
- **`init` keeps your secrets** and `package.json`. Restart afterwards.

### `keys rotate` is destructive

| Target    | What breaks                                                                           |
| --------- | ------------------------------------------------------------------------------------- |
| `hmac`    | Everyone is logged out; every share link and pending invite stops resolving.          |
| `at-rest` | The stored Rhino.Compute API key becomes unreadable; re-enter it at `/admin/compute`. |

It asks for confirmation first. Restart afterwards. See [Secrets](../deployment/security-and-limits.md#secrets).

## About pm2

The deployment pins its own pm2 in `node_modules/.bin/` (`npx pm2`). **Don't install pm2 globally or from your distro.** Two versions on one daemon cause skew warnings and hung restarts, so `selva` refuses to use a global copy. When a release changes the pin, replace the daemon once by hand: see [Upgrading pm2](../deployment/prerequisites.md#upgrading-pm2).

If `doctor` reports a global pm2, run this from the deployment directory (the app goes down briefly):

```bash
npx pm2 kill                                    # stop the running daemon
sudo npm uninstall -g pm2                       # or: sudo apt remove pm2
npm install                                     # ensure the local pinned pm2 is present
npm start                                       # local pm2 forks a fresh daemon
npx pm2 save
npx pm2 startup systemd -u $USER --hp $HOME     # prints a sudo line to paste
npx pm2 save
```

Before running the printed `sudo env PATH=…` line, check it references `…/node_modules/pm2/bin/pm2`, and fix the path if not. Verify with `grep -E 'ExecStart|ExecStop' /etc/systemd/system/pm2-$USER.service`, then `npm run doctor`.

## Running other Node apps on the same server

Give the other app its own pm2 daemon. pm2 picks its daemon from `$PM2_HOME` (default `~/.pm2`), so use either:

- **A separate OS user.**
- **A separate `PM2_HOME`**, set in every context that runs pm2 for that app (shell, systemd unit, cron). Miss one and it rejoins Selva's daemon. Each needs its own `pm2 startup` and `pm2 save`.

Don't `npm install -g pm2` for the other app: it wins the daemon, and `selva start` refuses because `pm2 update` would downgrade it and drop its process table.

## Troubleshooting

**Login succeeds but I'm not signed in.** Usually the `Secure` cookie problem above. If `set-cookie` carries `Secure` and you're on HTTP, set `ALLOW_INSECURE_COOKIES=true`:

```bash
curl -i -X POST http://localhost:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: http://<host>" \
  --data-urlencode "email=<email>" --data-urlencode "password=<password>" \
  2>&1 | grep -iE "HTTP/|set-cookie|location"
```

A `200` with `401` JSON means a wrong password. To reset a local-provider admin: `cp .selva-data/auth-users.json{,.bak} && rm .selva-data/auth-users.json`, then visit `/setup`.

**"Cross-site POST form submissions are forbidden".** `ORIGIN` in `.env` must match the browser URL exactly: same scheme and host, no trailing slash. Fix it and `npm run restart`.

**Unreachable from outside.** Expected: Selva binds `127.0.0.1` only. Put a [reverse proxy](../deployment/reverse-proxy.md) in front.

**`npm run update` reports the same version.** npm's cache is stale:

```bash
npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online
npm run restart
```

**pm2 version-skew warning on boot.** The systemd unit points at a different pm2. Rewrite `ExecStart` and `ExecStop` in `/etc/systemd/system/pm2-$USER.service` to the deployment-local binary, then `sudo systemctl daemon-reload && sudo systemctl restart pm2-$USER`. If `selva start` says the running daemon is _newer_ than the local pm2, a global pm2 owns it: don't run `pm2 update`. Find it with `which -a pm2`, `pm2 -v`, `pm2 ping`.

## Reference

- [packages/cli/src/](https://github.com/VektorNode/selva/tree/main/packages/cli/src/)
- [packages/selva/templates/](https://github.com/VektorNode/selva/tree/main/packages/selva/templates/)
- [Host prerequisites](../deployment/prerequisites.md)
