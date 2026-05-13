# @selvajs/create

CLI for white-label Selva deployments.

## Bootstrap a new deployment

```bash
npx @selvajs/create my-deployment
```

Interactive scaffolder. Prompts for provider, tenancy, flags, brand name, admin email. Generates `SELVA_HMAC_KEY` + `SELVA_AT_REST_KEY`. Writes `.env`, `selva.config.js`, `ecosystem.config.cjs`, `package.json`. Runs `npm install`.

## Operate an existing deployment

After install, the package exposes a `selva` bin:

```bash
selva init                  # reconfigure prompts; preserves existing secrets
selva doctor                # validate env + providers + paths
selva start | stop | restart | logs
selva update                # npm update @selvajs/runtime + pm2 restart
selva keys rotate hmac      # rotate SELVA_HMAC_KEY (logs everyone out)
selva keys rotate at-rest   # rotate SELVA_AT_REST_KEY (compute API key needs re-entry)
```

All operator commands run inside the deployment directory (the one that contains `.env` and `ecosystem.config.cjs`).

## Idempotency rules

- `npx @selvajs/create` refuses to overwrite a non-empty directory without `--force`.
- `selva init` reads the current `.env`, lets the user edit, and **never** regenerates `SELVA_HMAC_KEY` / `SELVA_AT_REST_KEY` if they're already set.
- A `.selva-version` marker is written so future CLI versions can migrate config schema cleanly.

## Relationship to `@selvajs/runtime`

The CLI generates a deployment directory whose `package.json` depends on `@selvajs/runtime`. The runtime ships the prebuilt SvelteKit `node` build plus PM2 / config templates; the CLI's job is to fill in the template values and wire everything together.
