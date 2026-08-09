---
'@selvajs/cli': minor
---

pm2 upgraded from 5.4.3 to 7.0.3.

Why: pm2 7 fixes a ReDoS in pm2 itself (GHSA-x5gf-qvw8-r2rm) plus two command-injection issues, and internalizes ~7 external dependencies (smaller advisory surface). Combined with the js-yaml override, a scaffolded deployment now audits with **zero known vulnerabilities**. Every contract Selva relies on was verified unchanged against the 7.0.3 tarball: skew-warning text, `jlist` output shape, `dump.pm2` path, all `ecosystem.config.cjs` options, and the systemd `ExecStart` path.

New deployments get 7.0.3 automatically. **Existing deployments need a one-time step**, because the pm2 CLI and its background daemon must be the same version:

```bash
cd /path/to/deployment
npm run doctor      # see what applies to your server
selva migrate       # rewrites package.json (pm2 7 + js-yaml override), reinstalls, restarts
npx pm2 update      # replace the still-running old daemon with the new version
npx pm2 save
npm run doctor      # everything should be green
```

If `doctor` reports a pm2 **outside** the deployment (an old `npm install -g pm2` or a vendor .deb), follow the full procedure in the docs instead (self-hosting → deployment → prerequisites, "Upgrading pm2"): it removes the foreign install and re-points the systemd boot unit at the deployment-local pm2. Skipping that leaves a reboot loop where the old daemon resurrects and the version-skew warning returns.

Downtime is a brief restart of managed processes during `pm2 update`.
