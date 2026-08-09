---
'@selvajs/cli': minor
---

`selva doctor` now validates the host tooling, not just the deployment.

New checks cover the split operators keep tripping over — Node and npm come from the host, pm2 comes from the deployment:

- **npm** missing from `PATH` (Debian's `nodejs` package doesn't always include it) or a distro-split version several majors behind Node.
- **Two Node installations in play** — the shell resolves one, doctor runs under another, and pm2 may have launched the app with a third. `engines.node` passes against a version production never executes. The check names the version manager (nvm, fnm, volta, distro, snap) rather than just printing a path.
- **pm2 not installed locally**, installed at a version other than the exact pin, or declared in `package.json` as a range that will drift on the next `npm install`.
- **pm2 daemon skew** — reported as three distinct states: no daemon running (fine), a matching daemon, or a foreign daemon. The daemon-is-newer case is red and deliberately never suggests `pm2 update`, which would downgrade the daemon and drop its process table.

Each failure prints the command that resolves it.

The scaffolded deployment `package.json` now carries an npm `overrides` block forcing js-yaml `^4.3.1` — pm2 pins 4.3.0, which carries known quadratic-complexity DoS advisories whose fix pm2 hasn't adopted yet. New deployments get it at scaffold time; existing ones are flagged as drift by `doctor` and pick it up via `selva migrate`. Temporary shim: remove once pm2's own js-yaml dependency reaches >= 4.3.1.
