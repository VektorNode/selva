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
- **beta**: versions as `x.y.z-beta.N` and publishes under the `beta` dist-tag. Runs only in pre mode, which `sync-beta` re-enters after each stable release.

Auth is GitHub→npm **OIDC** (`id-token: write`). There is **no `NPM_TOKEN`**: setting one would break publishing. Every package in `--list` needs its own Trusted Publisher entry at npmjs.com → Settings → Trusted Publisher (repo: `VektorNode/selva`, workflow: `release.yml`). A missing entry fails with a misleading 404.

## Promoting beta to stable

```bash
pnpm release:promote    # --dry-run checks everything and changes nothing
```

It exits pre mode, pushes `beta`, and opens the `beta` → `main` PR with auto-merge set to a merge commit. Then:

1. The PR merges itself once CI passes.
2. Merge the "chore: version packages" PR on `main`. It publishes to `latest`.
3. The `sync-beta` job in `release.yml` merges `main` back into `beta` and re-enters pre mode. If that merge conflicts, the job fails and lists the files to resolve by hand; after pushing the resolution, re-run the job to re-enter pre mode.

The PR must land as a merge commit, so the `main` ruleset allows merge commits only. A squash, cherry-pick or rebase copies beta's commits under new hashes: beta never sees them as merged, and the next promotion conflicts in every version line beta bumped since. `sync-beta` recovers from a squash only while beta has no commits past the promotion; otherwise it fails and lists the released changesets beta still holds, which would publish again.

With nothing to publish, `sync-beta` never runs, so the script refuses. CI or docs changes reach `main` as their own PR from a branch off `main`.

`release.yml` commits to `beta` after every push that carries a changeset. `git config pull.rebase merges` keeps pulling that from adding merge commits.

## Release bot (one-time setup)

A push, PR or merge made with `GITHUB_TOKEN` starts no workflows, and a push with it may not change `.github/workflows/`. Four steps use a GitHub App token instead. Without the App they fall back to `GITHUB_TOKEN`, and:

- The "chore: version packages" PR gets no CI until someone re-runs its checks by hand.
- A Dependabot PR the `lockfile` job repaired gets no CI, so it never auto-merges.
- A Dependabot auto-merge starts no `test.yml` or `release.yml` run on `beta`.
- `sync-beta` fails whenever `main` changed a workflow that `beta` lacks.

Setup:

1. [Create the App](https://github.com/organizations/VektorNode/settings/apps/new): any name, homepage `https://github.com/VektorNode/selva`, webhook **Active** unticked, repository permissions Contents, Pull requests and Workflows set to **Read and write**, installable only on this account.
2. Note the **App ID** under **General**, then **Credentials** → **Key pairs** → **New key** downloads the `.pem`.
3. **Install App** → VektorNode → only `selva`.
4. Store both in Actions and in Dependabot secrets (a Dependabot-triggered run reads only the latter), then delete the `.pem`:

   ```powershell
   $id = "<App ID>"; $pem = "<path to .pem>"
   foreach ($app in "actions", "dependabot") {
     gh secret set RELEASE_BOT_APP_ID --repo VektorNode/selva --app $app --body $id
     Get-Content $pem -Raw | gh secret set RELEASE_BOT_PRIVATE_KEY --repo VektorNode/selva --app $app
   }
   ```

A leaked key: delete it on the App's page and generate a new one. The App can write only to `selva`, and only those three permissions.

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
