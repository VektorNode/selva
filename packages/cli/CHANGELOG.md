# @selvajs/cli

## 4.9.0

### Minor Changes

- 15dcbb0: Add `selva setup-proxy`, and let `doctor --fix` install the pm2 boot unit.

  A scaffolded deployment could start under pm2 but not serve anyone: the app binds `127.0.0.1` only, so a reverse proxy is mandatory, and without TLS the browser drops the session cookie — a login that appears to succeed and is anonymous on the next request. The CLI's entire contribution to that step was a parenthetical, `(set up your reverse proxy first)`. The Terraform path already automated it as root, so the two deployment routes diverged at exactly the point where the manual one was hardest.

  - **`selva setup-proxy`** installs Caddy if missing, writes `/etc/caddy/Caddyfile` for a domain, validates the config before reloading, and backs up any existing file. The Caddyfile is generated from `src/caddyfile.js`, which now also backs `infra/startup.sh.tpl` so the Terraform and CLI edges can't drift.
  - **`doctor --fix` installs the pm2 systemd boot unit**, and repoints one aimed at a foreign pm2. Both were detected before but left as text to copy — the failure they prevent (the app not returning after a reboot) is invisible until it happens.
  - **Privileged steps go through one escalation path** (`src/checks/privileged.js`): it runs directly as root, via sudo when a terminal or a passwordless rule is available, and otherwise prints the exact command rather than half-applying anything. Nothing escalates without a confirmation first.
  - **The scaffold's closing output** now lists the steps that actually remain for the deployment it just wrote — including the Supabase schema push when a Supabase provider is selected — in dependency order.

  Dropped alongside it, all of it reachable only by deployments that predate the 2.0.2 layout (May 2026) or by nothing at all:

  - `migrate` no longer deletes `selva.config.js`. It matched on filename alone, and `SELVA_CONFIG_PATH` is still a supported way to point at a custom provider config — so the "no longer needed" it printed could be wrong about a file the operator is currently using.
  - `migrate` no longer rewrites `@selvajs/runtime` in `ecosystem.config.cjs`. A deployment in that state also lists `@selvajs/runtime` in `package.json`, which is unpublished and fails `npm install` before migrate can run.
  - `LEGACY_DEPENDENCIES` keeps only the two packages still on the registry. The unpublished three could never be reported: npm fails the install first, and its own error names the package.
  - `mergeEnv` and `writeEnvFile`'s `annotated` option are gone — no caller ever passed it, so the annotated-`.env` writer had been unreachable since 4.8.0 made deployments values-only.
  - `.selva-version` is no longer written. It was documented as telling `selva migrate` which layout it was looking at; migrate detects layout by probing actual state and never read the file.
  - The `@selvajs/selva@0.10.2` install-failure special case is now generic stale-cache advice. The version it named is three major lines back and unpublished.

  `RENAMED_ENV_VARS` and `REPLACED_ENV_VARS` stay: the server still reads both sets of old names, and for `REPLACED_ENV_VARS` this is the only place the deprecation is reported.

## 4.8.2

### Patch Changes

- 26bfa90: Scaffold Supabase deployments with `@selvajs/supabase-provider`, so the migration SQL reaches the deployment directory.

  The provider's code is bundled into `@selvajs/selva`, and the CLI treated the package itself as legacy on that basis. Its SQL is not bundled: `@selvajs/selva` publishes only `build` and `templates`, while `supabase/migrations/` and the `selva-supabase` bin ship in the provider's own tarball. A Supabase deployment therefore had no migrations on disk — `npx selva-supabase sync-migrations` failed with a registry 404, and there was no supported way to apply the schema from the deployment host at all.

  - `create` adds the dependency when any provider slot is `supabase`, and resolves its pin like the other `@selvajs/*` packages.
  - `migrate` adds it to existing Supabase deployments (reading the provider slots from `.env`) and drops it again when a deployment moves off Supabase.
  - `doctor` now reports a missing provider package as an error naming the fix, instead of skipping the migration-head check with a yellow note.

## 4.8.1

## 4.8.0

### Minor Changes

- 4512068: `selva doctor` now validates the host tooling, not just the deployment.

  New checks cover the split operators keep tripping over — Node and npm come from the host, pm2 comes from the deployment:

  - **npm** missing from `PATH` (Debian's `nodejs` package doesn't always include it) or a distro-split version several majors behind Node.
  - **Two Node installations in play** — the shell resolves one, doctor runs under another, and pm2 may have launched the app with a third. `engines.node` passes against a version production never executes. The check names the version manager (nvm, fnm, volta, distro, snap) rather than just printing a path.
  - **pm2 not installed locally**, installed at a version other than the exact pin, or declared in `package.json` as a range that will drift on the next `npm install`.
  - **pm2 daemon skew** — reported as three distinct states: no daemon running (fine), a matching daemon, or a foreign daemon. The daemon-is-newer case is red and deliberately never suggests `pm2 update`, which would downgrade the daemon and drop its process table.

  Each failure prints the command that resolves it.

  The scaffolded deployment `package.json` now carries an npm `overrides` block forcing js-yaml `^4.3.1` — pm2 pins 4.3.0, which carries known quadratic-complexity DoS advisories whose fix pm2 hasn't adopted yet. New deployments get it at scaffold time; existing ones are flagged as drift by `doctor` and pick it up via `selva migrate`. Temporary shim: remove once pm2's own js-yaml dependency reaches >= 4.3.1.

- 4512068: Scaffold a values-only `.env`, and let `selva doctor --fix` strip an existing one.

  The annotated `.env` is useful while you decide what to set and useless once it
  is on a server: `migrate` rewrites keys but never prose, so a deployment keeps
  documenting the release it was installed at — describing variables the code has
  since renamed or retired. A 4.6-era file is ~470 lines of instructions, most of
  them now wrong, wrapped around ~14 real settings.

  `create` and `init` now write values only, under a header pointing at the
  runtime template (`node_modules/@selvajs/selva/templates/.env.example`), which
  is refreshed on every update and stays authoritative. The template itself is
  unchanged and still ships annotated.

  `selva doctor` reports a `.env` still carrying the shipped documentation and
  offers to strip it under `--fix`. Comments an operator wrote directly above a
  setting are kept; the repair refuses if any setting would change value, and
  writes `.env.bak` first.

- 4512068: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

- 4512068: pm2 upgraded from 5.4.3 to 7.0.3.

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

### Patch Changes

- 4512068: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- 4512068: `selva migrate` now shows every field it discards, and keeps `engines`.

  The rewrite replaces a deployment's `package.json` wholesale, which is deliberate — the directory is generated output. But the confirmation prompt only diffed `dependencies` and `scripts`, so `devDependencies`, `description`, and any other top-level field the operator had added disappeared without ever being shown. The diff now lists them, so a confirmed migration has no unadvertised losses. `selva doctor` was quiet about them too: `detectDrift` reported "layout is current" on a deployment `migrate` would strip.

  `engines` is now carried over rather than dropped. npm only enforces it under `engine-strict`, so an operator who pinned a Node floor did it deliberately — and removing it takes away a guard whose absence surfaces only under real traffic (the failure mode behind issue #176).

- 4512068: Fix `selva migrate` leaving a deployment down when `npm install` fails, and `selva keys rotate` crashing on a deployment with no `.env`.

  - **A failed migration can now recover.** `migrate` needs a clean install (a legacy lockfile pins the old package set across a major bump), so it deleted `node_modules` before running `npm install`. But `node_modules` is also where the deployment's pm2 lives, and the rollback has to restart the app — so when an install failed, the restart resolved no pm2, `spawnSync` set `error`, and the helper returned a bare `1` with nothing printed. The operator was left with a stopped app, no dependency tree, and no indication why. The old tree is now renamed aside rather than deleted (atomic, keeps the `.bin` symlinks intact) and restored along with `package-lock.json` if the install fails, so pm2 resolves again and the app comes back. A restart that still fails is now reported instead of swallowed.
  - **`migrate` no longer falls back to a global pm2.** It carried a private pm2 resolver that silently used whatever `pm2` was on `PATH` when the local one was missing — the version-skew source `pm2.js` exists to prevent, and which it refuses with an explicit error. Both now use the same strict resolver; the two call sites where a missing pm2 is legitimate (a legacy deployment has nothing to stop) handle it explicitly.
  - **`selva doctor` reports an interrupted migration.** A killed `migrate` leaves the stashed dependency tree behind; doctor now flags it and `--fix` removes it.
  - **`selva keys rotate` no longer crashes without an `.env`.** It read the file unconditionally when the runtime templates were absent, throwing a raw `ENOENT` on a deployment that has `ecosystem.config.cjs` but no `.env` — a state the CLI otherwise treats as valid and `selva init` already handled.
  - **`create` and `migrate` can no longer disagree about the deployment `package.json`.** They built it separately and had already drifted: `create` pinned pm2 exactly to avoid daemon skew while `migrate` rewrote it to a caret range. Both now use one builder. `.selva-version` also records the real CLI version instead of a hardcoded `0.1.0` that had been stale since the marker was introduced.

- 4512068: Fix the pm2-logrotate check reporting "not installed" after a successful install

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

- 4512068: Timestamped migration backups, plus a pm2 log rotation check

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

- 4512068: Stop `selva migrate` from downgrading deployments on a prerelease pin

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

## 4.8.0-beta.14

### Patch Changes

- 5231010: Fix the pm2-logrotate check reporting "not installed" after a successful install

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

## 4.8.0-beta.13

### Patch Changes

- 3c8ddf8: Timestamped migration backups, plus a pm2 log rotation check

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

## 4.8.0-beta.12

### Minor Changes

- 12fa352: Scaffold a values-only `.env`, and let `selva doctor --fix` strip an existing one.

  The annotated `.env` is useful while you decide what to set and useless once it
  is on a server: `migrate` rewrites keys but never prose, so a deployment keeps
  documenting the release it was installed at — describing variables the code has
  since renamed or retired. A 4.6-era file is ~470 lines of instructions, most of
  them now wrong, wrapped around ~14 real settings.

  `create` and `init` now write values only, under a header pointing at the
  runtime template (`node_modules/@selvajs/selva/templates/.env.example`), which
  is refreshed on every update and stays authoritative. The template itself is
  unchanged and still ships annotated.

  `selva doctor` reports a `.env` still carrying the shipped documentation and
  offers to strip it under `--fix`. Comments an operator wrote directly above a
  setting are kept; the repair refuses if any setting would change value, and
  writes `.env.bak` first.

### Patch Changes

- 12fa352: Stop `selva migrate` from downgrading deployments on a prerelease pin

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

## 4.8.0-beta.11

### Minor Changes

- 9891a04: `selva doctor` now validates the host tooling, not just the deployment.

  New checks cover the split operators keep tripping over — Node and npm come from the host, pm2 comes from the deployment:

  - **npm** missing from `PATH` (Debian's `nodejs` package doesn't always include it) or a distro-split version several majors behind Node.
  - **Two Node installations in play** — the shell resolves one, doctor runs under another, and pm2 may have launched the app with a third. `engines.node` passes against a version production never executes. The check names the version manager (nvm, fnm, volta, distro, snap) rather than just printing a path.
  - **pm2 not installed locally**, installed at a version other than the exact pin, or declared in `package.json` as a range that will drift on the next `npm install`.
  - **pm2 daemon skew** — reported as three distinct states: no daemon running (fine), a matching daemon, or a foreign daemon. The daemon-is-newer case is red and deliberately never suggests `pm2 update`, which would downgrade the daemon and drop its process table.

  Each failure prints the command that resolves it.

  The scaffolded deployment `package.json` now carries an npm `overrides` block forcing js-yaml `^4.3.1` — pm2 pins 4.3.0, which carries known quadratic-complexity DoS advisories whose fix pm2 hasn't adopted yet. New deployments get it at scaffold time; existing ones are flagged as drift by `doctor` and pick it up via `selva migrate`. Temporary shim: remove once pm2's own js-yaml dependency reaches >= 4.3.1.

- 9891a04: pm2 upgraded from 5.4.3 to 7.0.3.

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

## 4.8.0-beta.10

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

## 4.8.0-beta.9

### Patch Changes

- 544906b: `selva migrate` now shows every field it discards, and keeps `engines`.

  The rewrite replaces a deployment's `package.json` wholesale, which is deliberate — the directory is generated output. But the confirmation prompt only diffed `dependencies` and `scripts`, so `devDependencies`, `description`, and any other top-level field the operator had added disappeared without ever being shown. The diff now lists them, so a confirmed migration has no unadvertised losses. `selva doctor` was quiet about them too: `detectDrift` reported "layout is current" on a deployment `migrate` would strip.

  `engines` is now carried over rather than dropped. npm only enforces it under `engine-strict`, so an operator who pinned a Node floor did it deliberately — and removing it takes away a guard whose absence surfaces only under real traffic (the failure mode behind issue #176).

- 43bb98d: Fix `selva migrate` leaving a deployment down when `npm install` fails, and `selva keys rotate` crashing on a deployment with no `.env`.

  - **A failed migration can now recover.** `migrate` needs a clean install (a legacy lockfile pins the old package set across a major bump), so it deleted `node_modules` before running `npm install`. But `node_modules` is also where the deployment's pm2 lives, and the rollback has to restart the app — so when an install failed, the restart resolved no pm2, `spawnSync` set `error`, and the helper returned a bare `1` with nothing printed. The operator was left with a stopped app, no dependency tree, and no indication why. The old tree is now renamed aside rather than deleted (atomic, keeps the `.bin` symlinks intact) and restored along with `package-lock.json` if the install fails, so pm2 resolves again and the app comes back. A restart that still fails is now reported instead of swallowed.
  - **`migrate` no longer falls back to a global pm2.** It carried a private pm2 resolver that silently used whatever `pm2` was on `PATH` when the local one was missing — the version-skew source `pm2.js` exists to prevent, and which it refuses with an explicit error. Both now use the same strict resolver; the two call sites where a missing pm2 is legitimate (a legacy deployment has nothing to stop) handle it explicitly.
  - **`selva doctor` reports an interrupted migration.** A killed `migrate` leaves the stashed dependency tree behind; doctor now flags it and `--fix` removes it.
  - **`selva keys rotate` no longer crashes without an `.env`.** It read the file unconditionally when the runtime templates were absent, throwing a raw `ENOENT` on a deployment that has `ecosystem.config.cjs` but no `.env` — a state the CLI otherwise treats as valid and `selva init` already handled.
  - **`create` and `migrate` can no longer disagree about the deployment `package.json`.** They built it separately and had already drifted: `create` pinned pm2 exactly to avoid daemon skew while `migrate` rewrote it to a caret range. Both now use one builder. `.selva-version` also records the real CLI version instead of a hardcoded `0.1.0` that had been stale since the marker was introduced.

## 4.8.0-beta.8

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.

## 4.8.0-beta.7

## 4.8.0-beta.6

## 4.8.0-beta.5

## 4.8.0-beta.4

## 4.8.0-beta.3

## 4.8.0-beta.2

## 4.7.4-beta.1

## 4.7.4-beta.0

## 4.7.3

## 4.7.2

## 4.7.1

## 4.7.0

## 4.7.0-beta.6

## 4.7.0-beta.5

## 4.7.0-beta.4

## 4.7.0-beta.3

## 4.7.0-beta.2

## 4.6.21-beta.1

## 4.6.21-beta.0

## 4.6.20

## 4.6.19

## 4.6.18

## 4.6.17

## 4.6.16

## 4.6.15

## 4.6.14

## 4.6.13

## 4.6.12

## 4.6.11

## 4.6.10

## 4.6.9

## 4.6.8

## 4.6.7

## 4.6.6

## 4.6.5

## 4.6.4

## 4.6.3

## 4.6.2

## 4.6.1

## 4.6.0

## 4.6.0-beta.2

## 4.6.0-beta.1

## 4.6.0-beta.0

## 4.5.1

## 4.5.0

## 4.4.0

## 4.3.5

## 4.3.4

## 4.3.3

## 4.3.2

## 4.3.1

## 4.3.0

## 4.2.1

## 4.1.0

### Minor Changes

- Bump `@selvajs/cli` onto the `4.x` line, aligned with the `@selvajs/selva`
  runtime.

  The CLI and runtime release as a `linked` group but had drifted (CLI at `3.x`,
  runtime at `4.x`) because the CLI carried no changeset during the runtime's
  `4.0` cycle. Operators reasonably expect `selva` (the CLI) and the app it
  manages to share a major, and `selva update` refreshes both packages together.
  This lands the CLI at `4.1.0` — `4.0.0` is already published and can't be
  reissued, so the minor is the lowest `4.x` we can ship.

  No breaking CLI behavior; the bump is purely to re-sync the major line.
  Functionality (`init`, `doctor`, `start/stop/restart/logs`, `update`,
  `migrate`, `keys rotate`) is unchanged.

## 3.0.0

## 2.0.11

## 2.0.10

### Patch Changes

- 74252bd: Warn during `selva` / `create` scaffolding when the user enters an `http://` ORIGIN. Plain HTTP origins are a silent footgun: session cookies are minted with `Secure` under `NODE_ENV=production`, so browsers drop them and login appears to succeed but every subsequent request is anonymous. The prompt now prints a yellow note pointing operators at the two fixes (put TLS in front, or set `ALLOW_INSECURE_COOKIES=true` for testing).

## 2.0.9

### Patch Changes

- **Gate Platform projects behind `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS`.** The admin → Projects surface — instance-admin-owned projects granted to orgs or individual users — is now opt-in like the other platform flags, off by default. When off, the nav entry is hidden, the routes 404, the admin API rejects, platform-visibility projects are filtered out of every list, and the access rules treat them as inaccessible (instance_admin included). Existing rows are preserved; flipping the flag back on restores access.
  - `selva create` lists the new flag in the platform-flags multiselect, alongside `ALLOW_ORG_CREATION`, `ENABLE_SHARING`, etc.
  - `.env.example` documents the flag in the `PLATFORM FEATURE FLAGS` block.
  - Rule layer: `ProjectAccessInput` and `DefinitionAccessInput` carry a new `enablePlatformProjects` boolean. Off short-circuits every `canView` / `canSolve` / `canEdit` / `canManage` / `canEditProjectSettings` / `canEditDefinition` call against a platform-visibility project to `false` — single source of truth, so route and listing code can't drift.

  Existing deployments that want the feature: set `SELVA_FLAG_ENABLE_PLATFORM_PROJECTS=true` in `.env` and restart.

## 2.0.8

## 2.0.7

## 2.0.6

## 2.0.5

### Patch Changes

- Fix admin Update hangs caused by PM2 daemon/CLI version skew, and recover lost log output during the post-restart blackout.

  **PM2 daemon/CLI sync.** The CLI scaffold previously installed `pm2: '^5.4.0'` (caret) and `pm2Bin()` fell back to a global pm2 if the local one was missing. Both choices made it possible for two pm2 binaries to manage the same daemon, producing `In-memory PM2 is out-of-date` warnings and stops/restarts that hung mid-flight. The fix:
  - Pin `pm2` to an exact version in scaffolded deployments (`5.4.3`).
  - `pm2Bin()` is now local-only — errors loudly if `node_modules/.bin/pm2` is missing instead of silently using a possibly-different global pm2.
  - New `ensurePm2InSync()` helper runs before every state-changing pm2 call (`selva start`/`stop`/`restart`/`update`); detects daemon/CLI skew and runs `pm2 update` to respawn the daemon under the local CLI before continuing.
  - Same skew detection added to the bash side of the admin update endpoint and `scripts/update.sh`, so the check runs even when the JS wrapper isn't on the call path.

  **Update log visibility.** The admin Update endpoint streams script output via SSE, but the SSE is served by `selva-compute` itself — so the moment `pm2 stop selva-compute` succeeds, the stream dies and the frontend goes blind. Anything that happened afterwards (npm update output, pm2 start result, health probe, rollback) was invisible, leaving operators with an infinite spinner and no diagnostics. The fix:
  - Bash wrapper tees all script stdout/stderr to `/tmp/selva-update.log`. The detached process keeps writing to the file even after SSE dies.
  - `GET /admin/api/system/update` returns the log file contents (admin-only).
  - During the post-restart wait, the frontend polls the log endpoint alongside `/api/health` and replaces the displayed logs with the full file content as soon as the new process is reachable — surfacing the entire blackout chunk in one shot.

  Operators on existing hosts that have a global pm2 installed alongside the project-local one should run `npm uninstall -g pm2` after upgrading, then `./node_modules/.bin/pm2 update` once to align the daemon. New scaffolds are unaffected.

## 2.0.4

## 2.0.3

### Patch Changes

- Fix `npx @selvajs/cli` and `selva` commands failing with `sh: 1: cli: not found`. The published 2.0.2 package declared `bin` entries pointing to `./bin/cli.js` and `./bin/selva.js`, but those shim files were never committed and the published tarball had no executables. Adds the missing shims and a parse-only test that prevents the regression.

## 2.0.2

### Patch Changes

- f49433c: **Env-driven provider wiring.** New deployments no longer ship a `selva.config.js` — provider selection moved into the runtime, driven by `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER` in `.env`. Provider implementations remain bundled into `@selvajs/selva`; the only operator-facing files are `.env` and `ecosystem.config.cjs`.
  - `selva create` writes `.env` + `ecosystem.config.cjs` + `package.json`. The deployment `package.json` now lists only `@selvajs/cli`, `@selvajs/selva`, and `pm2`.
  - `selva migrate` detects existing deployments and (a) drops the now-bundled provider packages from `package.json`, (b) backs up and deletes any stale `selva.config.js`, and (c) rewrites `ecosystem.config.cjs` if it still points at `@selvajs/runtime`.
  - `selva doctor` checks for layout drift across all three of the above.
  - The escape hatch for custom providers is still `SELVA_CONFIG_PATH`: set it to a `.js` file exporting a `defineConfig()` result.

  Existing deployments: run `selva migrate` after updating. The CLI prints the full set of changes before applying them and saves `.bak` files for every file it touches.

## 2.0.1

### Patch Changes

- 1e63ec5: Rename the bootstrap bin from `create` to `cli` so `npx @selvajs/cli <dir>` resolves without needing `-p`. Previously the package shipped two bins (`create` + `selva`) and neither matched the unscoped package name, so npx failed with "could not determine executable to run" unless invoked as `npx -p @selvajs/cli create`. The `selva` operator bin is unchanged.

## 2.0.0

### Patch Changes

- 9cd112b: **v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.
  - **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
  - **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
  - **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
  - **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

  See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.

> Renamed from `@selvajs/create` after 0.1.3. Earlier entries below were
> published under the old name.

## 0.1.3

### Patch Changes

- - `@selvajs/header-auth-provider`: new `BootstrapAllowlistPolicy` API and behavior change in `identifyFromHeaders`.
  - `@selvajs/selva`: new auto-bootstrap behavior and new page UI cases.
  - `@selvajs/cli`: CLI prompts and doctor improvements (no API surface change).
