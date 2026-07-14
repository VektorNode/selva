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

## Known state / deferred (per decision: import first, unify toolchain later)

- **Toolchain divergence is LIVE.** Compute pins newer devDeps (eslint 10, TS 6, vite 8,
  @types/node 26) than the monorepo catalog (eslint 9, TS 5, vite 7, node 22). With
  `shared-workspace-lockfile: true`, pnpm hoisted **vite 8.1.4** to root, so
  `@sveltejs/vite-plugin-svelte 6.2.4` in `selva` + `ui` now shows an **unmet vite peer**
  (wants ^6.3||^7). This is a warning, not a failure — but it's why a dedicated
  toolchain-unification pass is the next task after this import verifies green.
  Compute's devDeps were intentionally left pinned (not `catalog:`) so it stays
  self-consistent until that pass.

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
