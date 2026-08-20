---
title: CLI
order: 3
published: true
description: 'Scaffold, configure, and operate a Selva deployment from the command line.'
---

# Selva CLI

Two commands, two jobs:

- **`npx @selvajs/cli <dir>`** creates a deployment. Run it once.
- **`selva <cmd>`** operates one that exists. Run it from inside the deployment directory.

The scaffold writes `npm run` aliases for the common ones, so `npm start` and `selva start` are the same thing.

## Create a deployment

```bash
npx @selvajs/cli my-deployment
cd my-deployment
npm run doctor    # validates the config before anything starts
npm start         # runs under pm2
```

It prompts for provider, origin, and tenancy, generates your secrets, and runs `npm install`.

| Flag             | Use it when                                            |
| ---------------- | ------------------------------------------------------ |
| `--force`        | The target directory exists and isn't empty.           |
| `--skip-install` | You want the files now and `npm install` later.        |
| `--yes` / `-y`   | Unattended: accept every default. `CI=1` implies this. |

### What lands in the directory

| File                   | What it's for                                                    |
| ---------------------- | ---------------------------------------------------------------- |
| `.env`                 | All config, including two secrets you should back up. See below. |
| `ecosystem.config.cjs` | Tells pm2 how to run the app.                                    |
| `package.json`         | Depends on `@selvajs/selva`, `@selvajs/cli`, and a pinned `pm2`. |

**Back up `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` from `.env`.** They're generated once, at create time. Losing the first logs everyone out; losing the second makes your stored Rhino.Compute API key unreadable. Every setting is documented inline in [`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example).

### First boot, before HTTPS

Start the app before a domain and reverse proxy are in front of it and logins will appear to succeed, then silently not stick: session cookies are marked `Secure` and browsers drop those over plain HTTP.

Add `ALLOW_INSECURE_COOKIES=true` to `.env` to get through the first boot, and remove it once HTTPS is live. Edit with a real editor rather than `echo >>` — if the file's last line has no trailing newline, `echo >>` glues your line onto it.

## Operate a deployment

Run these from the deployment directory. `selva <cmd> --help` explains one command; `selva --version` prints the CLI version.

| Command                             | What it does                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| `selva doctor [--fix]`              | Validates everything without starting the app.                     |
| `selva start`                       | `pm2 start ecosystem.config.cjs`                                   |
| `selva stop`                        | `pm2 stop selva-compute`                                           |
| `selva restart`                     | `pm2 restart selva-compute --update-env`                           |
| `selva logs`                        | Tails the logs. Extra args pass through: `selva logs --lines 200`. |
| `selva update`                      | Updates `@selvajs/cli` + `@selvajs/selva`, then restarts.          |
| `selva init`                        | Re-asks the setup questions and rewrites `.env`.                   |
| `selva migrate`                     | Brings an old deployment onto the current scaffold layout.         |
| `selva setup-proxy`                 | Installs and configures Caddy with TLS in front of the app.        |
| `selva keys rotate <hmac\|at-rest>` | Replaces a secret. Destructive; see below.                         |

`npm start`, `npm run stop`, `npm run restart`, `npm run logs`, `npm run doctor`, and `npm run update` alias the matching `selva` commands.

### `doctor` first, when something's wrong

It checks the deployment without starting it and exits non-zero on any failure, so it works in a CI job or health script. It covers required files, secret key format, provider and tenancy values, whether `DATA_PATH` is writable, whether `@selvajs/selva` is installed, `ORIGIN` validity, Node version, CLI/runtime version alignment, boot persistence, scaffold drift, provider-specific config, and deprecated env var names.

It also validates host tooling: that `npm` is present and not a distro-split version several majors behind Node, that only one Node installation is in play, that pm2 is installed locally at the pinned version, and that the running pm2 daemon matches it. Each failure prints the fixing command.

`--fix` repairs what it safely can, prompting before each change.

### `restart` vs. `pm2 restart`

Always use `selva restart`. It passes `--update-env`; without that flag pm2 reuses the environment it started with, so your `.env` edit does nothing and the app looks broken for no visible reason.

### `init` doesn't touch your secrets

It re-prompts using your current values as defaults and rewrites `.env`. It won't regenerate `SELVA_HMAC_KEY` or `SELVA_AT_REST_KEY`, and won't touch `package.json`. Restart afterwards.

### `keys rotate` is deliberately destructive

| Target    | Env var             | What breaks                                                                           |
| --------- | ------------------- | ------------------------------------------------------------------------------------- |
| `hmac`    | `SELVA_HMAC_KEY`    | Everyone is logged out; every share link and pending invite stops resolving.          |
| `at-rest` | `SELVA_AT_REST_KEY` | The stored Rhino.Compute API key becomes unreadable; re-enter it at `/admin/compute`. |

It prints the blast radius and asks for confirmation first. Restart afterwards. Rotating one doesn't affect the other — [Secrets](../concepts/security-and-limits.md#secrets) covers why.

## About pm2

Node and npm come from the host; Selva ships no Node runtime. pm2 is the one exception: the deployment ships its own pinned copy in `node_modules/.bin/`, which is what `npx pm2` resolves to from inside the directory.

**Don't install pm2 globally or from your distro's package manager.** Two pm2 versions talking to one background daemon causes version-skew warnings and hung restarts, so the `selva` commands refuse to fall back to a global copy. The pin is exact rather than caret-ranged so two deployments installed a week apart can't resolve differently and fight over one daemon.

`selva doctor` reports a global or distro pm2 on `PATH`. When a Selva release changes the pin, the running daemon has to be replaced once by hand — see [Upgrading pm2](../deployment/prerequisites.md#upgrading-pm2).

### Removing a global or distro pm2

If `doctor` reports one, from the deployment directory (the app goes down briefly):

```bash
npx pm2 kill                                    # stop the running daemon
sudo npm uninstall -g pm2                       # or: sudo apt remove pm2
npm install                                     # ensure the local pinned pm2 is present
npm start                                       # local pm2 forks a fresh daemon
npx pm2 save
npx pm2 startup systemd -u $USER --hp $HOME     # prints a sudo line to paste
npx pm2 save
```

The `startup` command prints a `sudo env PATH=…` line for you to run. **Check it references the deployment-local pm2** (`…/node_modules/pm2/bin/pm2`) before running it, and rewrite the path if it doesn't. Verify:

```bash
grep -E 'ExecStart|ExecStop' /etc/systemd/system/pm2-$USER.service
```

Then re-run `npm run doctor`.

## Running other Node apps on the same server

Fine, as long as the other app doesn't share Selva's pm2 daemon. pm2 picks its daemon from `$PM2_HOME` (default `~/.pm2`), so it's per-user, not per-machine. Isolate it either way:

- **A separate OS user** — different home, different `~/.pm2`, nothing to coordinate.
- **A separate `PM2_HOME`** — `export PM2_HOME=/srv/otherapp/.pm2`, set in every context that runs pm2 for that app (shell, systemd unit, cron). Miss one and it silently rejoins Selva's daemon.

Each `PM2_HOME` needs its own `pm2 startup` unit and `pm2 save`; one unit won't resurrect both.

What doesn't work is `npm install -g pm2` for the other app: a global pm2 usually outranks the deployment's pin and wins the daemon, and `selva start` then refuses, because `pm2 update` would downgrade the daemon and drop its process table — taking the other app down with Selva.

## Troubleshooting

### Login succeeds but I'm not signed in

Almost always the `Secure` cookie problem above. Confirm it:

```bash
curl -i -X POST http://localhost:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: http://<host>" \
  --data-urlencode "email=<email>" --data-urlencode "password=<password>" \
  2>&1 | grep -iE "HTTP/|set-cookie|location"
```

If `set-cookie` carries `Secure` and you're on HTTP, set `ALLOW_INSECURE_COOKIES=true`. A `200` with `401` JSON instead means the password is wrong. To reset a local-provider admin: `cp .selva-data/auth-users.json{,.bak} && rm .selva-data/auth-users.json`, then visit `/setup`.

### "Cross-site POST form submissions are forbidden"

`ORIGIN` in `.env` must match the browser URL exactly: same scheme, same host, no trailing slash. Fix it and `npm run restart`.

### The app is running but unreachable from outside

Expected until a reverse proxy is in front of it — Selva should only ever bind `127.0.0.1`. See [Reverse proxy](../deployment/reverse-proxy.md).

### `npm run update` reports the same version before and after

npm's packument cache is stale:

```bash
npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online
npm run restart
```

### pm2 version-skew warning on boot

The systemd unit points at a different pm2 than the one you manage the deployment with. Rewrite the `ExecStart` and `ExecStop` lines in `/etc/systemd/system/pm2-$USER.service` to the deployment-local binary, then:

```bash
sudo systemctl daemon-reload && sudo systemctl restart pm2-$USER
```

If `selva start` refuses outright, saying the running daemon is _newer_ than the local pm2, a global pm2 owns the daemon. Don't run `pm2 update` — it would downgrade the daemon and drop its process table. Find the conflict with `which -a pm2`, `pm2 -v`, and `pm2 ping`.

## Reference

- CLI source: [packages/cli/src/](https://github.com/VektorNode/selva/tree/main/packages/cli/src/)
- Deployment templates: [packages/selva/templates/](https://github.com/VektorNode/selva/tree/main/packages/selva/templates/)
- Every env var, documented inline: [packages/selva/.env.example](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example)
- Host prerequisites: [deployment/prerequisites.md](../deployment/prerequisites.md)
- Reverse proxy: [deployment/reverse-proxy.md](../deployment/reverse-proxy.md)
