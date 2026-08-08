---
title: Prerequisites
order: 1
published: false
description: 'What any Node host needs before scaffolding Selva. Provider-agnostic.'
---

# Prerequisites

Applies to any host that can run a long-lived Node process: a Linux VM on any cloud, a managed Node host (Hostinger, etc.), bare metal. Nothing here is cloud-provider-specific. Scaffolding and running Selva itself is the [CLI guide](../get-started/cli.md); this page only covers getting the host ready for it.

## What you need

- **Node.js 24+** with `npm` on `PATH`.
- **Shell access** (SSH or your host's terminal) to run `npx` commands.
- **Selva must not be reachable from the public internet directly.** It should bind `127.0.0.1` only and sit behind a reverse proxy. Don't open the app's port (default 3000) in any firewall. See [Reverse proxy](./reverse-proxy.md) once you're ready to expose it.

## Installing Node 24

Debian/Ubuntu example:

```bash
sudo apt-get update
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v24.x
```

Other hosts: use whatever Node-version mechanism they provide (nvm, a platform Node selector, a pre-installed runtime). The only requirement is Node 24+.

## Next

Once `node -v` and `npm -v` both work, scaffold and run the deployment with the [CLI guide](../get-started/cli.md). After that's running:

1. **[Reverse proxy](./reverse-proxy.md)**: required before exposing Selva publicly.
2. Optional SSO: **[Header-auth & Entra](../providers/header-auth-entra.md)**.
