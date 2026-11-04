# Turborepo

[Turborepo](https://turborepo.com) runs the workspace tasks in dependency order with caching. Task wiring and cache inputs live in [turbo.json](../../turbo.json); the root `package.json` scripts wrap it.

## The website is separate

`@selvajs/website` is filtered out of `build`, `check`, `type-check`, `lint` and `lint:types`. It has its own `build:website`, `check:website` and `lint:website`. `test` and `generate` run across every package.

Its `build` re-runs when `docs/**/*.md` (except `docs/adr/`) or the `compute` sources change, because it renders them. Docs are not a global dependency, so editing one doesn't invalidate any other package's cache.

On Windows, `vite build` can occasionally fail with `ENOTEMPTY` in `@selvajs/ui` or `@selvajs/selva`; re-running fixes it.

## When to edit turbo.json

Only when a task needs explicit deps, outputs, inputs, or env tracking. Adding a script to a package is usually enough. A package can override the root config with its own `turbo.json` that `extends: ["//"]`; `packages/schemas` does this so `build` waits for `generate`.
