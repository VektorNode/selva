---
'@selvajs/server': minor
'@selvajs/selva': patch
---

Extract the configurable provider wiring into `@selvajs/server/providers` (embeddable-server-layer K5):

- **`createSelvaProviders(env, options)`** — the reusable core of the app's composition root: env-driven provider selection (`SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`) over a caller-supplied `ProviderRegistry` of `fromEnv`-style factories, the external `selva.config.js` override (pass `configPath`), lazy memoized instantiation (nothing touches provider secrets at import/build time), flags (`SELVA_FLAG_*`, compile-time-exhaustive over `SelvaFlags`), branding with defaults, tenancy parsing, and the solve-metrics duck-type pick. Provider implementations are NOT bundled — the registry keeps this package free of dependencies on `@selvajs/local-provider` / `@selvajs/supabase-provider`.
- **`@selvajs/selva`** — `providers.server.ts` is now the app's composition root only: the bundled-provider registry, service singletons, and Sentry/process-hook error reporting; all wiring logic delegates to the package runtime.
- The shared `readBool`/`readPositiveInt` env parsers now warn with a `[selva]` prefix (previously `[computeLimits]`), since they serve provider flags too.
