---
title: CLI
order: 3
published: false
description: 'Scaffold, configure, and operate a Selva deployment from the command line.'
---

# Selva CLI

There are two commands, and the split matters:

- **`npx @selvajs/cli <dir>`** creates a deployment. You run it once.
- **`selva …`** operates one that already exists. You run it from inside the deployment directory, forever after.

The scaffold also writes `npm run` aliases for the commands you'll use most, so `npm start` and `selva start` are the same thing. Use whichever you like.

## Create a deployment

```bash
npx @selvajs/cli my-deployment
cd my-deployment
npm run doctor    # checks the config before anything starts
npm start         # runs under pm2, which keeps it alive
```

It asks a handful of questions (provider, origin, tenancy), generates your secrets, and runs `npm install`. That's the whole setup.

Flags, if you need them:

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

**Back up `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY` from `.env`.** They're generated once, at create time. Losing the first logs everyone out; losing the second makes your stored Rhino.Compute API key unreadable. Every setting in the file is documented inline in [`.env.example`](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example).

### First boot, before HTTPS

If you start the app before a domain and reverse proxy are in front of it, logins will appear to succeed and then silently not stick. Session cookies are marked `Secure`, and browsers drop those over plain HTTP.

Add `ALLOW_INSECURE_COOKIES=true` to `.env` to get through the first boot, and remove it once HTTPS is live. Edit with a real editor (`nano`) rather than `echo >>`; if the file's last line has no trailing newline, `echo >>` glues your line onto the end of it.

## Operate a deployment

Run these from the deployment directory.

| Command                             | What it does                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| `selva doctor [--fix]`              | Validates everything without starting the app.                     |
| `selva start`                       | Starts the app under pm2.                                          |
| `selva stop`                        | Stops it.                                                          |
| `selva restart`                     | Restarts it, picking up `.env` changes.                            |
| `selva logs`                        | Tails the logs. Extra args pass through: `selva logs --lines 200`. |
| `selva update`                      | Updates the `@selvajs/*` packages and restarts.                    |
| `selva init`                        | Re-asks the setup questions and rewrites `.env`.                   |
| `selva migrate`                     | Brings an old deployment onto the current scaffold layout.         |
| `selva setup-proxy`                 | Installs and configures Caddy with TLS in front of the app.        |
| `selva keys rotate <hmac\|at-rest>` | Replaces a secret. Destructive; see below.                         |

`npm start`, `npm run stop`, `npm run restart`, `npm run logs`, `npm run doctor`, and `npm run update` alias the matching `selva` commands.

### `doctor` is the first thing to run when something's wrong

It checks the deployment without starting it, and exits non-zero on any failure, so it works in a CI job or a health script too. It covers required files, secret key format, provider and tenancy values, whether `DATA_PATH` is writable, whether `@selvajs/selva` is actually installed, `ORIGIN` validity, Node version, CLI/runtime version alignment, boot persistence, scaffold drift, provider-specific config, and deprecated env var names.

It also validates the host tooling itself: that `npm` is present and not a distro-split version several majors behind Node, that only one Node installation is in play, that pm2 is installed locally at the pinned version, and that the running pm2 daemon matches it. Each failure prints the command that fixes it.

`--fix` repairs what it safely can, asking before each change.

### `restart` vs. `pm2 restart`

Always use `selva restart`. It passes `--update-env`, and without that flag pm2 reuses the environment it started with, so your `.env` edit does nothing and the app looks broken for no visible reason.

### `init` doesn't touch your secrets

It re-prompts for config using your current values as defaults and rewrites `.env`. It won't regenerate `SELVA_HMAC_KEY` or `SELVA_AT_REST_KEY`, and it won't touch `package.json`. Restart afterwards.

### `keys rotate` is deliberately destructive

| Target    | Env var             | What breaks                                                                           |
| --------- | ------------------- | ------------------------------------------------------------------------------------- |
| `hmac`    | `SELVA_HMAC_KEY`    | Everyone is logged out; every share link and pending invite stops resolving.          |
| `at-rest` | `SELVA_AT_REST_KEY` | The stored Rhino.Compute API key becomes unreadable; re-enter it at `/admin/compute`. |

It asks for confirmation and prints the blast radius first. Restart afterwards.

Rotating one doesn't affect the other, which is the point of keeping them separate:
[Secrets](../concepts/security-and-limits.md#secrets) covers why, and exactly what an HMAC
rotation does and doesn't break.

## What the host provides, and what Selva brings

| Tool         | Comes from                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Node.js, npm | **The host.** Distro packages, NodeSource, nvm — whatever you already use. Selva ships no Node runtime. |
| pm2          | **The deployment.** Pinned in the scaffold's `package.json`, installed into `node_modules/`.            |

Use your normal system packages for Node and npm; nothing is duplicated there. pm2 is the one deliberate exception, and the reason is below.

## About pm2

Selva runs the app under [pm2](https://pm2.keymetrics.io), a process manager that restarts it if it crashes and brings it back after a reboot.

**Don't install pm2 globally, and don't install it from your distro's package manager.** The deployment ships its own pinned copy in `node_modules/.bin/`, which is what `npx pm2` resolves to from inside the directory. Two different pm2 versions talking to the same background daemon causes version-skew warnings and hung restarts, and the `selva` commands refuse to fall back to a global one for exactly that reason. The version is pinned exactly rather than caret-ranged so two deployments installed a week apart can't resolve differently and then fight over one daemon.

That rules out a global pm2, not other pm2-managed apps — see [below](#running-other-node-apps-on-the-same-server).

`selva doctor` reports a global or distro pm2 on `PATH`, so if you're unsure what a server has, run it before changing anything.

When a Selva release changes the pinned pm2 version, the running daemon has to be replaced once by hand — see [Upgrading pm2](../deployment/prerequisites.md#upgrading-pm2).

### Removing a global or distro pm2

If `doctor` reports one, from the deployment directory (the app goes down briefly):

```bash
npx pm2 kill                                    # stop the running daemon
sudo npm uninstall -g pm2                       # or: sudo apt remove pm2
npm install                                     # ensure the local pinned pm2 is present
npm start                                       # local pm2 forks a fresh daemon
npx pm2 save
npx pm2 startup systemd -u $USER --hp $HOME     # re-run; paste the printed sudo line
npx pm2 save
```

Re-run `npm run doctor` afterwards to confirm the daemon and the systemd unit both point at the local pm2.

To survive reboots:

```bash
npx pm2 save                                    # remember the running process list
npx pm2 startup systemd -u $USER --hp $HOME     # prints a sudo command to run
npx pm2 save                                    # save again once the unit exists
```

The `startup` command prints a `sudo env PATH=…` line for you to paste. **Check it references the deployment-local pm2** (something like `/home/you/apps/selva/node_modules/pm2/bin/pm2`) before running it, and rewrite the path if it doesn't. Verify afterwards:

```bash
grep -E 'ExecStart|ExecStop' /etc/systemd/system/pm2-$USER.service
```

## Running other Node apps on the same server

Fine, as long as the other app doesn't share Selva's pm2 daemon. pm2 picks its daemon from `$PM2_HOME` (default `~/.pm2`), so it's per-user, not per-machine. Isolate it either way:

- **A separate OS user** — different home, different `~/.pm2`, nothing to coordinate.
- **A separate `PM2_HOME`** — `export PM2_HOME=/srv/otherapp/.pm2`, set in every context that runs pm2 for that app (shell, systemd unit, cron). Miss one and it silently rejoins Selva's daemon.

Each `PM2_HOME` needs its own `pm2 startup` unit and `pm2 save`; one unit won't resurrect both.

What doesn't work is `npm install -g pm2` for the other app: a global pm2 usually outranks the deployment's pin and wins the daemon, and `selva start` then refuses, because `pm2 update` would downgrade the daemon and drop its process table — taking the other app down with Selva.

## Troubleshooting

### Login succeeds but I'm not signed in

Almost always the `Secure` cookie problem described above. Confirm it:

```bash
curl -i -X POST http://localhost:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Origin: http://<host>" \
  --data-urlencode "email=<email>" --data-urlencode "password=<password>" \
  2>&1 | grep -iE "HTTP/|set-cookie|location"
```

If `set-cookie` carries `Secure` and you're on HTTP, set `ALLOW_INSECURE_COOKIES=true`. If you get a `200` with `401` JSON instead, the password is simply wrong. To reset a local-provider admin, run `cp .selva-data/auth-users.json{,.bak} && rm .selva-data/auth-users.json` and visit `/setup`.

### "Cross-site POST form submissions are forbidden"

`ORIGIN` in `.env` has to match the URL in the browser exactly: same scheme, same host, no trailing slash. Fix it and `npm run restart`.

### The app is running but unreachable from outside

Expected until a reverse proxy is in front of it. Selva should only ever bind to `127.0.0.1`. See [Reverse proxy](../deployment/reverse-proxy.md).

### `npm run update` reports the same version before and after

npm's packument cache is stale. Force it:

```bash
npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online
npm run restart
```

### `@selvajs/selva@0.10.2` fails with unresolved `workspace:*`

That version was published broken and unpublished since; your cache is holding onto it.

```bash
npm cache clean --force && rm -rf node_modules package-lock.json
npx --yes @selvajs/cli@latest .   # re-scaffold in place, or into a fresh dir
```

### pm2 version-skew warning on boot

The systemd unit points at a different pm2 than the one you manage the deployment with. Rewrite the `ExecStart` and `ExecStop` lines in `/etc/systemd/system/pm2-$USER.service` to the deployment-local binary, then:

```bash
sudo systemctl daemon-reload && sudo systemctl restart pm2-$USER
```

If `selva start` refuses outright, saying the running daemon is _newer_ than the local pm2, a global pm2 owns the daemon. Don't run `pm2 update`; it would downgrade the daemon and drop its process table. Find the conflict first with `which -a pm2`, `pm2 -v`, and `pm2 ping`.

## Reference

- CLI source: [packages/cli/src/](https://github.com/VektorNode/selva/tree/main/packages/cli/src/)
- Deployment templates: [packages/selva/templates/](https://github.com/VektorNode/selva/tree/main/packages/selva/templates/)
- Every env var, documented inline: [packages/selva/.env.example](https://github.com/VektorNode/selva/blob/main/packages/selva/.env.example)
- Host prerequisites: [deployment/prerequisites.md](../deployment/prerequisites.md)
- Reverse proxy: [deployment/reverse-proxy.md](../deployment/reverse-proxy.md)
