# A staged deployment on your machine

`pnpm dev:*` runs the dev server. `pnpm stage` runs what an operator runs: this
tree's packages published to a throwaway npm registry, installed with the real
CLI into a Linux container, started under pm2, served through Caddy. Use it for
what the dev server cannot show: the scaffold, the self-update, a rollback, a
restart, the page a browser gets while the app is down.

Needs Docker. Nothing is installed on your machine and nothing reaches npmjs.org.

```bash
pnpm stage local       # filesystem data, password sign-in
pnpm stage supabase    # the Supabase CLI stack from packages/providers/supabase
pnpm stage header      # forward-auth, the path Entra reaches
```

Each builds the tree, publishes it, scaffolds and starts it, then prints the
address (`http://localhost:8180`) and how to claim admin. Starting one replaces
the last: there is one staged deployment at a time.

## Watching an update

```bash
pnpm stage publish     # this tree becomes the next version in the registry
pnpm stage logs        # in a second terminal: update log, pm2, app output
```

Then update the way an operator would:

- in the browser, at `/admin/system`;
- or on the server: `pnpm stage sh`, then `npx selva update`.

Change code, `pnpm stage publish` again, update again. Each publish is one
version later (`4.21.0-beta.9.stage.1`, `.stage.2`, …).

`pnpm stage publish --broken` publishes a build that exits at boot. The updater
installs it, fails its health probe and rolls back to the version before.

`--no-build` skips the build when the tree was built a moment ago.

## The commands

| Command                     | Does                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| `pnpm stage <provider>`     | Builds, publishes, scaffolds and starts a fresh deployment        |
| `pnpm stage publish`        | Publishes the tree as the next version; `--broken` for a rollback |
| `pnpm stage logs`           | Follows `selva-update.log`, the pm2 daemon log and the app's logs |
| `pnpm stage sh`             | A shell in the deployment folder, as the user pm2 runs under      |
| `pnpm stage persona <name>` | Header only: the identity Caddy signs you in as                   |
| `pnpm stage down`           | Removes the containers, the registry and `.selva-data/stage/`     |

In the shell, everything an operator has works: `npx selva doctor`,
`npx selva restart`, `npx pm2 ls`, `npx selva config show`, `cat .env`.

Ports: `SELVA_STAGE_PORT` (8180) and `SELVA_STAGE_REGISTRY_PORT` (4873).

## What is real and what is not

Real: the published tarballs, `npx @selvajs/cli`, the `.env` and
`ecosystem.config.cjs` it writes, the pinned pm2, the app bound to loopback, the
update runner, the Caddyfile `selva setup-proxy` writes.

Different from a server:

- **Plain HTTP.** The Caddyfile is the production one on a port instead of a
  domain, so no certificate and no HSTS. Test sign-in in Chrome, Edge or Firefox:
  they accept a Secure cookie from `localhost`, Safari does not.
- **No systemd.** pm2 is not registered to start at boot, so `selva doctor`
  reports boot persistence as missing.
- **No Entra.** Header mode has Caddy inject a persona from
  `dev-personas.json`, as `pnpm dev:header` does. See
  [DEV-PROVIDERS.md](./DEV-PROVIDERS.md#entra-without-entra).
- **`NPM_CONFIG_REGISTRY` in `.env`** points the update check and the install at
  the staged registry.

## Supabase

The deployment uses the same local stack as `pnpm dev:supabase` and the
provider's conformance tests, so it shares their database: an admin that exists
there already exists here, and `/setup` is closed. `pnpm stage supabase` applies
the tree's migrations before it starts. `pnpm stage down` leaves the stack
running; stop it with `npx supabase stop` in `packages/providers/supabase`.

Email links from the stack (invites, magic links) point at the dev server's
address, not the staged one.

## Compute

Add a server at `/admin/compute`. A Rhino.Compute on your machine is
`http://host.docker.internal:<port>` from inside the container.
