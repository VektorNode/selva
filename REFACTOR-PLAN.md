# Selva package consolidation — decision record

## Outcome

**Package consolidation stopped after PR 1.** The current 8-package layout stays. PR 3 is a different kind of refactor — moving operator tooling into the package it manages.

- [x] **PR 1 — Rename & fold compute-app into selva.** Done. `@selvajs/runtime` deleted, `packages/compute-app/` → `packages/selva/` (`@selvajs/selva` v0.11.0, publishable). Verified: install clean, type-check 14/14, svelte-check 0/0, local-provider tests 219/219.
- [x] **PR 2 — Cancelled (2026-05-14).** All remaining packages stay independent.
- [ ] **PR 3 — Move the operator CLI from `@selvajs/create` into `@selvajs/selva`; shrink `@selvajs/create` to scaffolder-only.** See "PR 3" below.

## Why we stopped

Originally Direction B was "collapse 8 packages down to 2 (`@selvajs/selva` + `@selvajs/create`)." On reconsideration:

- **Platform + providers must stay separate to keep the door open for out-of-repo / third-party providers.** A future provider (private, customer-specific, side project) should be able to depend only on `@selvajs/platform` and ship as a regular npm package — not have to pull in the entire deployable web app.
- **UI + schemas stay separate too.** Even though they're internal-only today, keeping them as standalone packages preserves the option to publish them later, isolates their build/test surfaces, and avoids the larger `selva` rebuild churn whenever they change.

The architectural cost of folding (closing off the ecosystem, coupling release cadence, complicating the build) outweighed the install-simplification benefit, especially since end users always install several packages anyway via `selva.config.js` (selva + platform + chosen providers).

## Final package shape

| Package                          | Status                          |
| -------------------------------- | ------------------------------- |
| `@selvajs/selva`                 | Published — deployable web app  |
| `@selvajs/create`                | Published — scaffolder CLI      |
| `@selvajs/platform`              | Published — interface package; public extension point for providers |
| `@selvajs/local-provider`        | Published — first-party provider |
| `@selvajs/supabase-provider`     | Published — first-party provider |
| `@selvajs/header-auth-provider`  | Published — first-party provider |
| `@selvajs/schemas`               | Published — generated types + JSON schemas |
| `@selvajs/ui`                    | Published — shared UI components |
| `@selvajs/compute`               | Published (external) — Three.js / Rhino.Compute helpers, independent release cadence |
| `@selvajs/builder-app`           | Private — embedded into `Selva.gha` |
| `@selvajs/config`                | Private — ESLint/Vite/Prettier configs |

After PR 3 lands, `@selvajs/selva` also provides the `selva` CLI binary (operator tooling), and `@selvajs/create` shrinks to a pure scaffolder.

## PR 3 — Move operator CLI into `@selvajs/selva`

The `@selvajs/create` package today ships **two** binaries with totally different lifetimes:

- **`create`** — scaffolder, run once via `npx`, never installed
- **`selva`** — operator CLI with 8+ subcommands (`init`, `doctor`, `start`, `stop`, `restart`, `logs`, `update`, `keys rotate`), installed in every deployment, used daily

Calling that `@selvajs/create` is a smell — `selva keys rotate` coming from a package named "create" is confusing in `package.json` and update commands. Fix: move the operator CLI into `@selvajs/selva` (the package it manages); shrink `@selvajs/create` to scaffolder-only.

### Why fold the CLI into selva, but not platform/providers?

The arguments that kept platform + providers separate don't apply to the CLI:

| Argument for "keep separate"           | Platform/providers? | Operator CLI? |
| --------------------------------------- | ------------------- | ------------- |
| Public extension point (third parties) | Yes                 | **No** |
| Independent release cadence            | Yes                 | **No** — CLI is *of* selva; lockstep is correct |
| Avoids forcing heavy deps              | Yes (`supabase-js`) | **No** — CLI deps are tiny (`@clack/prompts`, `picocolors`); pm2 is shelled out, not imported |
| Conceptually adjacent, not "part of"   | Yes                 | **No** — manages selva, only selva |

### Source moves

| From                                       | To                                       |
| ------------------------------------------ | ---------------------------------------- |
| `packages/create/bin/selva.js`             | `packages/selva/bin/selva.js`            |
| `packages/create/src/commands/init.js`     | `packages/selva/src/cli/init.js`         |
| `packages/create/src/commands/doctor.js`   | `packages/selva/src/cli/doctor.js`       |
| `packages/create/src/commands/pm2.js`      | `packages/selva/src/cli/pm2.js`          |
| `packages/create/src/commands/keys.js`     | `packages/selva/src/cli/keys.js`         |
| (stays) `packages/create/bin/create.js`    | (unchanged — scaffolder)                 |
| (stays) `packages/create/src/commands/create.js` | (unchanged — scaffolder)           |

`git mv` everywhere to preserve history.

### `packages/selva/package.json`

Add the bin entry and the (small) CLI deps:

```jsonc
{
  "bin": { "selva": "./bin/selva.js" },
  "dependencies": {
    // …existing
    "@clack/prompts": "^0.11.0",
    "picocolors": "^1.1.1"
  }
}
```

The CLI is plain Node — no SvelteKit involvement. It can `import { ... }` from selva's compiled `build/` (e.g. `selva keys rotate` reuses the at-rest crypto from `src/lib/server/`), or shell out for things like pm2.

### `packages/create/package.json`

Drop the `selva` bin and the operator-only deps:

```diff
  "bin": {
-   "create": "./bin/create.js",
-   "selva": "./bin/selva.js"
+   "create": "./bin/create.js"
  },
  "dependencies": {
    "@clack/prompts": "^0.11.0",
    "picocolors": "^1.1.1"
  }
```

Scaffolder updates: scaffolded `package.json` no longer needs `@selvajs/create` as a runtime dep — only `@selvajs/selva` (which now provides the `selva` command).

### Self-update sharp edge

`selva update` becomes a true self-update (you're running selva's CLI to npm-update selva itself). The current `@selvajs/create` already has this pattern in `pm2.js#runUpdate`, so it's not new — but worth being deliberate:

- Don't read selva's binary mid-update; copy the path, exec, exit.
- Or: drop a sentinel file, restart pm2 (which re-reads bin), exit.
- Test: run `selva update` in a real deployment, confirm the process exits cleanly and pm2 picks up the new version.

### Naming

`@selvajs/create` could optionally rename to `create-selva` (unscoped) so `npm create selva` works as the documented invocation per npm convention. Open question — defer the decision; the bin entry name (`create`) and the npx invocation (`npx @selvajs/create`) work fine today.

### Migration for the deployed server

```diff
  // package.json
- "dependencies": {
-   "@selvajs/create": "^x.y.z",
-   "@selvajs/selva": "^a.b.c",
-   …
- }
+ "dependencies": {
+   "@selvajs/selva": "^a.b.c",   // now provides `selva` bin too
+   …
+ }
```

Then on the box:

```
npm uninstall @selvajs/create
npm install @selvajs/selva@latest
# ecosystem.config.cjs / pm2 setup that calls `selva start` keeps working — same bin name, just from a different package
pm2 restart selva-compute --update-env
```

If the operator's `ecosystem.config.cjs` references `node_modules/@selvajs/create/bin/selva.js` directly (vs. just `selva` on PATH), they need to update the path. Check the deployed config before announcing.

### Verification

- `pnpm install` clean
- `pnpm type-check` unchanged
- `which selva` in a fresh `npm install`'d project resolves to `node_modules/.bin/selva` pointing into `@selvajs/selva`
- `selva help` lists the same 8+ commands
- `selva keys rotate hmac` and `selva doctor` smoke-test in a scratch project
- `pnpm pack` `@selvajs/create` — confirm it ships only `bin/create.js` + scaffolder src + templates
- `pnpm pack` `@selvajs/selva` — confirm it ships `bin/selva.js`

### Open: do we want it as PR 3 right now, or after the pre-existing issues?

The pre-existing issues below (`SELVA_HMAC_KEY` build coupling, share-link test failures) are independent and could go in either order. The CLI fold is mechanical and low-risk; doing it first would mean the bug fixes can use the new layout. Defer the decision until it's actually time to start.

## Pre-existing issues to fix separately

Surfaced during PR 1 verification but unrelated to consolidation. Tracked here so they aren't lost:

1. **`selva.config.ts` evaluates provider factories at module load**, so `pnpm build:selva` fails without `SELVA_HMAC_KEY` set. Options:
   - Lazy-evaluate (defer `_raw(env)` to first read)
   - Document it as a build requirement and add the keys to a build-time `.env`
   - Add a `prebuild` script in `packages/selva/package.json` that generates ephemeral dummy keys if real ones aren't set

2. **18 share-link tests in `packages/selva` fail** (`mint-revoke.test.ts`, `share-link-auth.test.ts`). HMAC/route 404 errors — likely tied to the recent key-rotation/auto-bootstrap commits. Files haven't been touched since the `@selva/*` → `@selvajs/*` rename, so failures are from churn in share-link logic or its dependencies.
