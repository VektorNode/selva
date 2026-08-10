---
'@selvajs/cli': patch
---

Stop `selva migrate` from downgrading deployments on a prerelease pin

`migrate` rewrote `package.json` onto the canonical scaffold, which pinned both
`@selvajs/*` packages to the `latest` dist-tag. npm's `latest` is the newest
_stable_ release, so a deployment on `^4.8.0-beta.11` migrated to 4.7.3 — a
downgrade the confirmation diff showed as `^4.8.0-beta.11 → latest`, which
reads as an upgrade. `selva doctor` then reported `✓ CLI aligned with runtime`,
because both had moved together and it only compares those two against each
other.

- A prerelease pin is now preserved across a migration, and the reason is
  reported before the operator confirms.
- Dist-tags resolve to concrete versions at migrate and create time, so
  `"latest"` never reaches disk. A stored tag re-resolved on every later
  `npm install`, letting a deployment follow the tag with no migrate at all.
- When the registry is unreachable, the existing pin is kept and reported
  rather than replaced.
- `selva doctor` reports a floating pin as drift, so deployments migrated
  before this fix are told.

Also fixes the post-migration pm2 guidance, which said to run `pm2 update`
followed by `pm2 save`. `pm2 update` empties the process table before restoring
it; when the restore fails, that `pm2 save` overwrites `~/.pm2/dump.pm2` — the
only record of what to bring back. The notice now puts a `pm2 list`
verification between the two and points at `pm2 resurrect` for recovery.
