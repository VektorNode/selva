---
'@selvajs/cli': minor
---

Add `selva setup-proxy`, and let `doctor --fix` install the pm2 boot unit.

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
