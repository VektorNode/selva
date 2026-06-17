---
title: CLI
group: Guides
order: 1
published: true
---

# Selva CLI

Two binaries ship with a deployment:

- **`@selvajs/cli`** — scaffolds a new deployment (`npx @selvajs/cli <dir>`).
- **`selva`** — operates an existing deployment (`node_modules/.bin/selva`), also exposed as `npm run <name>` scripts.

## Quick start

```bash
npx @selvajs/cli my-deployment
cd my-deployment
npm run doctor    # validate before starting
npm start         # selva start → pm2 start
npm run logs      # tail logs
npm run update    # update @selvajs/* and restart
```

## `npx @selvajs/cli <dir>`

Scaffolds a fresh deployment. Prompts for provider, origin, tenancy, and secrets; runs `npm install`.

```bash
npx @selvajs/cli my-deployment
npx @selvajs/cli my-deployment --force          # overwrite non-empty dir
npx @selvajs/cli my-deployment --skip-install
```

What lands in `<dir>`:

| File                   | Purpose                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `.env`                 | All config. Contains `SELVA_HMAC_KEY` + `SELVA_AT_REST_KEY` — back these up. |
| `ecosystem.config.cjs` | PM2 process definition.                                                      |
| `package.json`         | Pins `@selvajs/selva` + `@selvajs/cli` + `pm2`.                              |
| `.selva-version`       | Marker for CLI migrations.                                                   |

Secrets are generated once — use `selva keys rotate` to rotate them later. Env-var reference: [packages/selva/.env.example](../packages/selva/.env.example).

## `selva` commands

All commands run from the deployment directory.

### `selva init`

Re-prompts for config and rewrites `.env` (uses existing values as defaults). Does not regenerate secrets or touch `package.json`. Restart afterwards.

### `selva doctor`

Validates the deployment without starting it. Exits 0 on success, 1 on any failure. Checks: required files, secret key format, provider/tenancy values, `DATA_PATH` writability, `@selvajs/selva` installed, `ORIGIN` valid.

### `selva start / stop / restart`

- `start` — `pm2 start ecosystem.config.cjs`
- `stop` — `pm2 stop selva-compute`
- `restart` — `pm2 restart selva-compute --update-env` (the `--update-env` flag picks up `.env` changes — always use this, never raw `pm2 restart`)

### `selva logs`

`pm2 logs selva-compute`. Extra args pass through (e.g. `selva logs --lines 200`).

### `selva update`

Runs `npm update --save @selvajs/cli @selvajs/selva` and restarts. If before/after versions are identical despite a known new release, you've hit npm's stale packument cache — see [Publishing.md](Publishing.md#troubleshooting).

### `selva keys rotate <hmac|at-rest>`

Generates a fresh secret and writes it to `.env`. Asks for confirmation.

| Target    | Env var             | What it breaks                                                             |
| --------- | ------------------- | -------------------------------------------------------------------------- |
| `hmac`    | `SELVA_HMAC_KEY`    | Logs everyone out; invalidates share/invite tokens.                        |
| `at-rest` | `SELVA_AT_REST_KEY` | Encrypted Rhino API key becomes unreadable — re-enter at `/admin/compute`. |

Restart afterwards.

## npm script aliases

| `npm run …`       | Runs            |
| ----------------- | --------------- |
| `npm start`       | `selva start`   |
| `npm run stop`    | `selva stop`    |
| `npm run restart` | `selva restart` |
| `npm run logs`    | `selva logs`    |
| `npm run doctor`  | `selva doctor`  |
| `npm run update`  | `selva update`  |

## Source locations

- CLI source: [packages/cli/src/](../packages/cli/src/)
- Deployment templates: [packages/selva/templates/](../packages/selva/templates/)
- Env-var reference: [packages/selva/.env.example](../packages/selva/.env.example)
- Linux deploy walkthrough: [deployment/GCE-Linux.md](deployment/GCE-Linux.md)
