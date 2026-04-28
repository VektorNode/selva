# Turborepo

Selva uses [Turborepo](https://turborepo.com) as the task runner across the pnpm workspace. It replaces the hand-maintained `&&` build chains, derives dependency order from the workspace dep graph, and caches task output so unchanged packages don't rebuild.

## Quick reference

| Command | What it does |
| --- | --- |
| `pnpm build` | Build every package, in dep order, with caching |
| `pnpm build --filter=@selvajs/compute-app` | Build only one package + its deps |
| `pnpm check` | `svelte-check` across the workspace |
| `pnpm type-check` | TypeScript type-check across the workspace |
| `pnpm lint` | ESLint (not via turbo — runs once at root) |
| `pnpm test` | `vitest run` across packages that have tests |
| `pnpm generate` | Regenerate schema TypeScript + C# types |

`pnpm dev` and `pnpm dev:compute` are unchanged — they invoke a single package's `dev` script directly.

## How the task graph works

Turbo reads each package's `package.json` `scripts` and the rules in [turbo.json](../turbo.json). The interesting rules:

- **`build` `dependsOn: ["^build"]`** — the `^` means "build all upstream workspace deps first." So when you build [@selvajs/compute-app](../packages/compute-app/), turbo first builds [@selvajs/platform](../packages/platform/), [@selvajs/schemas](../packages/schemas/), [@selvajs/ui](../packages/ui/), etc. — in topo order, in parallel where possible.
- **`schemas#build` `dependsOn: ["^build", "generate"]`** — overridden in [packages/schemas/turbo.json](../packages/schemas/turbo.json). Forces `generate` (the JSON-schema → TS/C# codegen) to run before `tsc` compiles the package, since `tsc` reads `src/generated/`.
- **`generate` outputs include the .NET file** (`Plugin/Selva.Core/Models/UISchema.Generated.cs`) — turbo will track that file even though it lives outside the schemas package. Cache invalidates when [ui-schema.json](../packages/schemas/ui-schema.json) or [preset-schema.json](../packages/schemas/preset-schema.json) changes.

## Caching

The first build is slow (~2m). Subsequent runs with no source changes are ~2 seconds — turbo replays cached output instead of rebuilding.

Cache is local to your machine in `.turbo/` (gitignored). What invalidates it:

- **Source changes** — anything matching `inputs` in the relevant task definition.
- **Workspace files** — [pnpm-workspace.yaml](../pnpm-workspace.yaml), [pnpm-lock.yaml](../pnpm-lock.yaml), [tsconfig.base.json](../tsconfig.base.json), and [selva.config.ts](../selva.config.ts) are in `globalDependencies`, so any change to them busts every cache.
- **Env vars** — `build` tracks `ADAPTER` and `NODE_ENV` (the compute-app's [svelte.config.js](../packages/compute-app/svelte.config.js) reads `ADAPTER` to choose between `adapter-auto` and `adapter-node`). If you add Vite env vars that affect output, list them under `env` in the task definition or they'll silently break caching.

`turbo run build --force` bypasses the cache and rebuilds everything.

## When to edit turbo.json

Most of the time you don't. You add a script to a package and turbo picks it up automatically with default settings (cached, no deps, no inputs/outputs declared = always runs).

You **do** need to edit [turbo.json](../turbo.json) when:

- Adding a new task type that other tasks depend on (e.g. a `prebuild` step).
- A task produces output files that should be cached — declare them under `outputs`.
- A task reads files that aren't in `src/` — add them to `inputs`.
- A task reads env vars that change behavior — add them to `env`.

## Common workflows

**You changed a UI primitive.** Run `pnpm build` — turbo rebuilds [@selvajs/ui](../packages/ui/) and any downstream apps. Untouched packages (platform, providers, schemas) stay cached.

**You changed [ui-schema.json](../packages/schemas/ui-schema.json).** Run `pnpm build` — turbo runs `schemas#generate`, then `schemas#build`, then anything downstream. The .NET `UISchema.Generated.cs` is updated as a side effect (declared as a turbo output).

**You're iterating on a single package.** Use `pnpm dev:builder` / `pnpm dev:compute` / `pnpm dev:ui` — these go directly to the package's Vite dev server, no turbo overhead.

**You want to verify nothing's broken before pushing.** Run `pnpm check && pnpm lint && pnpm build`. With a warm cache, the first two are seconds and only `build` does real work — and only on packages you touched.

## Known issues

**Windows `ENOTEMPTY` flake on `vite build`.** Occasionally [@selvajs/ui](../packages/ui/) or [@selvajs/compute-app](../packages/compute-app/) fails with `ENOTEMPTY: directory not empty` during the `rm -rf dist && vite build` step. This is a Windows filesystem race in `svelte-package`, not a turbo issue. Re-running fixes it. (If it becomes frequent we can swap `rm -rf` for `rimraf` in the affected package scripts.)

## CI / remote caching

Not configured. To enable Turbo's remote cache (so CI shares with local devs), run `pnpm exec turbo login && pnpm exec turbo link`. Until then, every CI run is a cold build.
