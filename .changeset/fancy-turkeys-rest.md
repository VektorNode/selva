---
'@selvajs/selva': minor
'@selvajs/cli': patch
'@selvajs/schemas': patch
'@selvajs/ui': patch
---

**v2.0.0 — consolidation release.** All four published packages now share one version, locked in fixed mode.

- **CLI renamed:** `@selvajs/create` → `@selvajs/cli` (same bins, same behavior, more accurate name).
- **Providers internalized:** `@selvajs/platform`, `@selvajs/local-provider`, `@selvajs/supabase-provider`, and `@selvajs/header-auth-provider` are no longer published. Their code is bundled into `@selvajs/selva`'s build artifact at compile time.
- **Operator install simplified:** the only packages you install are `@selvajs/selva` (the app) and `@selvajs/cli` (the tool). Everything else is implementation detail.
- **External UI consumers:** `@selvajs/ui` still publishes alongside `@selvajs/schemas` as a peer dependency for repos that consume the component library directly.

See [`docs/Hotfix-CLI-Runtime.md`](https://github.com/VektorNode/selva/blob/main/docs/Hotfix-CLI-Runtime.md#migrating-an-existing-deployment-from-selvajscreate) for the one-time migration step on existing deployments.
