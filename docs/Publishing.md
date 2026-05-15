# Publishing

How to release Selva's npm packages. Default flow is changesets (manual or via CI). For shipping a single fix faster, see [Hotfix bypass](#hotfix-bypass) below.

## One version, four packages

Changesets runs in `fixed` mode across the four published packages — bumping any one bumps all four. Operators see a single version line; you stop tracking per-package versions.

| Published          | What it is                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `@selvajs/selva`   | Prebuilt SvelteKit app. Bundles `@selvajs/platform` + all providers. The thing operators install. |
| `@selvajs/cli`     | `npx @selvajs/cli <dir>` scaffolds a deployment; `selva <cmd>` runs day-2 ops.                    |
| `@selvajs/ui`      | Shared Svelte component library. Also bundled into `@selvajs/selva`.                              |
| `@selvajs/schemas` | Generated UI schema types. `peerDependency` of `@selvajs/ui`.                                     |

Everything else (`@selvajs/platform`, the providers, `@selvajs/plugin-ui`, `@selvajs/config`) is `"private": true` and bundled or consumed internally. If you want to publish one, change the architecture instead.

## One-time setup

```bash
npm login              # publish credentials
npm whoami             # confirm @selvajs org membership
```

## Release flow (changesets)

```bash
pnpm changeset           # record what changed; pick bump size + summary
pnpm changeset version   # apply bumps, write CHANGELOGs, rewrite workspace: deps
pnpm release             # pnpm build && changeset publish
git push --follow-tags
```

`pnpm publish` (run by `changeset publish`) rewrites `workspace:*` and `catalog:` specs to real versions in the tarball. **Never use `npm publish`** — it ships the literal `workspace:*` string and breaks installs.

## Automated releases (CI)

`.github/workflows/release.yml` runs [changesets/action](https://github.com/changesets/action) on every push to `main`:

- Pending `.changeset/*.md` files → opens/updates a "Version Packages" PR with bumps + CHANGELOG entries applied.
- Merged version PR → runs `pnpm release` and publishes in dep order.

Setup once: create an npm Automation token at `https://www.npmjs.com/settings/<user>/tokens`, add it as repo secret `NPM_TOKEN`.

Operator-facing flow: author commits a `.changeset/*.md` with their PR → CI maintains the version PR → merging the version PR ships the release → operators run `npm run update`.

## Hotfix bypass

For one small runtime or CLI fix without going through changesets. Don't use for coordinated multi-package releases.

**Runtime** (changes in `packages/selva/**`, `packages/providers/**`, or templates):

```bash
# Bump packages/selva/package.json patch version
pnpm --filter @selvajs/selva run build
grep -rl "<distinctive string from your fix>" packages/selva/build \
  || { echo "fix not in build — ABORT"; exit 1; }
pnpm --filter @selvajs/selva publish --access public --no-git-checks
npm view @selvajs/selva version
```

**CLI** (changes in `packages/cli/**`):

```bash
# Bump packages/cli/package.json patch version
node --input-type=module -e "await import('./packages/cli/src/cli.js')"  # smoke import
pnpm --filter @selvajs/cli publish --access public --no-git-checks
```

**Combined**: bump both, build runtime, publish runtime first then CLI.

## Two traps

### npm publish ships `workspace:*`

Always `pnpm publish` (or `changeset publish`, which uses it). If you ship a tarball with a literal `workspace:*` spec and you're inside the 72h unpublish window, unpublish, bump, republish. After 72h, use `npm deprecate`.

### npm cache hides your new version

Operators run `npm update` and still get the old package because npm's cached packument is stale. Recovery on the VM:

```bash
cd ~/apps/selva
npm cache clean --force
rm -rf node_modules package-lock.json
npm install --prefer-online
npm run restart
node -e "console.log(require('./node_modules/@selvajs/selva/package.json').version)"
```

Diagnose by comparing `npm view @selvajs/selva version` locally with the installed version on the VM.

## Troubleshooting

- **"cannot publish over previously published version"** — forgot to bump.
- **"You do not have permission to publish"** — `npm whoami`; check `@selvajs` org access.
- **`changeset publish` exits 0 but nothing happened** — local versions match npm. Did you run `pnpm changeset version`?
- **Tarball contains `workspace:*`** — you ran `npm pack`, not `pnpm pack`.
- **Fix missing from `packages/selva/build/`** — rebuild with `--force`.
- **`pnpm publish` blocks on dirty tree** — use `--no-git-checks` for the hotfix path.
- **Operator still on old version after update** — stale packument cache; see recovery above.
