# Publishing

How to release Selva's npm packages. Manual for now; the GitHub Actions slot is intentionally empty until the cadence justifies it.

## The one-mental-model rule

**Every published Selva package shares one version number.** Changesets is configured in `fixed` mode across the four published packages — bumping any one bumps all four. Operators see a single version line in their `package.json`. You stop tracking per-package versions in your head.

## What gets published

| Package             | Purpose                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@selvajs/selva`    | Prebuilt SvelteKit app. Bundles `@selvajs/platform` + all providers internally. The thing operators install and run.             |
| `@selvajs/cli`      | `npx @selvajs/cli <dir>` scaffolds a deployment; `selva <cmd>` runs day-2 ops on an existing one.                                |
| `@selvajs/ui`       | Shared Svelte component library. Bundled into `@selvajs/selva` internally; published separately so external Selva-adjacent repos can consume it. |
| `@selvajs/schemas`  | Generated UI schema types. `peerDependency` of `@selvajs/ui`.                                                                    |

That's it. Four published packages, one shared version.

## What does NOT get published

Marked `"private": true` in their `package.json` and listed in `.changeset/config.json` under `ignore`:

- `@selvajs/platform` — interface contracts, only consumed internally
- `@selvajs/local-provider`, `@selvajs/supabase-provider`, `@selvajs/header-auth-provider` — bundled into `@selvajs/selva`'s build artifact
- `@selvajs/builder-app` — embedded into `Selva.gha` at plugin build time
- `@selvajs/config` — shared ESLint / Vite / Prettier configs

If you find yourself wanting to publish one of these, **don't** — change the architecture instead. The point of bundling them is that operators install one package and get everything.

## One-time setup

```bash
npm login              # publish credentials
gh auth status         # confirms gh CLI works (used for PR notes later)
```

Run `npm whoami` to confirm you're publishing as a member of the `@selvajs` npm org.

## The release flow

```bash
# 1. Record what changed (interactive)
pnpm changeset
#    Pick the bump size (patch / minor / major). Write a one-line summary.
#    Because changesets is in fixed mode, picking *any* of the 4 published
#    packages applies the bump to all 4.

# 2. Apply bumps + write CHANGELOGs
pnpm changeset version
#    Reads .changeset/*.md, bumps versions, updates CHANGELOGs, rewrites
#    workspace:* deps between bumped packages. Commit the result.

# 3. Build + publish
pnpm release
#    Runs `pnpm build` then `changeset publish`. Publishes only packages whose
#    version on npm is behind the local version. Internal packages are skipped.
```

`pnpm publish` (called by `changeset publish` under the hood) rewrites `workspace:*` → real version ranges and `catalog:` → real versions in the published tarball. **Never use `npm publish`** — npm ships the literal `workspace:*` string, which silently breaks every install.

## First-publish checklist

Before the very first `pnpm release`:

1. **Reserve the namespace.** `npm view @selvajs/selva` should 404. If anyone else has registered `@selvajs/*`, stop and resolve ownership first.
2. **Confirm versions.** All four published packages should be at the same version in their `package.json`. If they've drifted, fix that before publishing.
3. **Dry-run.** `pnpm -r --filter '@selvajs/selva' --filter '@selvajs/cli' --filter '@selvajs/ui' --filter '@selvajs/schemas' exec pnpm pack`. Inspect each `.tgz`:
   - `tar -tzf <file>` — verify contents
   - `tar -xzOf <file> package/package.json` — verify no `workspace:*` or `catalog:` strings remain
   - Verify no `.env`, no `node_modules`, no secrets
4. **Publish.** `pnpm release`.

## Common operations

### Bug fix in a provider

```bash
pnpm changeset
# Pick @selvajs/selva (because the provider gets bundled into it), patch,
# "fix: NTFS path normalization on Windows in local-provider"
git add .changeset/ && git commit -m "changeset: local-provider NTFS fix"
```

You don't publish a new `@selvajs/local-provider` — it's internal. The fix reaches operators when they next `npm update @selvajs/selva` and the bundle contains the corrected provider code.

### Cut a release

```bash
pnpm changeset version   # accumulated .md files → version bumps + CHANGELOGs
git add . && git commit -m "release"
pnpm release             # builds + publishes the 4 public packages
git push --follow-tags
```

### One-off hotfix

For "shipping a single fix to one operator's VM right now" without going through changesets, see [Hotfix-CLI-Runtime.md](./Hotfix-CLI-Runtime.md). That doc is the escape hatch — the changesets flow is the default.

### Unpublish (within 72h)

```bash
npm unpublish @selvajs/<pkg>@<version>
```

After 72 hours npm forbids unpublishing. Use `npm deprecate` instead:

```bash
npm deprecate @selvajs/<pkg>@<version> "broken — use @<newer-version>"
```

## Troubleshooting

- **"You do not have permission to publish @selvajs/foo"** — `npm whoami`; check you're on the `@selvajs` org.
- **`changeset publish` exits 0 but nothing happened** — local versions match what's on npm. Did you run `pnpm changeset version`?
- **Tarball contains `workspace:*`** — you ran `npm pack`, not `pnpm pack`. Only pnpm rewrites workspace specs.
- **"This package has been marked as private"** — the package has `"private": true`. That's intentional for everything except the four published packages.

## Automated releases (active)

`.github/workflows/release.yml` runs [changesets/action](https://github.com/changesets/action) on every push to `main`:

- **If `.changeset/*.md` files are pending**: opens (or updates) a "Version Packages" PR with `pnpm changeset version` applied. The PR shows the proposed version bumps + CHANGELOG entries; reviewers can sanity-check before any publish.
- **If the merge contains bumped versions** (the post-version-PR-merge state): runs `pnpm release` (build + `changeset publish`) and ships the four public packages in dependency order.

The action figures out which mode to run from workspace state — no branching in the workflow file.

### One-time setup

Generate an npm automation token at https://www.npmjs.com/settings/`<your-user>`/tokens (pick "Automation"), then add it as a repo secret named `NPM_TOKEN` at **Repo → Settings → Secrets and variables → Actions**. The workflow's `contents: write` + `pull-requests: write` permissions are what let changesets/action open the version PR.

### Operator-facing workflow

1. Author writes a fix, runs `pnpm changeset`, commits the `.md` file alongside their PR.
2. PR merges to `main`.
3. CI opens "Version Packages" PR. **Don't merge it immediately** — let real changesets accumulate; this PR auto-updates on each new merge.
4. When ready to ship: merge "Version Packages" PR. CI publishes everything.
5. Tagged release lands on npm; operators can `npm run update`.

### Manual flow as fallback

The commands under "The release flow" above still work if you want to bypass CI (e.g. mid-incident hotfix where the workflow is paused or you don't trust the version PR's diff). See [Hotfix-CLI-Runtime.md](./Hotfix-CLI-Runtime.md) for the bypass path.
