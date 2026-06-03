---
'@selvajs/selva': patch
---

Admin updater: npm-only, with an "update available" indicator.

- The admin update runner no longer reports "online" before the new process is actually serving. `/api/health` now returns a per-boot `instanceId`; the post-restart poller waits for it to change, which reliably distinguishes a fresh process (the old git-commit fingerprint was always null under npm, so the poller fell back to a race that latched onto the dying old process — a reload then hit a 503).
- Removed the git/`scripts/update.sh` self-update path from the admin endpoint. Deployments update via npm (`npm update @selvajs/*`) exclusively; the dead `commit` field is gone from `/api/health`.
- The System page now checks the npm registry on load and shows an "update available — vX → vY" badge when a newer `@selvajs/selva` is published. Degrades silently if the registry is unreachable.
