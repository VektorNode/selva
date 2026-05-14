# Selva package architecture — decision record

## Outcome (2026-05-14)

The final shape of the Selva monorepo and its release model:

- [x] **PR 1 — Rename & fold compute-app into selva.** `@selvajs/runtime` deleted; `packages/compute-app/` → `packages/selva/`; published package renamed `@selvajs/runtime` → `@selvajs/selva`.
- [x] **PR 2 — Cancelled.** Originally proposed collapsing all 8 packages into 2. Replaced by the privacy + rename pass below, which achieves the same operator-facing simplification without losing internal modularity.
- [x] **PR 3 — Cancelled.** Originally proposed moving the operator CLI into `@selvajs/selva`. Rejected because `@selvajs/selva` is a SvelteKit app, not a Node library — adding a `bin/` would force two unrelated lifecycles into one package. Solved differently by renaming `@selvajs/create` → `@selvajs/cli`.
- [x] **Rename `@selvajs/create` → `@selvajs/cli`.** The package ships both the `create` (scaffold) and `selva` (operate) bins. The old name implied scaffolder-only; the new name describes what it actually is.
- [x] **Mark internal packages private.** `@selvajs/platform` + the three providers (`local`, `supabase`, `header-auth`) are no longer published. They exist as workspace-internal deps, bundled into `@selvajs/selva`'s prebuilt artifact at build time.
- [x] **Move `@selvajs/schemas` from dependency → peerDependency of `@selvajs/ui`.** `ui` imports schemas only as types (every import is `import type`); the peer-dep relationship keeps schemas published for external consumers without bundling its runtime into `ui`.
- [x] **Switch changesets to fixed-version mode** across the 4 published packages: `@selvajs/selva`, `@selvajs/cli`, `@selvajs/ui`, `@selvajs/schemas`. One bump = all four bump. One mental model for operators: "the version number is the version number."

## Final package shape

### Published (4)

| Package             | What it is                                                            |
| ------------------- | --------------------------------------------------------------------- |
| `@selvajs/selva`    | Prebuilt SvelteKit app. Bundles platform + providers. The thing operators install and run. |
| `@selvajs/cli`      | `npx @selvajs/cli` to scaffold a deployment; `selva <cmd>` to operate one. |
| `@selvajs/ui`       | Shared Svelte component library. Used by `@selvajs/selva` internally; published for external Selva-adjacent repos. |
| `@selvajs/schemas`  | Generated UI schema types (TypeScript + C#). Peer dep of `@selvajs/ui`. |

All four share one version (changesets `fixed` mode). Operators see one number.

### Private (workspace-internal)

| Package                          | Why private                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| `@selvajs/platform`              | Interface contracts. Only consumed by selva + providers internally.  |
| `@selvajs/local-provider`        | Bundled into `@selvajs/selva`'s build artifact.                      |
| `@selvajs/supabase-provider`     | Bundled into `@selvajs/selva`'s build artifact.                      |
| `@selvajs/header-auth-provider`  | Bundled into `@selvajs/selva`'s build artifact.                      |
| `@selvajs/plugin-ui`             | Embedded into `Selva.gha` (Grasshopper plugin) at plugin build time. |
| `@selvajs/config`                | Shared ESLint / Vite / Prettier configs. Never published.            |

### External

`@selvajs/compute` — independent npm package, separate repo, own release cadence. Three.js / Rhino.Compute helpers consumed by `@selvajs/ui`.

## The operator's mental model

After this:

1. Operator runs `npx @selvajs/cli my-app` to scaffold a deployment.
2. Their `package.json` lists `@selvajs/selva` (and `@selvajs/cli`).
3. To update: `npm run update` → bumps the two packages → restarts pm2.
4. **They never think about providers, platform, or internal-package versions.** Those are implementation details of `@selvajs/selva`.

Provider hotfixes still require a `@selvajs/selva` republish (because providers are bundled into `selva`'s `build/`), but the operator-facing surface stays small.

## The release workflow

Per [docs/Publishing.md](./docs/Publishing.md):

```bash
pnpm changeset           # describe what changed
pnpm changeset version   # apply bumps + CHANGELOGs (fixed-mode: all 4 bump together)
pnpm release             # build + publish
```

That's it. Every internal package is either (a) auto-bumped as part of the fixed-mode set, or (b) explicitly ignored in `.changeset/config.json`. There's no per-package version tracking to do.

For one-off "I need this fix on a specific operator's VM now" situations, see [docs/Hotfix-CLI-Runtime.md](./docs/Hotfix-CLI-Runtime.md).

## Pre-existing issues to fix separately

Surfaced during cleanup, unrelated to packaging:

1. ~~**`selva.config.ts` evaluates provider factories at module load**, so `pnpm build:selva` fails without `SELVA_HMAC_KEY` set.~~ **Resolved (2026-05-14):** verified `pnpm --filter=@selvajs/selva build` succeeds with no env vars in a clean repo. SvelteKit's `$env/dynamic/private` is lazy at build time — server-module top-level code only runs at request time, not during `vite build`.

2. **18 share-link tests in `@selvajs/selva` fail** (`mint-revoke.test.ts`, `share-link-auth.test.ts`). HMAC/route 404 errors from recent key-rotation/auto-bootstrap commits. Test churn, not infrastructure.

3. **11 supabase-provider conformance tests fail at module load** because `readEnv()` instantiates a `SupabaseClient` before checking whether env vars are configured, and `@supabase/realtime-js` requires native WebSocket support (Node 22+; CI runs on 20). Either skip-guard `readEnv()` properly, or pass a `ws` transport into `createClient()`.

4. **`@selvajs/local-provider`'s dep on `sharp`** means even Supabase-only deployments download ~50MB of native binaries. Fixable later by moving image transcoding behind an optional capability.
