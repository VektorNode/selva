---
'@selvajs/selva': patch
---

Fix production build crashing when runtime secrets are absent.

Provider wiring in `providers.server.ts` previously instantiated auth/data/storage
providers at module-import time, which calls `*.fromEnv()` and validates required
secrets (e.g. `SELVA_HMAC_KEY`). Because `vite build` loads the SSR bundle, this made
**building** the app require a full runtime environment — CI builds without those vars
crashed with `Missing required env var: SELVA_HMAC_KEY`.

Provider instantiation is now lazy and memoized via `resolveProviders()`: it runs on the
first request rather than at import. Importing the module is side-effect free, so builds
no longer need deployment secrets. Internal value exports (`tenancy`, `branding`,
`flags`, `definitionService`) became accessor functions (`getTenancy()`, `getBranding()`,
`flag()`, `getDefinitionService()`); the `providers` export is kept as a lazy proxy for
backward compatibility.
