# Turborepo

Selva uses [Turborepo](https://turborepo.com) to run workspace tasks in dependency order with caching.

## Commands

| Command                              | What it does                           |
| ------------------------------------ | -------------------------------------- |
| `pnpm build`                         | Build all packages except `website`    |
| `pnpm build --filter=@selvajs/selva` | Build one package and its deps         |
| `pnpm check`                         | `svelte-check` across the workspace    |
| `pnpm type-check`                    | TypeScript checks across the workspace |
| `pnpm test`                          | Package tests                          |
| `pnpm generate`                      | Regenerate schema TS + C# types        |

`build`, `check`, and `type-check` all filter out `@selvajs/website`; it has its own
`build:website` / `check:website` scripts.

`pnpm lint` does **not** go through turbo; it runs ESLint at the repo root, then the separate
`@selvajs/compute` and `@selvajs/visualization` configs. `dev:*` scripts also run directly.

## Key behaviors

- `build` depends on `^build`: upstream packages build first.
- `schemas#build` depends on `generate`: codegen runs before `tsc`.
- Cache lives in `.turbo/`. Invalidated by `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `tsconfig.node.json`, `docs/**`, and per-task env vars (`ADAPTER`, `NODE_ENV`, `SELVA_HMAC_KEY`, `SELVA_AT_REST_KEY`, `DATA_PATH` for `build`).
- `turbo run build --force` bypasses the cache.
- On Windows, `vite build` can occasionally fail with `ENOTEMPTY` in `@selvajs/ui` or `@selvajs/selva`; re-running fixes it.

## When to edit [turbo.json](../../turbo.json)

Only when a task needs explicit deps, outputs, inputs, or env tracking. Adding a script to a package is usually enough. A package can override the root config with its own `turbo.json` that `extends: ["//"]`; `packages/schemas` does this to add the `generate` dependency.
