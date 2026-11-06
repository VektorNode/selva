# Publishing

Two independent release tracks: **npm packages** (changesets) and **Grasshopper plugin** (`.yak` via `pnpm release:plugin`).

## Published packages

`@selvajs/selva` and `@selvajs/cli` share a version (changeset `fixed` group) so their MAJOR stays aligned. All other packages version independently.

`node scripts/release/publishable-packages.mjs --list` prints what ships: every workspace package without `"private": true`. The release workflow iterates the same list, so a new publishable package needs no workflow edit. Package roles are in [architecture.md](../architecture.md).

## npm release flow

```bash
pnpm changeset           # record what changed
pnpm changeset version   # apply bumps + write CHANGELOGs
pnpm release             # build + verify tarballs + changeset publish
git push --follow-tags
```

**Never use `npm publish`**: it ships literal `workspace:*` strings. Always use `pnpm publish` or `changeset publish`.

Two gates run before anything reaches npm. `prepack` runs `publint --strict` (export-map sanity) in every publishable package except `@selvajs/cli`, `@selvajs/selva` and `@selvajs/visualization`. `pnpm release` also runs `scripts/release/verify-pack.mjs` (standalone: `pnpm test:pack`, after a build) to check what the tarballs actually ship. The `selva-source` export condition is the one deliberate dangler: it serves the monorepo dev loop (vitest/vite resolve raw workspace TypeScript through it) and its `src/` targets are intentionally absent from published tarballs; being namespaced, no consumer resolves it by accident.

## Automated releases (CI)

`release.yml` runs on every push to `main` and `beta`:

- **main**: pending changesets → opens the "chore: version packages" PR. Merging it triggers publish.
- **beta**: versions as `x.y.z-beta.N` and publishes under the `beta` dist-tag. Requires `pnpm changeset pre enter beta` on the branch first.

Auth is GitHub→npm **OIDC** (`id-token: write`). There is **no `NPM_TOKEN`**: setting one would break publishing. Every package in `--list` needs its own Trusted Publisher entry at npmjs.com → Settings → Trusted Publisher (repo: `VektorNode/selva`, workflow: `release.yml`). A missing entry fails with a misleading 404.

## Promoting beta to stable

1. On `beta`: `pnpm changeset pre exit`, commit, push.
2. Open a PR `beta` → `main`. Merge it with a **merge commit**, never squash.
3. Merge the "chore: version packages" PR that `release.yml` opens on `main`. It publishes to `latest`.
4. On `beta`: `git merge origin/main`, then `pnpm changeset pre enter beta`, commit, push.

Sync `main` into `beta` only by merge commit. A cherry-pick, rebase or squash copies the change under a new hash, git then sees main's version bumps as unmerged, and the next PR conflicts in every `package.json` and `CHANGELOG.md` beta has bumped since. Resolve those in favour of beta (`git checkout --ours`).

## Release channel (admin opt-in to beta)

A self-hosted instance tracks one **release channel**, chosen in **Admin → System → Release channel**:

- **Stable** (default): installs the npm `latest` dist-tag.
- **Beta**: installs the npm `beta` dist-tag (the pre-releases from the `beta` branch above).

The choice is persisted to `selva-channel.json` in the deployment dir, next to `ecosystem.config.cjs`, so **both** the app and the update runner read it. Switching is **switch-only**: nothing updates until the operator runs **Application Update**, which installs `@selvajs/{cli,selva}@<channel-tag>`.

Reverting beta → stable is the same: switch to Stable, then Update. The runner installs the exact `@latest` version rather than running `npm update`, which is what lets it **downgrade** from a beta (`npm update` can't move backwards).

## Plugin releases (Yak)

The plugin has its own version line in `Plugin/Selva.GH/Selva.GH.csproj`, independent of npm. Releases are triggered by a `plugin-v*` tag.

**One-time setup**: add a `YAK_TOKEN` repo secret. Run `yak login` locally, copy `credentials.token` from `%APPDATA%\McNeel\yak.yml`.

`pnpm release:plugin [major|minor|patch|<x.y.z>]` prompts for the bump when you omit it; `--help` lists the flags. The script bumps the four version tags in the csproj, rolls `[Unreleased]` in `Plugin/CHANGELOG.md` into the new version, commits both, tags `plugin-v<x.y.z>`, and pushes. The CI workflow then builds the multi-target `.gha`, packages `.yak` files, pushes to Yak, and attaches them to a GitHub Release.

### Beta (pre-release) plugins

```bash
pnpm release:plugin minor --beta   # 0.13.0 → 0.14.0-beta.1
pnpm release:plugin --beta         # 0.14.0-beta.1 → 0.14.0-beta.2 (re-cut same target)
pnpm release:plugin 0.14.0         # 0.14.0-beta.N → 0.14.0 (promote to stable)
```

**Yak treats `-beta.N` as a pre-release**: it's hidden from Rhino's Package Manager and `yak install` unless the user opts in (the "include pre-releases" checkbox, or `yak install Selva --prerelease`). The matching GitHub Release is flagged as a pre-release too, so normal users never see beta builds.

`AssemblyVersion` / `FileVersion` stay numeric (`x.y.z.0`), since .NET rejects a suffix there, while `<Version>` / `<InformationalVersion>` (what yak and users see) carry the full `-beta.N`.

**Never push to Yak locally for a release**: watch the Actions tab instead.

### Local dry-run

```bash
pnpm run build:plugin   # produces .yak under Plugin/Selva.GH/bin/Yak/
yak push --source https://test.yak.rhino3d.com Plugin/Selva.GH/bin/Yak/rh-9/<pkg>.yak
```

## Hotfix bypass

For a single-package fix without going through changesets. Bump the package's `package.json` version first.

```bash
# Runtime (packages/selva/** or providers)
pnpm --filter @selvajs/selva run build
pnpm --filter @selvajs/selva publish --access public --no-git-checks

# CLI (packages/cli/**)
pnpm --filter @selvajs/cli publish --access public --no-git-checks
```

## Troubleshooting

- **`changeset publish` exits 0, nothing published**: versions match npm. Did you run `pnpm changeset version`?
- **Tarball contains `workspace:*`**: used `npm pack` instead of `pnpm pack`.
- **`pnpm publish` blocks on dirty tree**: add `--no-git-checks`.

### npm cache hides your new version

The operator still sees the old version because of a stale npm packument cache. Recovery: `npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online`.
