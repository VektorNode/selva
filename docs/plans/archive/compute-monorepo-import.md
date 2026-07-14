# selva-compute → monorepo import

Status tracker for folding `@selvajs/compute` (was `github.com/VektorNode/selva-compute`)
into this monorepo at `packages/compute`. Done on branch `feat/monorepo-import-compute`.

## Why

The SLVA mesh wire format spans both repos (C# encoder in `Plugin/`, TS decoder in compute),
forcing lockstep npm publishes — visible as recurring `fix(deps): update @selvajs/compute` commits.
Co-locating makes format changes one atomic PR and readable end-to-end before open-sourcing.

## Done

- [x] Pre-import checks: secret scan clean across all compute history; dead branch
      `feat/display-batch-curves-points` deleted (superseded — its viewer tooling was
      reimplemented larger on `beta`).
- [x] `git subtree add --prefix=packages/compute <path> beta` — **full 171-commit history
      preserved** (merge commit's 2nd parent = `b6ffdaa`; blame/log intact).
- [x] Removed nested infra that duplicates monorepo root: `pnpm-lock.yaml`, `.changeset/`,
      `.husky/`, `.github/`, `.nvmrc`. Kept package-local `.gitignore` (dist/coverage/typedoc).
- [x] Switched 4 consumers (`plugin-ui`, `selva`, `server`, `ui`) from `catalog:` →
      `workspace:^`; removed the now-unused `@selvajs/compute` catalog entry.
- [x] `pnpm install` — workspace link resolves; compute builds all 4 entry points.

## Toolchain unification — DONE

Whole monorepo upgraded to the newer majors (the direction compute already used), in
verified stages:

- **vite 7 → 8** (catalog) + `@sveltejs/vite-plugin-svelte` 6 → 7. `@sveltejs/kit 2.69.1`
  already accepts vite 8 (no kit bump). `@selvajs/config` peer ranges widened for vite 8 +
  eslint 10.
- **typescript 5.9 → 6.0** (catalog) + `typescript-eslint`/`@typescript-eslint/*` → 8.64.
  Type-check 19/19 clean, zero code changes.
- **eslint 9 → 10** (catalog) + `@eslint/js` → 10, `eslint-plugin-svelte` → 3.20. Two new
  eslint-10 recommended rules (`no-useless-assignment`, `preserve-caught-error`) demoted to
  `warn` in the shared config — both fire on idiomatic code (try/catch fallback initializers,
  Svelte `$bindable(null)`, rethrows already carrying `cause`).
- **@types/node** held at the **22.x** line (matches CI publish runtime; compute's aspirational
  `^26` was pulled down to catalog — types must not promise APIs absent at runtime).
- **compute devDeps** migrated from pinned → `catalog:` for all shared toolchain deps; eslint
  ecosystem + coverage-v8/vitest aligned. All peer warnings cleared.

### eslint-10 config gotcha (fixed — don't regress)

typescript-eslint 8.64+ throws a **parse-time** error ("No tsconfigRootDir was set, and
multiple candidate TSConfigRootDirs are present") that eslint 9 silently tolerated. It was
masked by eslint's `--cache`; a cleared-cache lint exposed it. Two fixes in the shared config
([packages/config/eslint.config.js](../../packages/config/eslint.config.js)) + root config:

1. **Plain-JS files** (`**/*.{js,mjs,cjs}` — the CLI package, build/config scripts) get the
   untyped parser (`projectService: false, project: null, program: null`) — they're in no
   tsconfig.
2. **compute is `ignores`-d from the root `eslint .`** (it has its OWN tsconfig +
   `eslint.config.mjs`, which would be a second candidate root). It's linted by its own `lint`
   script, chained into the root `lint`/`lint:fix` in package.json.

Final: `pnpm build` (12/12), `pnpm type-check` (19/19), `pnpm lint` (0 errors, warnings-only)
all green.

## Remaining before merge

- [ ] Full `pnpm build` green (running).
- [ ] `pnpm type-check`, `pnpm lint`, `pnpm test` green (mixed-toolchain check).
- [ ] Add `@selvajs/compute` to changesets: it must appear in `.changeset/pre.json`
      `initialVersions` (currently absent) so beta pre-release versioning tracks it. Seed at
      its current `3.1.0-beta.10`. Confirm it's not accidentally in the `ignore` list.
- [ ] Fold compute's CI: its test/lint already run under the monorepo's turbo tasks; delete
      the standalone workflows (already removed from the package). Confirm `test.yml` /
      `e2e.yml` pick compute up via the workspace.
- [ ] Verify a dry-run beta version bump includes compute correctly.

## ⚠️ MANUAL — only the owner can do these (hard blockers for first publish)

1. **npm trusted-publisher (OIDC) re-registration.** `@selvajs/compute` publishes via OIDC,
   which binds the package to a specific `repo + workflow filename` on npmjs.org. It's
   currently registered to `VektorNode/selva-compute` → `release.yml`. **Update the trusted
   publisher on npmjs.org to `<this-repo>` → `.github/workflows/release.yml`** or the first
   post-migration `changeset publish` will be REJECTED (falls back to anonymous → 404 on PUT).
   No `NPM_TOKEN` fallback exists by design.
2. **Archive `VektorNode/selva-compute`** on GitHub (Settings → Archive) with a README pointer
   to this monorepo. Do NOT deprecate the npm package — `@selvajs/compute` keeps publishing
   under the same name; only the source repo is retired. External consumers (parapet, parafa)
   are unaffected.

## Verification

- `pnpm build && pnpm type-check && pnpm test` from root.
- Grep: no remaining `@selvajs/compute: catalog:` or version-pinned refs in consumers.
- One beta publish from the monorepo lands `@selvajs/compute@3.1.0-beta.11` under the `beta`
  dist-tag (after step 1 above).
