# Turborepo

Selva uses [Turborepo](https://turborepo.com) to run workspace tasks in dependency order and reuse cached output.

## Quick reference

| Command                              | What it does                               |
| ------------------------------------ | ------------------------------------------ |
| `pnpm build`                         | Build all packages with caching            |
| `pnpm build --filter=@selvajs/selva` | Build one package and its deps             |
| `pnpm check`                         | Run `svelte-check` across the workspace    |
| `pnpm type-check`                    | Run TypeScript checks across the workspace |
| `pnpm lint`                          | Run root ESLint                            |
| `pnpm test`                          | Run package tests                          |
| `pnpm generate`                      | Regenerate schema TypeScript + C# types    |

`pnpm dev` and package-specific `dev:*` commands still run directly without turbo orchestration.

## Key behavior

- `build` depends on `^build`, so upstream workspace packages build first.
- [packages/schemas/turbo.json](../packages/schemas/turbo.json) makes `schemas#build` depend on `generate`, so codegen runs before `tsc`.
- `generate` also tracks `Plugin/Selva.Schema/Models/UISchema.Generated.cs`, even though it lives outside the package.

## Cache notes

- Cache lives in `.turbo/`.
- It is invalidated by task `inputs`, `globalDependencies`, and tracked env vars.
- In this repo, changes to [pnpm-workspace.yaml](../pnpm-workspace.yaml), [pnpm-lock.yaml](../pnpm-lock.yaml), [tsconfig.base.json](../tsconfig.base.json), or [selva.config.ts](../selva.config.ts) bust the cache.
- `build` also tracks `ADAPTER` and `NODE_ENV`.
- Use `turbo run build --force` to ignore the cache.

## When to edit [turbo.json](../turbo.json)

Edit it when a task needs explicit deps, outputs, inputs, or env tracking. Otherwise adding a script to a package is usually enough.

## Common workflows

- Changed shared UI code: run `pnpm build`.
- Changed [ui-schema.json](../packages/schemas/ui-schema.json): run `pnpm build` so generate + downstream builds run in order.
- Iterating on one package: use its `dev` script.
- Pre-push check: run `pnpm check && pnpm lint && pnpm build`.

## Known issue

On Windows, `vite build` can occasionally fail with `ENOTEMPTY` in [@selvajs/ui](../packages/ui/) or [@selvajs/selva](../packages/selva/). Re-running usually fixes it.

## Remote cache

Remote caching is not configured. Enable it with `pnpm exec turbo login` and `pnpm exec turbo link`.
