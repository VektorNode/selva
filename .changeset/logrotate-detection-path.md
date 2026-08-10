---
'@selvajs/cli': patch
---

Fix the pm2-logrotate check reporting "not installed" after a successful install

The check probed `$PM2_HOME/node_modules/pm2-logrotate`, but `pm2 install`
writes to `$PM2_HOME/modules/pm2-logrotate`. So `selva doctor --fix` installed
the module, reported success, and the very next `selva doctor` warned it was
missing again — offering the same repair on every run.

The install itself always worked (settings included), so a deployment that ran
the repair on 4.8.0-beta.13 already has weekly rotation; only the verification
was wrong. Its test used the same incorrect path as the check, so the two
agreed with each other rather than with pm2 — the layout is now pinned against
what a real `pm2 install` produces, plus an assertion that a satisfied check
stops offering its repair.
