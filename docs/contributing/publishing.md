# Publishing

Two independent release tracks: **npm packages** (changesets) and **Grasshopper plugin** (`.yak` via `pnpm release:plugin`).

## Published packages

`@selvajs/selva` and `@selvajs/cli` share a version (changeset `fixed` group) so their MAJOR stays aligned. All other packages version independently.

| Package                      | What it is                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `@selvajs/selva`             | Prebuilt SvelteKit app. Bundles ui + schemas + platform + providers.         |
| `@selvajs/cli`               | `npx @selvajs/cli <dir>` scaffolds deployments; `selva <cmd>` for day-2 ops. |
| `@selvajs/ui`                | Shared Svelte component library.                                             |
| `@selvajs/schemas`           | UI schema types + TS/C# generators.                                          |
| `@selvajs/platform`          | Provider interfaces + Zod schemas.                                           |
| `@selvajs/compute`           | Rhino.Compute client and data trees. Pure solve/data — no renderer.          |
| `@selvajs/visualization`     | Headless viewer core: solve response → Three.js.                             |
| `@selvajs/solve`             | The solve flow, both sides of the wire.                                      |
| `@selvajs/server`            | Server building blocks: limits, rate limit, SSRF guard, definitions.         |
| `@selvajs/local-provider`    | Filesystem implementation of platform interfaces.                            |
| `@selvajs/supabase-provider` | Supabase implementation of platform interfaces.                              |

Private (never published): `@selvajs/header-auth-provider`, `@selvajs/plugin-ui`, `@selvajs/config`.

The publish set is derived from the workspace by `scripts/publishable-packages.mjs` — adding a publishable package needs no edits to the release workflow.

## npm release flow

```bash
pnpm changeset           # record what changed
pnpm changeset version   # apply bumps + write CHANGELOGs
pnpm release             # build + changeset publish
git push --follow-tags
```

**Never use `npm publish`** — it ships literal `workspace:*` strings. Always use `pnpm publish` or `changeset publish`.

## Automated releases (CI)

`release.yml` runs on every push to `main` and `beta`:

- **main**: pending changesets → opens "Version Packages" PR. Merging it triggers publish.
- **beta**: versions as `x.y.z-beta.N` and publishes under the `beta` dist-tag. Requires `pnpm changeset pre enter beta` on the branch first.

Auth is GitHub→npm **OIDC** (`id-token: write`). There is **no `NPM_TOKEN`** — setting one would break publishing. Each published package needs its own Trusted Publisher entry at npmjs.com → Settings → Trusted Publisher (repo: `VektorNode/selva`, workflow: `release.yml`).

## Release channel (admin opt-in to beta)

A self-hosted instance tracks one **release channel**, chosen in **Admin → System → Release channel**:

- **Stable** (default) — installs the npm `latest` dist-tag.
- **Beta** — installs the npm `beta` dist-tag (the `x.y.z-beta.N` pre-releases published from the `beta` branch above).

The choice is persisted to `selva-channel.json` in the deployment dir (gitignored, alongside `ecosystem.config.cjs`) so **both** the app and the update runner read it. Switching the channel is **switch-only** — it doesn't update anything; the operator then runs **Application Update**, which installs `@selvajs/{cli,selva}@<channel-tag>`.

**Reverting beta → stable** works the same way: switch to Stable, then Update. The runner `npm install`s the exact stable version pinned to `@latest`, which correctly **downgrades** from the beta you were on (a plain `npm update` can't move backwards — this is why the runner installs a tagged version rather than running `update`).

## Plugin releases (Yak)

The plugin has its own version line in `Plugin/Selva.GH/Selva.GH.csproj`, independent of npm. Releases are triggered by a `plugin-v*` tag.

**One-time setup**: add a `YAK_TOKEN` repo secret — run `yak login` locally, copy `credentials.token` from `%APPDATA%\McNeel\yak.yml`.

```bash
pnpm release:plugin            # prompts patch / minor / major
pnpm release:plugin minor      # bump directly
pnpm release:plugin 0.10.4     # set explicit version
```

The script bumps all four version tags in the csproj, commits, tags `plugin-v<x.y.z>`, and pushes. The CI workflow then builds the multi-target `.gha`, packages `.yak` files, pushes to Yak, and attaches them to a GitHub Release.

Flags: `--dry-run`, `--no-push`, `--build`, `-y`. Run `pnpm release:plugin --help`.

### Beta (pre-release) plugins

```bash
pnpm release:plugin minor --beta   # 0.13.0 → 0.14.0-beta.1
pnpm release:plugin --beta         # 0.14.0-beta.1 → 0.14.0-beta.2 (re-cut same target)
pnpm release:plugin 0.14.0         # 0.14.0-beta.N → 0.14.0 (promote to stable)
```

`--beta` produces an `x.y.z-beta.N` version. **Yak treats `-beta.N` as a pre-release**: it's hidden from Rhino's Package Manager and `yak install` unless the user opts in (the "include pre-releases" checkbox, or `yak install Selva --prerelease`). The matching GitHub Release is flagged as a pre-release too, so normal users never see beta builds.

`AssemblyVersion` / `FileVersion` stay numeric (`x.y.z.0`) — .NET rejects a suffix there — while `<Version>` / `<InformationalVersion>` (what yak and users see) carry the full `-beta.N`. Promoting to stable is just a normal release at the target `x.y.z`.

**Never push to Yak locally for a release** — watch the Actions tab instead.

### Local dry-run

```bash
pnpm run build:plugin   # produces .yak under Plugin/Selva.GH/bin/Yak/
yak push --source https://test.yak.rhino3d.com Plugin/Selva.GH/bin/Yak/rh-8/<pkg>.yak
```

## Hotfix bypass

For a single-package fix without going through changesets.

**Runtime** (`packages/selva/**` or providers):

```bash
# Bump packages/selva/package.json version
pnpm --filter @selvajs/selva run build
pnpm --filter @selvajs/selva publish --access public --no-git-checks
```

**CLI** (`packages/cli/**`):

```bash
# Bump packages/cli/package.json version
pnpm --filter @selvajs/cli publish --access public --no-git-checks
```

## Troubleshooting

- **"cannot publish over previously published version"** — forgot to bump.
- **"You do not have permission"** — `npm whoami`; check `@selvajs` org access.
- **`changeset publish` exits 0, nothing published** — versions match npm. Did you run `pnpm changeset version`?
- **Tarball contains `workspace:*`** — used `npm pack` instead of `pnpm pack`.
- **`pnpm publish` blocks on dirty tree** — add `--no-git-checks`.
- **Operator still on old version** — stale npm cache. Recovery: `npm cache clean --force && rm -rf node_modules package-lock.json && npm install --prefer-online`.
