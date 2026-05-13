# Publishing

How to release Selva's npm packages. Manual flow for now — the automation is left disabled until we know the cadence.

## What gets published

| Package | Purpose |
|---|---|
| `@selvajs/platform` | Interfaces + Zod schemas. Third parties depend on this to write custom providers. |
| `@selvajs/local-provider` | Filesystem provider. Runtime imports it when `SELVA_*_PROVIDER=local`. |
| `@selvajs/supabase-provider` | Supabase provider. Runtime imports it when `SELVA_*_PROVIDER=supabase`. |
| `@selvajs/header-auth-provider` | Forward-auth provider (Caddy / oauth2-proxy / Authelia). Auth-only — paired with another data/storage provider. |
| `@selvajs/schemas` | Generated UI schema types (TypeScript + C#). Published for downstream consumers. |
| `@selvajs/ui` | Shared Svelte component library. Published for downstream consumers. |
| `@selvajs/runtime` | Prebuilt compute-app. Customers `npm install` this to deploy. |

Internal-only (apps, not libraries — marked `"private": true` and listed in `.changeset/config.json` `ignore`): `@selvajs/builder-app`, `@selvajs/compute-app`, `@selvajs/config`. Changesets skips them automatically.

## One-time setup

```bash
npm login                      # publish credentials
gh auth status                 # confirms gh CLI works (used for PR notes later)
```

The publishable packages all have `publishConfig.access = "public"`, so `npm publish` defaults right.

## The release flow

```bash
# 1. Record what changed (interactive)
pnpm changeset
#    Pick the changed packages, the bump (patch / minor / major), write a summary.
#    A markdown file lands in .changeset/. Commit it.

# 2. Apply bumps + write CHANGELOGs
pnpm changeset version
#    This reads .changeset/*.md, bumps package.json versions, updates CHANGELOGs,
#    and rewrites workspace:* deps between bumped packages.
#    Commit the result.

# 3. Build + publish
pnpm release
#    Runs `pnpm build` then `changeset publish`. Publishes only packages whose
#    version on npm is behind the local version. Skips the ignored ones.
```

`pnpm publish` (called by `changeset publish` under the hood) rewrites `workspace:*` → real versions and `catalog:` → real versions in the published tarball. Verified by extracting `package.json` from a `pnpm pack` tarball — see [WhiteLabelPlan.md](./WhiteLabelPlan.md#step-3) for the trace.

## First-publish checklist

The packages have never been on npm before. Before running `pnpm release` the first time:

1. **Reserve the namespace.** `npm view @selvajs/platform` should 404. If anyone else has registered `@selvajs/*`, stop and resolve ownership first.
2. **Confirm versions.** `package.json` says `0.2.0` for the providers + platform, `0.1.0` for the runtime. That's the first published version — make sure it's correct.
3. **Dry-run.** Before the real publish:
   ```bash
   pnpm -r --filter '@selvajs/platform' --filter '@selvajs/local-provider' --filter '@selvajs/supabase-provider' --filter '@selvajs/header-auth-provider' --filter '@selvajs/runtime' exec pnpm pack
   ```
   Inspect each `.tgz` (`tar -tzf <file>` for contents, `tar -xzOf <file> package/package.json` for the rewritten manifest). Look for: no `workspace:*` / `catalog:` strings, no `.env`, no `node_modules`.
4. **Publish.** `pnpm release`.

## Common operations

### Add a changeset for a single bug fix

```bash
pnpm changeset
# select @selvajs/local-provider, patch, "fix: NTFS path normalization on Windows"
git add .changeset/ && git commit -m "changeset: local-provider NTFS fix"
```

You don't release immediately — changesets accumulate until you want to cut a version.

### Cut a release

```bash
pnpm changeset version    # accumulated .md files → version bumps + CHANGELOGs
git add . && git commit -m "release"
pnpm release              # builds + publishes
git push --follow-tags
```

### Skip the runtime in a release (providers only)

When the runtime didn't change but providers did, don't write a changeset for `@selvajs/runtime`. `changeset version` will only bump packages that have at least one changeset, plus their dependents. The runtime won't bump unless it directly depends on a bumped package and you've set `updateInternalDependencies` accordingly.

`updateInternalDependencies` is `"patch"` in our config — so a provider patch bump cascades a patch bump to the runtime. If you want to break that cascade, set it to `false` (changesets stops touching internal deps), but then customers won't get patched providers unless they update the runtime version themselves.

### Unpublish (within 72h)

```bash
npm unpublish @selvajs/<pkg>@<version>
```

After 72 hours, npm forbids unpublishing for ecosystem stability. Use `npm deprecate` instead:

```bash
npm deprecate @selvajs/<pkg>@<version> "broken — use @<newer-version>"
```

## When we automate

The `.github/workflows/release.yml` slot is intentionally empty until the release cadence justifies it. The standard upgrade is [changesets/action](https://github.com/changesets/action), which:

- Watches `main` for `.changeset/*.md` files.
- Opens a "Version Packages" PR with `pnpm changeset version` applied.
- On merge, runs `pnpm release`.

That needs `NPM_TOKEN` as a repo secret and a tweak to the workflow's `permissions:` block. Drop in when you're tired of running these commands by hand.

## Troubleshooting

- **"You do not have permission to publish @selvajs/foo"** — you're not logged in or not on the @selvajs org. `npm whoami`, `npm org ls @selvajs`.
- **"This package has been marked as private"** — the package has `"private": true`. We've flipped all 5 publishable ones already; if a new one is added, mirror the `license` / `publishConfig.access` block from `@selvajs/platform`.
- **`changeset publish` exits 0 but nothing happened** — the local versions match what's on npm. Did you run `pnpm changeset version`?
- **Tarball contains `workspace:*`** — you're running `npm pack`, not `pnpm pack`. Only pnpm rewrites workspace specs.
