# Host prerequisites and pm2: audit and patch-governance plan

_August 2026. Triggered by an operator question: "I installed the normal Debian
packages on the server. If Selva brings its own packages, that's duplication —
and who patches yours? Distro packages patch themselves."_

## The question, sharpened

Three questions hiding in one:

1. Is it sound that Node and npm come from the host while pm2 comes from the
   deployment?
2. Who notices and ships a pm2 security patch, and how does it reach the
   fleet?
3. Should Selva manage pm2 at all, or only verify the operator's setup?

## Facts established

**The pin was stale and invisible.** The deployment pins pm2 exactly
(`deployment-package.js`) — at 5.4.3, while upstream is at 7.0.3. The pin was
a string literal in JS source, which Dependabot cannot see; nothing would ever
have flagged it. (Fixed: the pin now derives from `@selvajs/cli`'s
`devDependencies`, which Dependabot scans. Still at 5.4.3 — the bump is a
separate decision.)

**pm2 upstream is active.** 7.x line current, releases through 2026. Not
abandonware; a pin can track it.

**pm2 is not in the Debian archive.** Upstream does publish its own vendor
.deb repository (like NodeSource does for Node), but that is Keymetrics'
repo, not Debian's — pm2 has never been covered by Debian's security team
either way. So the "distro packages patch themselves" argument doesn't apply
to pm2: the realistic alternatives to our pin are an unmanaged `npm i -g pm2`
that nobody patches, or a vendor apt repo trusting the same upstream we pin.
The argument fully applies to Node and npm, which is why Selva ships neither.
(Cleanup consequence: a global pm2 may have arrived via either route — the
removal step is `npm uninstall -g pm2` _or_ `apt remove pm2`, check both.)

**Advisory state (verified with `npm audit`, Aug 2026):**

| Tree                                             | Result                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| pm2 5.4.3 (today's deployments)                  | js-yaml quadratic-DoS advisories (high) + pm2 ReDoS GHSA-x5gf-qvw8-r2rm (low) |
| pm2 7.0.3                                        | same js-yaml advisories (7.0.3 pins js-yaml 4.3.0; fix landed in 4.3.1)       |
| pm2 7.0.3 + `overrides: { "js-yaml": "^4.3.1" }` | **0 vulnerabilities**                                                         |
| pm2 5.4.3 + the same override                    | only the pm2 ReDoS low remains                                                |

Two conclusions fall out:

- The js-yaml fix exists upstream (4.3.1); pm2 just hasn't picked it up. Since
  **Selva generates the deployment's `package.json`**, an npm `overrides` block
  ships the patched transitive dep to every new deployment without waiting for
  pm2 — and to existing ones via `selva migrate`, which rewrites
  `package.json` wholesale anyway.
- Exploitability of the js-yaml issue here is near zero regardless: pm2 parses
  YAML only from its own operator-authored local config files. An attacker who
  can write those can already set `script:` to anything. The override is worth
  shipping because "0 findings" is cheaper to defend than "findings, but
  triaged".

**pm2 is load-bearing for self-update.** `updateRunner.server.ts` — the
admin-panel "Run update" feature — is built on pm2: `pm2 stop/start/jlist/
update`, a `setsid` escape from pm2's tree-kill, and two deliberate abort
paths for systemd-supervised pm2 (exits 8 and 9). The whole feature works
because pm2 is a **userland** supervisor the app may drive without root.

## Is the architecture sound?

**Node/npm from the host: yes.** Standard practice for self-hosted Node apps.
Shipping a runtime would mean owning Node CVEs, which is strictly worse than
NodeSource/distro packages. The gaps were verification gaps, now covered by
`doctor` (npm presence/version, second-Node detection, engine check).

**pm2 from the deployment: yes, and it isn't really optional.** The
alternatives:

| Option                             | Verdict                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| systemd-native (`selva.service`)   | Kills self-update or forces a sudoers entry so the web app can run `systemctl restart` — a web-triggered root command is a worse security posture than everything it fixes. Also loses managed Node hosts (no systemd access), which prerequisites.md explicitly supports. Not now; revisit only if self-update is ever redesigned. |
| Unpin pm2 / operator-installed pm2 | Reintroduces the daemon-skew class the exact pin exists to prevent (#118). The skew machinery in `commands/pm2.js` and the boot checks are the fossil record of how expensive that is. No.                                                                                                                                          |
| Containers                         | A different product shape; target operators are "a VM and a shell". Out of scope.                                                                                                                                                                                                                                                   |
| **Keep pm2, own the patch story**  | The gap was never the architecture — it was that nothing watched the pin. Close that.                                                                                                                                                                                                                                               |

## Patch governance (the actual answer to "who patches pm2?")

1. **Pin lives in a manifest** — done. `devDependencies.pm2` in
   `packages/cli/package.json` (and therefore in `pnpm-lock.yaml`);
   `PM2_VERSION` derives from it and refuses ranges. devDependencies are not
   published, so operators never install it twice.
   **Deliberately ignored for Dependabot _version_ PRs** (`dependabot.yml`):
   the auto-merge workflow lands minors/patches unattended, and an unattended
   pm2 bump would silently change what new scaffolds install and flag pin
   drift across the fleet. Bumps are releases (item 3), not chores.
2. **Advisory watch = native Dependabot alerts.** Because the pin is in the
   lockfile, the dependency graph feeds GitHub's Dependabot alerts — they fire
   on pm2's transitive advisories (dev-scoped; the `ignore` above does not
   suppress alerts) with zero custom code. A bespoke weekly audit workflow was
   drafted and deleted during validation: ~100 lines of bash/node plus a
   hand-maintained GHSA allowlist to replicate what the platform does natively.
   Requires Dependabot alerts to be enabled in the repo settings — verify once.
3. **Version bumps are releases, not migrations.** A pm2 pin change requires
   killing the old daemon at the right moment (`pm2 save` → `kill` → install →
   start → `save` again, plus the systemd unit path check). Automating that
   inside `selva migrate` was built and reverted: on the rollback path it
   restarts a _different_ pm2 than the one it killed, which converts a failed
   migration into an outage on a server we can't see. Instead: `migrate`
   reports the pin change and prints the choreography; `doctor` (runtime
   checks, done) verifies the end state. The operator runs five commands once
   per major.
4. **`overrides` in the generated deployment `package.json`** — **decided
   (option A) and implemented.** `{ "js-yaml": "^4.3.1" }` in
   `buildDeploymentPackageJson`; `detectDrift` flags deployments without it
   and `diffPackageJson` shows it in the migrate prompt (it turned out an
   overrides-only change would otherwise read as "already current" and never
   land). Verified end-to-end: the real builder output resolves js-yaml 4.3.1
   and audits down to the single pm2 ReDoS low, which the 7.0.3 bump clears.
   Applying it needs no daemon surgery — a normal `selva migrate` (pm2 version
   unchanged) reinstalls with the override. Temporary shim — delete it once
   pm2 ships js-yaml >= 4.3.1.
5. **Bump target when decided:** 7.0.3 (clears the pm2 ReDoS low; with the
   override the tree audits clean). Not urgent — low severity, and the js-yaml
   highs are near-unexploitable here — so it can ride a normal minor release
   with the documented procedure.

## What to tell the operator

- Node + npm: keep using Debian/NodeSource packages. Selva ships no runtime;
  your patch process is untouched.
- pm2: never covered by Debian's security team (it's not in the archive; the
  vendor .deb repo is Keymetrics' own) — the realistic comparison is against
  an unpatched global npm install. Selva pins it per deployment (daemon-skew
  prevention), watches the pin through GitHub's security advisories, and can
  hot-patch vulnerable transitive deps through the deployment manifest without
  waiting for pm2 upstream. `npm run doctor` verifies the whole stack — Node,
  npm, pm2 install, daemon, boot unit — and prints the fix for anything off.

## Impact assessment: 5.4.3 → 7.0.3

Verified against the published 7.0.3 tarball, not the release notes alone.

**Every parsing contract Selva has with pm2 survives unchanged:**

| Contract                                                                                                                                                           | Where we depend on it                                          | 7.0.3 status                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `out-of-date` / `In memory PM2 version:` / `Local PM2 version:` warning text                                                                                       | `parsePm2Skew` (CLI), skew parsing in the update runner script | Identical strings (`lib/binaries/CLI.js:148-150`)                                                |
| `pm2 jlist` → `pm2_env.status`                                                                                                                                     | Runner's EXIT-trap recovery probe                              | Unchanged                                                                                        |
| `dump.pm2` at `$PM2_HOME`                                                                                                                                          | Boot-persistence checks, resurrect                             | Unchanged (`paths.js`)                                                                           |
| Every `ecosystem.config.cjs` option we set (`kill_timeout`, `listen_timeout`, `min_uptime`, `max_restarts`, `max_memory_restart`, `merge_logs`, `log_date_format`) | Scaffold template                                              | All present in `schema.json`                                                                     |
| systemd unit `ExecStart` path                                                                                                                                      | Boot unit                                                      | Path is `node_modules/pm2/bin/pm2` — doesn't move with the version, so the unit needs no rewrite |
| Node engine                                                                                                                                                        | `>=18`                                                         | We require 24 — fine                                                                             |

**What actually changes:**

- **TreeKill was rewritten** in 7.0 — verified against both sources
  (`lib/TreeKill.js` in the 5.4.3 and 7.0.3 tarballs). What changed is the
  enumeration strategy: 5.4.3 walked the tree by recursively spawning
  `ps --ppid <pid>` per parent; 7.0.3 takes one `ps -e -o pid=,ppid=`
  snapshot and builds the descendant set in JS, killing bottom-up. What did
  NOT change is the kill-set definition: both are pure parent-child (PPID)
  walks rooted at selva-compute's pid. The runner's `setsid` escape reparents
  it to PPID 1 before it ever calls `pm2 stop`, so neither walk can reach it —
  the escape holds by construction, not by implementation detail. The
  SIGINT + `kill_timeout` → SIGKILL escalation is also structurally identical
  (God/Methods.js in both). Remaining staging test is routine confirmation,
  not open risk.
- **Security posture improves**: 7.x fixed the pm2 ReDoS (GHSA-x5gf-qvw8-r2rm),
  replaced `exec()` with `execFile()` in two command-injection spots, and
  internalized ~7 external dependencies — a smaller transitive tree means
  fewer future advisories to triage.
- **The transition itself is the real cost.** CLI and daemon must match, so
  each existing server needs the one-time choreography (`pm2 save` → `pm2
kill` → `npm install` → `npm start` → `pm2 save`), and a 5.4.3-written
  `dump.pm2` is only trusted until the post-start `save` rewrites it. Until an
  operator runs it, `doctor` flags the pin drift — annoying but honest. New
  scaffolds are unaffected.

Net: mechanical, low-risk, one manual step per existing server, one staging
test of self-update. No config, unit, or parsing changes on our side.

### Servers with an old global pm2 (the case that started this audit)

On a server where pm2 was once installed with `npm i -g` (per the old docs),
the daemon and usually the systemd unit belong to that global install. Today
the local 5.4.3 sits close enough to old globals that the skew often stays
quiet. After the bump it won't:

- Local 7.0.3 vs. an old daemon is the _repairable_ skew direction, so
  `selva start` / `doctor --fix` resync via `pm2 update` — but the systemd
  unit still points at the global pm2, so **every reboot resurrects the old
  daemon and the skew returns**. Permanent resync loop, warnings on every
  `selva` command, restart churn.

So the bump makes the global-pm2 cleanup non-optional instead of advisory.
That's a feature: the bump already requires killing the daemon, so the cleanup
rides along in the same maintenance window (~30s downtime):

```bash
cd /path/to/deployment
npx pm2 save && npx pm2 kill        # save process list, stop the old daemon
sudo npm uninstall -g pm2           # remove the frozen global install
sudo apt remove pm2 2>/dev/null || true   # …or it came from pm2's vendor .deb repo
npm install                         # pulls the pinned pm2 (post-bump: 7.0.3)
npm start && npx pm2 save

# Re-create the boot unit. This command does NOT install anything itself —
# it PRINTS a `sudo env PATH=… pm2 startup …` line, which you must paste and
# run (writing /etc/systemd/system/pm2-$USER.service needs root). The printed
# line is generated from the current PATH, so before running it, check it
# references THIS deployment's pm2 (…/node_modules/pm2/bin/pm2) and rewrite
# the path if it doesn't. Same unit filename → it overwrites the old
# global-pm2 unit.
npx pm2 startup systemd -u $USER --hp $HOME

npx pm2 save                        # save again once the unit exists
npm run doctor                      # verifies the unit's ExecStart too
grep ExecStart /etc/systemd/system/pm2-$USER.service   # belt and braces
```

Afterwards the server has exactly one pm2: pinned, Dependabot-watched,
advisory-audited. The frozen global install — the thing the "distro packages
patch themselves" argument was unknowingly defending — is gone entirely.

**Release requirements this implies:**

- The bump release ships a "pm2 7 upgrade" docs section containing exactly
  this sequence.
- `selva migrate` prints this sequence when it detects the pin change
  (refuse-and-instruct per item 3 above — never the automated daemon kill).

## Validation pass (Aug 2026)

A critical re-check of every claim and every proposed mechanism, with a bias
against machinery. Corrections it produced:

- **Doctor's daemon check spawned a daemon.** `pm2 ping` forks one when none
  is running — a read-only doctor must not do that. Fixed: liveness is now
  checked via `pm2.pid` + signal 0, and pm2 is only invoked once a live
  daemon is confirmed (stale pid files included; test asserts pm2 is never
  executed otherwise).
- **The lockfile was out of sync.** The pm2 devDependency landed without
  `pnpm install`; CI runs `--frozen-lockfile` and would have failed. Synced.
- **Auto-merge trap.** Dependabot's grouped minors/patches auto-merge, so a
  routine pm2 bump would have changed the scaffold pin unattended and flagged
  drift fleet-wide. pm2 is now in `dependabot.yml` ignore (alerts unaffected).
- **The custom advisory workflow was redundant.** Deleted in favor of native
  Dependabot alerts (see item 2) — it was the most complex artifact in the
  set and duplicated platform behavior.
- **Debian claim sharpened.** pm2 has a vendor .deb repo (Keymetrics'), so
  "no apt install pm2" was imprecise; the accurate claim is "never covered by
  Debian's security team". Cleanup instructions must try `npm uninstall -g`
  _and_ `apt remove pm2`.

Everything else held: the advisory/audit numbers were re-derived empirically
(`npm audit` against generated trees), the 7.0.3 contract table comes from the
published tarball, and the self-update coupling from reading the runner source.

## Open decisions

- [x] Ship the js-yaml `overrides` shim — **decided (option A), implemented.**
- [x] Bump 5.4.3 → 7.0.3 — **decided, implemented**: pin at 7.0.3, migrate
      prints the finish-the-upgrade notice on a pin change, operator
      procedure documented in the changeset and in
      `docs/self-hosting/deployment/prerequisites.md#upgrading-pm2`.
      **Still owed before release: one staging test of the admin self-update
      flow under pm2 7** (TreeKill was rewritten in 7.0).
- [ ] One-time: confirm Dependabot alerts are enabled in the GitHub repo
      settings (item 2 depends on it).
