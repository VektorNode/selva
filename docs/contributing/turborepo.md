# Turborepo

Selva uses [Turborepo](https://turborepo.com) to run workspace tasks in dependency order with caching.

## Commands

| Command                              | What it does                           |
| ------------------------------------ | -------------------------------------- |
| `pnpm build`                         | Build all packages                     |
| `pnpm build --filter=@selvajs/selva` | Build one package and its deps         |
| `pnpm check`                         | `svelte-check` across the workspace    |
| `pnpm type-check`                    | TypeScript checks across the workspace |
| `pnpm lint`                          | Root ESLint                            |
| `pnpm test`                          | Package tests                          |
| `pnpm generate`                      | Regenerate schema TS + C# types        |

`pnpm dev` and `dev:*` scripts run directly, not through turbo.

## Key behaviors

- `build` depends on `^build` — upstream packages build first.
- `schemas#build` depends on `generate` — codegen runs before `tsc`.
- Cache lives in `.turbo/`. Invalidated by `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `tsconfig.node.json`, and the `ADAPTER`/`NODE_ENV` env vars.
- `turbo run build --force` bypasses the cache.
- On Windows, `vite build` can occasionally fail with `ENOTEMPTY` in `@selvajs/ui` or `@selvajs/selva` — re-running fixes it.

## When to edit [turbo.json](../../turbo.json)

Only when a task needs explicit deps, outputs, inputs, or env tracking. Adding a script to a package is usually enough.
