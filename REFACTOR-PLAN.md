# Selva package consolidation — refactor plan

Direction B: collapse 8 published packages down to 2 (`@selvajs/selva` + `@selvajs/create`). Decided 2026-05-13. Pre-release, no installed users, manual SSH migration for the one deployed server.

## Status

- [x] **PR 1 — Rename & fold compute-app into selva.** Done. `@selvajs/runtime` deleted, `packages/compute-app/` → `packages/selva/` (`@selvajs/selva` v0.11.0, publishable). Verified: install clean, type-check 14/14, svelte-check 0/0, local-provider tests 219/219.
- [ ] **PR 2 — Fold platform + providers + ui + schemas into selva as subpath exports.**
- [ ] **PR 3 — Delete folded packages, finalize config.**

## PR 2 — Fold internals into `@selvajs/selva`

The goal: `@selvajs/selva` becomes the only library users `npm install`. They reach the platform interfaces and providers via subpath exports (`@selvajs/selva/platform`, `@selvajs/selva/providers/local`, etc.).

### Source moves

| From                              | To                                     |
| --------------------------------- | -------------------------------------- |
| `packages/platform/src/`          | `packages/selva/src/platform/`         |
| `packages/local-provider/src/`    | `packages/selva/src/providers/local/`  |
| `packages/supabase-provider/src/` | `packages/selva/src/providers/supabase/` |
| `packages/header-auth-provider/src/` | `packages/selva/src/providers/header-auth/` |
| `packages/schemas/src/`           | `packages/selva/src/schemas/`          |
| `packages/ui/src/`                | `packages/selva/src/ui/`               |

Use `git mv` everywhere to preserve history.

### Subpath exports

Add to `packages/selva/package.json`:

```jsonc
{
  "exports": {
    ".":                            "./build/index.js",       // existing main
    "./platform":                   "./dist/platform/index.js",
    "./providers/local":            "./dist/providers/local/index.js",
    "./providers/local/auth":       "./dist/providers/local/auth/index.js",
    "./providers/local/data":       "./dist/providers/local/data/index.js",
    "./providers/local/storage":    "./dist/providers/local/storage/index.js",
    "./providers/supabase":         "./dist/providers/supabase/index.js",
    "./providers/header-auth":      "./dist/providers/header-auth/index.js",
    "./schemas":                    "./dist/schemas/index.js",
    "./ui":                         "./dist/ui/index.js",
    "./ui/*":                       "./dist/ui/*.js"
  }
}
```

The current main (`./build/index.js`) is the SvelteKit-built deployable. The new subpath exports go through a separate `dist/` produced by tsc/svelte-package — needs its own build step alongside `vite build`.

### Heavy deps → peer/optional

Move out of `dependencies` into `peerDependencies` + `peerDependenciesMeta` (optional):

- `@supabase/supabase-js` — only used if user configures supabase provider
- (consider) `three`, `@lucide/svelte`, `bits-ui` — currently always installed

Result: a user picking only the local provider doesn't pull supabase-js into their node_modules. Add to `optionalDependencies` if you'd rather have npm soft-install them.

### Import rewrites

Across all moved source plus `packages/selva/src/lib/`, `packages/selva/src/routes/`, `selva.config.ts` (repo root), and templates:

| Old import                               | New import                                  |
| ---------------------------------------- | ------------------------------------------- |
| `@selvajs/platform`                      | relative path / `$lib/platform`             |
| `@selvajs/local-provider`                | relative path / `$lib/providers/local`      |
| `@selvajs/supabase-provider`             | relative path / `$lib/providers/supabase`   |
| `@selvajs/header-auth-provider`          | relative path / `$lib/providers/header-auth`|
| `@selvajs/schemas`                       | `$lib/schemas`                              |
| `@selvajs/ui`                            | `$lib/ui`                                   |

For `selva.config.ts` (which lives at repo root and is bundled at build), keep the public surface — it should import from `@selvajs/selva/platform`, `@selvajs/selva/providers/local`, etc. So users' `selva.config.js` files use the public package names, not internal paths. The dev-time `selva.config.ts` at repo root needs the same imports as the published example.

### Build

`packages/selva/scripts/build.js` (new — replaces the inline `build` script):

1. **Lib build** (new): `tsc` + `svelte-package` to emit `dist/` with the subpath modules. Heavy parts:
   - Server-side code in providers/platform: plain TS → `dist/.../*.js`
   - UI components (`.svelte`): need `svelte-package` (already used by `@selvajs/ui` today)
2. **App build** (existing): `vite build` produces `build/` (the deployable SvelteKit server)
3. **Templates** (existing): `generate-templates.js` writes `templates/selva.config.example.js` etc.

`publint` should run against `dist/` to validate the subpath exports map to real files.

### `@selvajs/create` updates

`packages/create/src/commands/create.js` — the scaffolded `package.json` shrinks to just two deps:

```js
const deps = {
  '@selvajs/create': pinnedCreateVersion,
  '@selvajs/selva':  pinnedSelvaVersion
};
// no more @selvajs/platform, @selvajs/local-provider, etc.
```

If supabase is selected, instruct npm to install the optional peer:

```js
if (providers.has('supabase')) deps['@supabase/supabase-js'] = '^2.104.1';
```

Pin to the create-time version (the runtime of create reads its own dependency version of `@selvajs/selva` and writes that string), not `"latest"`. Drops the version-skew class of bugs entirely.

`packages/create/src/commands/pm2.js` — update the `npm update` list to just `['@selvajs/create', '@selvajs/selva']` (plus `@supabase/supabase-js` if used).

`packages/create/src/commands/doctor.js` — `checkPackage(dir, '@selvajs/selva')` only.

### Templates

`packages/selva/scripts/generate-templates.js` — change the esbuild `external` list:

```js
external: [
  '@selvajs/selva/platform',
  '@selvajs/selva/providers/local',
  '@selvajs/selva/providers/supabase',
  '@selvajs/selva/providers/header-auth'
]
```

And update the repo-root `selva.config.ts` to import from those subpaths so the compiled template has the right imports baked in.

### Tests

Test fixtures in `packages/selva/src/lib/server/__tests__/` import from `@selvajs/local-provider` directly today. Switch to relative imports or `$lib/providers/local`. The vitest mock setup in `setup.ts` (mocks `$lib/server/providers.server`) should still work because that path doesn't change.

### Migration for the deployed server (PR 2)

Bigger than PR 1's migration. The operator's `selva.config.js` imports change:

```diff
- import * as local from '@selvajs/local-provider';
- import * as supa from '@selvajs/supabase-provider';
+ import * as local from '@selvajs/selva/providers/local';
+ import * as supa from '@selvajs/selva/providers/supabase';
```

Then:

```
npm uninstall @selvajs/platform @selvajs/local-provider @selvajs/supabase-provider @selvajs/header-auth-provider
npm install @selvajs/selva@latest
pm2 restart selva-compute --update-env
```

Consider scripting this as `selva migrate` in the CLI (one-shot, idempotent).

### Verification

- `pnpm install` clean
- `pnpm type-check` 14 tasks (will drop after PR 3)
- `pnpm check` 0/0
- `pnpm test` — same baseline as PR 1; aim for no *new* failures
- `pnpm pack` in `packages/selva/` — inspect the tarball, confirm `dist/`, `build/`, `templates/` all present
- `publint dist/` — exports map resolves
- Smoke: install the packed `.tgz` in a fresh dir and import each subpath

---

## PR 3 — Delete folded packages, finalize

Once PR 2 is verified:

- `git rm -r packages/platform packages/local-provider packages/supabase-provider packages/header-auth-provider packages/schemas packages/ui`
- Update `pnpm-workspace.yaml` if it lists them explicitly
- Update `.changeset/config.json` — these packages disappear from changeset's known list; verify there are no stale ignore entries
- Update `turbo.json` if any task filters reference them
- Update `CLAUDE.md` package list, `STRUCTURE.md` tree
- Delete CHANGELOGs (they're tracked in selva's CHANGELOG going forward)
- Final `pnpm install + type-check + check + test` pass
- One last `pnpm pack` on `@selvajs/selva` to confirm the deletion didn't break anything

After PR 3 lands, deprecate the now-orphaned packages on npm:

```
npm deprecate @selvajs/runtime "Use @selvajs/selva instead — same product, simpler install."
npm deprecate @selvajs/platform "Folded into @selvajs/selva. Use @selvajs/selva/platform."
npm deprecate @selvajs/local-provider "Folded into @selvajs/selva. Use @selvajs/selva/providers/local."
npm deprecate @selvajs/supabase-provider "Folded into @selvajs/selva. Use @selvajs/selva/providers/supabase."
npm deprecate @selvajs/header-auth-provider "Folded into @selvajs/selva. Use @selvajs/selva/providers/header-auth."
npm deprecate @selvajs/schemas "Internal — no longer published."
npm deprecate @selvajs/ui "Internal — no longer published."
```

---

## Pre-existing issues to fix separately

Surfaced during PR 1 verification but unrelated to the refactor. Either fix before/after or leave for normal-course work:

1. **`selva.config.ts` evaluates provider factories at module load**, so `pnpm build:selva` fails without `SELVA_HMAC_KEY` set. Either:
   - Lazy-evaluate (defer `_raw(env)` to first read)
   - Document it as a build requirement and add the keys to a build-time `.env`
   - Add a `prebuild` script in `packages/selva/package.json` that generates ephemeral dummy keys if real ones aren't set

2. **18 share-link tests in `packages/selva` fail** (`mint-revoke.test.ts`, `share-link-auth.test.ts`). HMAC/route 404 errors — likely tied to the recent key-rotation/auto-bootstrap commits. Files haven't been touched since the `@selva/*` → `@selvajs/*` rename, so the failures are from churn in the share-link logic or its dependencies.

---

## Notes / sharp edges

- **Provider deps are deduped after the collapse.** Today the user installs platform + selva + supabase-provider + supabase-js. After PR 2, just selva + (optional) supabase-js. Their `node_modules` shrinks meaningfully.
- **`@selvajs/compute` (the external Three.js helper) stays on its own.** Not part of this collapse — it's used by the Grasshopper-side world too and has independent release cadence.
- **`@selvajs/config` stays as a private internal package.** ESLint/Vite/Prettier configs; not user-facing.
- **`@selvajs/builder-app` stays as a private internal package.** It's the local schema designer, embedded into `Selva.gha`, not deployed as a web app.
