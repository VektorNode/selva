# Publishing

How to release Selva. Two independent tracks: the **npm packages** (changesets — manual or CI) and the **Grasshopper plugin** (`.yak`, via a `plugin-v*` tag — see [Plugin releases (Yak)](#plugin-releases-yak)). For shipping a single npm fix faster, see [Hotfix bypass](#hotfix-bypass).

## Published packages

Most packages publish to npm under `@selvajs/*`, in two versioning modes:

- **`@selvajs/selva` + `@selvajs/cli`** are a changeset `fixed` group — they always share a version, so their MAJOR versions stay aligned (the `selva doctor` cli/runtime compatibility check depends on this).
- **`@selvajs/ui`, `@selvajs/schemas`, `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`** version **independently**, on their own changesets. They're consumed standalone from npm (e.g. by Parafa), so lockstepping them to selva would only inflate their versions.

| Published                    | What it is                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `@selvajs/selva`             | Prebuilt SvelteKit app. Bundles ui + schemas + platform + all providers. What operators install. |
| `@selvajs/cli`               | `npx @selvajs/cli <dir>` scaffolds a deployment; `selva <cmd>` runs day-2 ops.                   |
| `@selvajs/ui`                | Shared Svelte component library (also bundled into `@selvajs/selva`).                            |
| `@selvajs/schemas`           | Generated UI schema types + the TS/C# generators.                                                |
| `@selvajs/platform`          | Provider interfaces + Zod schemas. Consumed by apps building custom providers.                   |
| `@selvajs/local-provider`    | Filesystem implementation of the platform interfaces.                                            |
| `@selvajs/supabase-provider` | Supabase implementation of the platform interfaces.                                              |

`"private": true` (never published — bundled or internal): `@selvajs/header-auth-provider`, `@selvajs/plugin-ui`, `@selvajs/config`.

The publish set is **derived from the workspace** (every non-`private` package) by `scripts/publishable-packages.mjs` — both the release workflow and a CI guard use it, so adding a publishable package needs no edits to either. That script also enforces invariants (e.g. `@selvajs/selva` stays a self-contained bundle; no published package has a runtime dependency on a private one).

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

Setup once: npm **Trusted Publishing (OIDC)**, configured per package at npmjs.com → ‹package› → Settings → Trusted Publisher, pointing at this repo (`VektorNode/selva`) and `release.yml`. There is **no `NPM_TOKEN` secret** — auth is the GitHub→npm OIDC handshake (the workflow grants `id-token: write`). Setting `NPM_TOKEN` would override OIDC and break publishing. The handshake is per-package, so each published package needs its own Trusted Publisher entry.

Operator-facing flow: author commits a `.changeset/*.md` with their PR → CI maintains the version PR → merging the version PR ships the release → operators run `npm run update`.

## Plugin releases (Yak)

The Grasshopper plugin has its **own version line** — `Plugin/Selva.GH/Selva.GH.csproj` `<Version>`, surfaced to yak via the `$version` token in the manifests — and its own cadence, independent of the npm packages. Releases are automated by `.github/workflows/plugin-release.yml`, triggered by a `plugin-v*` tag.

### One-time setup

Add a **`YAK_TOKEN`** repo secret (Settings → Secrets and variables → Actions): run `yak login` locally once, then copy the `credentials.token` value out of `%APPDATA%\McNeel\yak.yml`. yak reads this env var directly for `yak push` (no `yak.yml` is needed on the runner — verified against `test.yak.rhino3d.com`).

### Release flow

```bash
# 1. bump <Version> (and AssemblyVersion/FileVersion/InformationalVersion) in
#    Plugin/Selva.GH/Selva.GH.csproj, then commit
git commit -am "Plugin 0.10.4"
git push

# 2. tag that commit and push the tag
git tag plugin-v0.10.4
git push origin plugin-v0.10.4
```

The tag triggers the workflow on a **Windows runner**, which:

1. **Guards** that the tag (`0.10.4`) matches the csproj `<Version>` — mismatch fails the run.
2. Builds the multi-target `.gha` (net48 + net7.0 for Rhino 8, net9.0 for Rhino 9).
3. Packages the Rhino 8 / Rhino 9 `.yak` files.
4. `yak push`es them to the registry (→ Rhino's Package Manager).
5. Attaches them to a **GitHub Release** for the tag.

You **never run yak locally** for a release — watch the run in the **Actions** tab. Use a new version each time; yak rejects re-pushing an existing one.

### Local build (fallback / dry-run)

`pnpm run build:plugin` runs the same build locally, producing `.yak` files under `Plugin/Selva.GH/bin/Yak/`. To dry-run a publish without touching production, push to the sandbox server (periodically wiped by McNeel):

```bash
yak push --source https://test.yak.rhino3d.com Plugin/Selva.GH/bin/Yak/rh-8/<pkg>.yak
```

### Artifacts are not committed

`.yak` / `.gha` files are gitignored. Releases live on the **Yak registry** and **GitHub Releases**, not in git — older versions remain installable from Rhino's Package Manager regardless.

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
