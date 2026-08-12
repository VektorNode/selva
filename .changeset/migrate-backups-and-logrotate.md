---
'@selvajs/cli': patch
---

Timestamped migration backups, plus a pm2 log rotation check

`selva migrate` wrote its backups to fixed paths (`package.json.bak`,
`.env.bak`, …), so a second substantive migration overwrote the first's copies.
Because each run backs up the _current_ file, the operator's original
pre-migration config was then recoverable from nowhere (#184).

- Backups are now stamped per run — `package.json.2026-08-10T05-43-12.bak` —
  so one migration can never clobber another's. A whole run shares one stamp,
  keeping each generation grouped.
- `selva doctor` reports backups older than 30 days and `--fix` deletes them.
  The newest set is always kept regardless of age, so the manual escape hatch
  is never emptied — only superseded generations go.

Separately, `selva doctor` now reports a missing `pm2-logrotate`. pm2 appends
to its logs forever and nothing in a default install truncates them, so the
only bound is free disk — the partition fills and pm2 and the app go down
together. `--fix` installs the module and configures weekly rotation, 8 files
retained, compressed. Detection reads `$PM2_HOME`; it never shells out to pm2,
which would spawn a daemon as a side effect.
