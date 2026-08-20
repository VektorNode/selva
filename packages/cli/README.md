# @selvajs/cli

CLI for white-label Selva deployments.

## Bootstrap a new deployment

```bash
npx @selvajs/cli my-deployment
```

Prompts for provider, tenancy, flags, brand name, admin email; generates `SELVA_HMAC_KEY` and `SELVA_AT_REST_KEY`; writes `.env`, `ecosystem.config.cjs`, `package.json`; runs `npm install`. Refuses to overwrite a non-empty directory unless you pass `--force`.

## Operate an existing deployment

Installing adds a `selva` bin, scoped to the deployment directory (needs `.env` or `ecosystem.config.cjs` in the cwd):

```bash
selva init                 # reconfigure prompts; keeps existing secrets
selva doctor [--fix]       # validate env, providers, Node engine, boot persistence
selva migrate              # bring package.json onto the current layout
selva start | stop | restart | logs
selva update                 # update @selvajs/cli + @selvajs/selva, then restart
selva keys rotate hmac      # rotate SELVA_HMAC_KEY (logs everyone out)
selva keys rotate at-rest   # rotate SELVA_AT_REST_KEY (compute API key needs re-entry)
```

`selva init` never regenerates `SELVA_HMAC_KEY` or `SELVA_AT_REST_KEY` once they're set — rotating those is `keys rotate`'s job, since it invalidates sessions or encrypted data.

## Relationship to `@selvajs/selva`

The CLI generates a deployment directory whose `package.json` depends on `@selvajs/selva`. The runtime ships the prebuilt SvelteKit `node` build plus PM2 / config templates; the CLI's job is to fill in the template values and wire everything together.
