# @selvajs/server

## 0.2.0-beta.5

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

### Patch Changes

- Updated dependencies [aa2abf6]
  - @selvajs/compute@3.1.0-beta.12

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies
  - @selvajs/platform@0.15.0-beta.1

## 0.2.0-beta.3

### Minor Changes

- 594b5ad: Adding advanced caching

## 0.2.0-beta.2

### Minor Changes

- 8860c4b: Second-wave reusable utilities extracted from the Selva app into `@selvajs/server` (tracker items E1–E6), each as a new subpath:

  - `@selvajs/server/tokens` — `createTokenCodec({ prefix, secret })`, the HMAC capability-token primitive behind share links and invites (mint 32-byte base64url tokens, HMAC-SHA256 hash at rest, constant-time hash compare, prefix recognition). The factory enforces a ≥32-character secret so a short dev secret can't reach production silently; the app's share-link and invite token modules are now thin env bindings over one codec each.
  - `@selvajs/server/errors` — `SentryErrorReporter`, the `IErrorReporter` implementation backed by a dynamically-imported `@sentry/node` (now an optional peer dependency). Literal move from the app.
  - `@selvajs/server/http` — `safeRedirectTarget` (open-redirect guard), `declaredBodySizeExceeds` (transport-agnostic Content-Length guard; the app maps it to its 413), `applySecurityHeaders` (nosniff / Referrer-Policy / Permissions-Policy / opt-in HSTS; CSP and frame headers deliberately omitted for iframe embedding — cache-control stays app policy), and `createRouteClassifier` (deny-by-default route classification: exact public pages, public prefixes, public APIs, one self-gating prefix, static assets — the app supplies its route values).
  - `@selvajs/server/access` — `createProjectAccessInputBuilder(deps)`, the marshalling layer between an app's providers and platform's pure access rules: it owns the "which rows does each project visibility need" knowledge (`platform`→grants, `private`→member, `org`/`public`→member+orgMember with the cross-org-public skip) plus the zero-I/O `projectAccessInputFromRows` for batched listing pages. Row lookups and flag reads are injected as functions.
  - `@selvajs/server/ops` — channel-aware `parseSemver`/`isNewer` (stable ignores pre-release tails; beta orders `-beta.N` and ranks a stable core above its betas) and the `ReleaseChannel` type.
  - `ComputeRateLimiter` gains `peek(key)` and `clear(key)`, making it usable for failure-counting flows; the app's hand-rolled admin login rate limiter is deleted in favor of a limiter instance from this package.

## 0.2.0-beta.1

### Patch Changes

- Local version bump for @selvajs/server (not yet published to npm).

## 0.2.0-beta.0

### Minor Changes

- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.

- 2673995: Extract the configurable provider wiring into `@selvajs/server/providers` (embeddable-server-layer K5):

  - **`createSelvaProviders(env, options)`** — the reusable core of the app's composition root: env-driven provider selection (`SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`) over a caller-supplied `ProviderRegistry` of `fromEnv`-style factories, the external `selva.config.js` override (pass `configPath`), lazy memoized instantiation (nothing touches provider secrets at import/build time), flags (`SELVA_FLAG_*`, compile-time-exhaustive over `SelvaFlags`), branding with defaults, tenancy parsing, and the solve-metrics duck-type pick. Provider implementations are NOT bundled — the registry keeps this package free of dependencies on `@selvajs/local-provider` / `@selvajs/supabase-provider`.
  - **`@selvajs/selva`** — `providers.server.ts` is now the app's composition root only: the bundled-provider registry, service singletons, and Sentry/process-hook error reporting; all wiring logic delegates to the package runtime.
  - The shared `readBool`/`readPositiveInt` env parsers now warn with a `[selva]` prefix (previously `[computeLimits]`), since they serve provider flags too.

### Patch Changes

- Updated dependencies [2673995]
  - @selvajs/schemas@4.7.0-beta.0
  - @selvajs/platform@0.14.3-beta.0
