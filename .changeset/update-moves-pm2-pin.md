---
'@selvajs/cli': patch
'@selvajs/selva': patch
---

The in-app update and `selva update` move pm2 to the version the new release pins and swap the daemon, so a pm2 bump needs no `selva migrate`. Under systemd the in-app update can't swap the daemon: it finishes with a warning to run `npx pm2 update` from a shell. `selva doctor` now fails when `selva-compute` is missing from pm2 or not online, which an interrupted `pm2 update` leaves behind while every other check passes.
