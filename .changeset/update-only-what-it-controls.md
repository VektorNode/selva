---
'@selvajs/selva': patch
'@selvajs/cli': patch
---

An update no longer reports success for an app it never restarted, and no longer acts on another deployment's pm2 app.

The in-app update and `selva update` now cancel, with nothing installed, when something still answers the app's port after `pm2 stop`: a process this deployment's pm2 does not run would have kept serving on replaced files, with every page missing its scripts and styles, while the health check took its answer for the new version.

The pm2 app name is read from the deployment's `ecosystem.config.cjs` instead of being fixed to `selva-compute`, so a second deployment under the same OS user can have its own. `selva start`, `stop`, `restart`, `update`, `migrate` and the in-app update refuse to run when pm2's app of that name belongs to another directory, and `selva doctor` reports it. See "Running two Selva deployments on one server" in the CLI guide.
