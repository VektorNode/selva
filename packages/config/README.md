# @selvajs/config

Shared build and tooling config for the workspace. Private — never published; consumed as
`workspace:*` by the other packages.

The vite and vitest exports are factories taking overrides rather than static objects, so a
package can extend the base without restating it.

| Export                     | Import                                  | Used by                      |
| -------------------------- | --------------------------------------- | ---------------------------- |
| `@selvajs/config/eslint`   | `{ config }` or `{ createConfig(dir) }` | package `eslint.config.js`   |
| `@selvajs/config/vite`     | `{ createViteConfig }`                  | SvelteKit apps               |
| `@selvajs/config/vitest`   | `{ createVitestConfig }`                | every package with tests     |
| `@selvajs/config/prettier` | default export                          | package `prettier.config.js` |

`config` is the flat rule array; `createConfig(tsconfigRootDir)` is the type-aware variant for
packages that lint with type information.

Typical use — the whole file:

```ts
// packages/<name>/vitest.config.ts
import { createVitestConfig } from '@selvajs/config/vitest';

export default createVitestConfig();
```

With overrides, which are merged over the base via `mergeConfig`:

```ts
export default createVitestConfig({
	test: { setupFiles: ['./src/__tests__/setup.ts'] }
});
```

## What belongs here

A rule **more than one package needs** and that fails _silently_ when a package forgets it.
Anything one package needs — setup files, path aliases, plugins, timeouts — belongs in that
package's override instead.

The configs carry inline comments explaining the non-obvious constraints they encode (the
`selva-source` export condition, why `isolate: false` must not be added to vitest, why
SvelteKit and Svelte are deduped in vite). Read those before changing a default: several
guard against failures that only appear on CI or in a production build.

## Versioning

Listed under `ignore` in [.changeset/config.json](../../.changeset/config.json) — it is
private, so it takes no changeset and no version bump.
