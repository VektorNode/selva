---
title: Prerequisites
order: 1
published: true
description: 'What any Node host needs before scaffolding Selva. Provider-agnostic.'
---

# Prerequisites

Any host that runs a long-lived Node process works. Scaffolding is the [CLI guide](../get-started/cli.md).

- **Node.js 24+** with `npm` on `PATH`.
- **No global pm2.** Each deployment pins its own; a global one fights it over a shared daemon. See [About pm2](../get-started/cli.md#about-pm2) and [Running other Node apps on the same server](../get-started/cli.md#running-other-node-apps-on-the-same-server).
- **No direct public access.** Put it behind a [reverse proxy](./reverse-proxy.md) and keep port 3000 closed.

## Installing Node 24

Debian/Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v24.x
```

With nvm or fnm, a systemd unit starts before your shell profile, so it may not find the managed Node. `selva doctor` flags this.

## Upgrading pm2

pm2 changes only through Selva releases. When the pin changes, `npm run doctor` reports "pm2 X is installed but this scaffold pins Y": the CLI and the running daemon differ.

### No global pm2

```bash
cd /path/to/deployment
selva migrate       # new pin, reinstall, restart
npx pm2 update      # replace the old daemon
npx pm2 list        # the app must be online before you save
npx pm2 save
npm run doctor
```

`pm2 update` empties the process table before restoring it. Saving after a failed restore overwrites `~/.pm2/dump.pm2`, the only record of what to bring back. If the list is empty, run `npx pm2 resurrect` or `npx pm2 start ecosystem.config.cjs`.

### With a global or apt-installed pm2

Remove it, or every reboot resurrects the old daemon:

```bash
cd /path/to/deployment
npx pm2 save && npx pm2 kill              # save the process list, stop the old daemon
sudo npm uninstall -g pm2                 # remove the global install…
sudo apt remove pm2 2>/dev/null || true   # …or the vendor .deb
selva migrate
npx pm2 list                              # the app must be online before you save
npx pm2 save
npx pm2 startup systemd -u $USER --hp $HOME
npx pm2 save
npm run doctor
```

`startup` only **prints** a `sudo env PATH=…` line to paste. Check it points at this deployment's `node_modules/pm2/bin/pm2`; it is built from your `PATH`, where the wrong pm2 sneaks in.

## Next

[Reverse proxy](./reverse-proxy.md), then optionally [Header-auth & Entra](../providers/header-auth-entra.md).
