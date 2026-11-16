# Running Selva locally

`<auth>` = `local` | `supabase` | `header`. The `<auth>` commands run on throwaway data in
`.selva-data/dev-<mix>/` and never touch your own `.env`; they run beside `dev:selva`.

| Command                 | What                                                              | URL              |
| ----------------------- | ----------------------------------------------------------------- | ---------------- |
| `pnpm dev:selva`        | Your day-to-day dev server: `packages/selva/.env`, `.selva-data/` | `localhost:5173` |
| `pnpm dev:<auth>`       | Dev server pinned to a provider mix, hot reload                   | `localhost:5273` |
| `pnpm run stage <auth>` | Real install in Docker: pm2, Caddy, CLI scaffold, self-update     | `localhost:8180` |
| `pnpm compute:local`    | Rhino.Compute as the GCP server runs it                           | `localhost:6510` |

`run` is required: pnpm 11 has a built-in `stage`. Run Update only works on `stage`. Run these
from the repo root, or add `-w` (`pnpm -w run stage down`) from inside a package.

## Stop

| Running                         | Stop                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `pnpm dev:<auth>`               | `Ctrl+C` in its terminal                                        |
| `pnpm run stage <auth>`         | `pnpm run stage down` (container, registry and its data)        |
| `pnpm compute:local`            | `pnpm compute:local down`                                       |
| Supabase stack (`supabase` mix) | `npx supabase stop` in `packages/providers/supabase`; data kept |

`pnpm compute:local status` shows whether Compute runs; `docker ps` lists everything left.

## Flags (`dev` and `stage`)

| Flag                                     | Default                             |
| ---------------------------------------- | ----------------------------------- |
| `--data` / `--storage` `local\|supabase` | follow `<auth>` (local for header)  |
| `--tenancy single\|multi`                | single                              |
| `--examples`                             | off; uploads `examples/definitions` |
| `--persona admin\|member\|outsider`      | admin (header only)                 |

```bash
pnpm dev:header --data supabase --tenancy multi
pnpm run stage supabase --examples
```

## Sign in

| Setup                     | How                                                                            |
| ------------------------- | ------------------------------------------------------------------------------ |
| `--examples`              | `admin@dev.local` / `selva-examples` (`SELVA_SEED_PASSWORD` to override)       |
| `local`/`supabase`, plain | claim on `/setup`; stage prints the link (`npx selva setup-url` in `stage sh`) |
| `header`                  | none: Caddy signs you in as the persona                                        |

`--examples` also registers `compute:local` if no server is set. Start Compute first.

## Providers

- **local**: files in `.selva-data/dev-<mix>/`; delete to reset.
- **supabase**: Supabase CLI stack (Docker). API `:54421`, Studio `:54423`, mail `:54424`.
  One database shared by dev, stage and the provider tests, so it may already be claimed:
  `npx supabase db reset` in `packages/providers/supabase` empties it; `npx supabase stop` stops it.
- **header**: Caddy injects the `SELVA-*` headers Entra's proxy would. Dev: open `:8080`, not
  `:5273`; needs `caddy` on PATH (`winget install CaddyServer.Caddy`).

## Stage

```bash
pnpm run stage publish            # this tree as next version; update at /admin/system
pnpm run stage publish --broken   # fails at boot: watch the rollback
pnpm run stage logs | sh          # logs; shell (npx selva doctor, npx pm2 ls)
pnpm run stage examples           # seed a running deployment
pnpm run stage persona <name>     # header: switch identity
pnpm run stage down               # remove it all
```

One deployment at a time. `--no-build` skips the build. Differs from a server: plain HTTP
(use Chrome/Edge/Firefox), no pm2 boot persistence, update check hits a local registry.
Compute from the container: `http://host.docker.internal:6510`. Open it as `localhost:8180`, not
`127.0.0.1`: the app checks the origin, and a login from another one fails as a cross-site POST.

## Compute

Same image as the server (pushed `9.x.selva`), your Release Selva build, limits from
`infra/compute/.env`. Local: 2 cores, children exit after 60 s idle. Key in
`.selva-data/compute-local/compute-key`.

```bash
pnpm compute:local [--no-build]   # (re)start
pnpm compute:local --local        # Compute from the compute.rhino3d checkout, uncommitted edits too
pnpm compute:local status | logs | down
```
