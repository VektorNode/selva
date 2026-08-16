---
title: Prerequisites
order: 1
published: true
description: 'What any Node host needs before scaffolding Selva. Provider-agnostic.'
---

# Prerequisites

Getting a host ready to run Selva. Applies to any host that can run a long-lived Node process — a Linux VM on any cloud, a managed Node host, bare metal. Scaffolding and running Selva itself is the [CLI guide](../get-started/cli.md).

## What you need

- **Node.js 24+** with `npm` on `PATH`. Selva ships no Node runtime of its own. Debian's `nodejs` package doesn't always pull in `npm` — install both.
- **No global pm2.** Selva brings its own pinned copy per deployment, and a global one fights it over a shared daemon. Other pm2-managed apps on the same box are fine if they use a different OS user or `PM2_HOME` — see [About pm2](../get-started/cli.md#about-pm2) and [Running other Node apps on the same server](../get-started/cli.md#running-other-node-apps-on-the-same-server).
- **Shell access** to run `npx` commands.
- **Selva must not be reachable from the public internet directly.** Bind `127.0.0.1` only and sit behind a reverse proxy. Don't open the app's port (default 3000) in any firewall. See [Reverse proxy](./reverse-proxy.md).

## Installing Node 24

Debian/Ubuntu:

```bash
sudo apt-get update
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v24.x
```

Other hosts: use whatever Node-version mechanism they provide (nvm, a platform Node selector, a pre-installed runtime).

With nvm or fnm, note that a systemd unit starts before the user's shell profile runs, so the managed Node may not be on its `PATH`. `selva doctor` flags it when the Node running the CLI isn't the one the shell resolves.

## Upgrading pm2

pm2 is pinned per deployment, so version changes arrive through Selva releases, never through apt or a global npm install. When a release changes the pin (`npm run doctor` reports "pm2 X is installed but this scaffold pins Y"), the pm2 CLI on disk and the still-running daemon are different versions — finish the upgrade by hand. Which path applies depends on one question `doctor` answers: **is there a pm2 outside the deployment?**

### No global pm2

```bash
cd /path/to/deployment
selva migrate       # rewrites package.json onto the new pin, reinstalls, restarts
npx pm2 update      # replaces the still-running old daemon (brief restart)
npx pm2 save
npm run doctor
```

### With a global or apt-installed pm2

An old `npm install -g pm2` or pm2's vendor .deb gets no automatic updates — remove it in the same maintenance window, or every reboot resurrects the old daemon and the skew warning returns:

```bash
cd /path/to/deployment
npx pm2 save && npx pm2 kill              # save the process list, stop the old daemon
sudo npm uninstall -g pm2                 # remove the global install…
sudo apt remove pm2 2>/dev/null || true   # …or the vendor .deb
selva migrate                             # new pin + reinstall + restart (fresh daemon)
npx pm2 save
npx pm2 startup systemd -u $USER --hp $HOME
npx pm2 save
npm run doctor
```

`startup` installs nothing itself — it **prints** a `sudo env PATH=…` line for you to paste. Before running it, check the printed line references this deployment's pm2 (`…/node_modules/pm2/bin/pm2`) and rewrite the path if it doesn't; the line is generated from your current `PATH`, which is where the wrong pm2 sneaks in. `doctor` verifies the resulting unit.

## Next

Once `node -v` and `npm -v` both work, scaffold and run the deployment with the [CLI guide](../get-started/cli.md). After that:

1. **[Reverse proxy](./reverse-proxy.md)** — required before exposing Selva publicly.
2. Optional SSO: **[Header-auth & Entra](../providers/header-auth-entra.md)**.
