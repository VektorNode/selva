---
'@selvajs/selva': patch
---

Fix: the admin update runner no longer reports "online" before the new process is actually serving.

The post-restart poller keyed on a git commit hash from `/api/health` to detect the new process. In npm-mode deployments there's no git repo, so the hash was `null` on both old and new processes — the check fell back to "two successful health checks = online", which the still-running old process satisfied moments before PM2 killed it. Result: the UI declared success (without a version transition), but a reload hit a 503 until the new process finished booting. `/api/health` now returns a per-boot `instanceId` (and the installed `version`); the poller waits for the `instanceId` to change, which works in every deployment shape and correctly distinguishes a fresh process — including same-version rollbacks/reinstalls.
