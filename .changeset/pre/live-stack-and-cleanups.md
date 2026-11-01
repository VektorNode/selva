---
'@selvajs/platform': minor
'@selvajs/local-provider': patch
'@selvajs/supabase-provider': patch
'@selvajs/server': patch
'@selvajs/selva': patch
---

Two admins demoting each other on Supabase no longer deadlock. One now gets `last_admin` rather than a 500. Apply this release's migration: run `npx selva-supabase`, then `npx supabase db push`.

New in `@selvajs/platform`, none of it breaking:

- `COMPUTE_TIMEOUT_DEFAULT_MS`, `COMPUTE_TIMEOUT_MIN_MS`, `COMPUTE_TIMEOUT_MAX_MS` and `COMPUTE_RETRY_MAX`, plus `clampTimeoutMs` and `clampRetryCount`, so the settings forms and the server agree on one set of limits.
- `pickServer`, for a caller that holds an already-filtered server list.
- `decodeOffsetCursor`, `encodeOffsetCursor` and `clampPageLimit`, which both providers now use. A `NaN` limit reads as the default.
- `assertCanAccessProfile` and `MAX_RECENT_RUNS` from `@selvajs/platform/userProfile`, for adapter authors.
- `runOAuthAuthConformance` and `runAuditQueryConformance` in `@selvajs/platform/testing`.
- `defineConfig` keeps the type you pass it.
