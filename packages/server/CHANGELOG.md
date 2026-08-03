# @selvajs/server

## 1.0.0-beta.2

### Minor Changes

- 3485634: The v1 API gets a definition-addressed solve, a generated OpenAPI contract that a test keeps
  honest, and one shared shape for every handler in the tree.

  ## `POST /api/v1/definitions/{guid}/solve`

  The flagship action, and what the CLI's `solve` command maps to. It shares the whole solve core
  with `POST /api/v1/compute`, which was extracted into `$lib/server/compute/solve.server.ts`.

  The core takes a `SolveAccess` discriminated union (`user` | `share`), and the definition-addressed
  route can only construct `user` — so it cannot inherit the anonymous share-token branch, even if
  someone later edits the core. Share-token resolution stays in `/api/v1/compute`'s handler.

  An unreachable definition returns **404, not 403**. A guid is guessable, so `requireCanSolve`'s 403
  on this path would tell a caller whether a definition they cannot see exists. `/api/v1/compute`
  keeps its 403 — its callers navigated to the definition rather than probing an id.

  ## Idempotency

  The endpoint accepts an optional `Idempotency-Key`. A repeat within the TTL replays the first
  response instead of solving again, and the replay carries `Idempotency-Replayed: true`.

  **The store holds a promise, reserved before the solve starts.** The common case is a client
  retrying while the first solve is still running, so the second request joins the first rather than
  starting a second one. A rejected reservation is dropped, so a failed solve stays retryable instead
  of replaying an error for the whole TTL. The key is namespaced by caller — `Idempotency-Key` is
  client-chosen, so two tenants can pick the same string.

  This absorbs retries; it is not a result cache. The TTL is a fixed 5 minutes, and the store is
  **per-process** — correct for a single-instance deployment, useless the day a second one runs.

  New in `@selvajs/server/compute`: `createIdempotencyStore`, `DEFAULT_IDEMPOTENCY_MAX_KEYS`, and the
  `IdempotencyStore` / `IdempotencyStoreConfig` / `IdempotencyOutcome` types. Bounded and timer-free
  (amortized sweep plus a hard cap, driven by the call path) so the module has no lifecycle its
  callers lack.

  ## The contract is generated and enforced

  `packages/selva/openapi/v1.yaml` describes every v1 endpoint — auth schemes, pagination, the full
  `ApiErrorCode` enum, `x-internal` tags. Regenerate with `pnpm openapi:generate`; `pnpm test` fails
  when the committed file drifts from the code.

  **Request schemas are derived from the actual Zod validators** via `z.toJSONSchema` (Zod 4 emits
  JSON Schema natively, so there is no `zod-openapi` dependency), which meant moving them somewhere a
  generator can import: `$lib/server/api/v1/bodies.ts`. Hand-transcribing them would have reproduced
  exactly the shape drift the spec exists to catch. Response schemas are deliberately **not** derived
  — handlers build payloads from store records with no validator on the way out, so the envelopes are
  described precisely and individual resource bodies left open rather than claiming precision that
  does not exist.

  A conformance test enforces the contract rather than its existence: method+path parity in both
  directions, no bare `error(...)` anywhere in the tree, every collection paginating through the
  shared parser, no documented 403 without a 404 on a guessable-id route, and a platform-permission
  guard on every `/api/admin/**` handler. That last one matters because the `/admin` layout guard
  never ran for endpoints — "all admin routes guard themselves" held only by review until now. The
  assertions were verified by breaking them: a bare `error()`, a removed admin guard, and an
  unregistered route each failed the suite by name.

  `/docs/api` renders the public subset, filtered in the load function rather than the markup so
  internal endpoints never reach the page payload. The spec itself is served at
  `/docs/api/openapi.yaml`. Both are public — an API reference behind a login is hidden from the
  people deciding whether to integrate.

  ## Every handler has the same shape

  The route tree was 2070 lines in which the interesting part sat a few lines deep, and the
  boilerplate had already drifted: path params were validated two ways (18 via `GuidSchema`, 13 via a
  manual `if (!id)`), the `try { … } catch (handleApiError) }` tail appeared 59 times, and five upload
  handlers each formatted their own "Max size: N MB".

  Shared helpers now carry it — `apiRoute`, `requireCaller`, `requireParams`, `parseParam`,
  `parseBody`, `requireUpload`, `formText`, `collection`, `created`, `noContent`, `shaped`. The tree
  is 1825 lines with none of those patterns left.

  Two of those cleanups were correctness fixes:

  **Four list endpoints ignored documented query params.** Share links, versions, invites and project
  members each hand-rolled the pagination clamp, and all four had drifted from `parseListOptions`:
  they hardcoded the default limit, dropped `Math.trunc` (so `limit=5.9` reached the store), and
  silently ignored the `orderBy`/`orderDir` the spec documents them as accepting. They now honour
  both. A conformance assertion rejects an inline clamp on any endpoint the registry calls a
  collection, so a fifth copy cannot be written.

  **Secret stripping is structural rather than conventional.** `ShareLink.tokenHash`,
  `Invite.tokenHash` and `OrgComputeServer.apiKey` were removed by destructuring, which holds until
  someone edits the line away or adds a field to the stored type — neither fails a build, and the
  result is a credential in a response. Those payloads now parse through explicit response schemas, so
  a new field on a stored record is invisible to clients until it is added deliberately.

  `PATCH /api/v1/orgs/{orgId}/compute` was the last handler validating its body by hand; it is now a
  Zod schema, so the spec derives that body too. Its `apiKey` stays `.nullable().optional()` and
  deliberately not `.nullish()` — omitted keeps the stored key, `null` clears it, a string replaces
  it, and collapsing the first two would wipe a live Rhino.Compute credential on any save that left
  the field out.

  `/docs/` joins the public route prefixes in `hooks.server.ts`.

## 1.0.0-beta.1

### Major Changes

- b9c9d6a: One name, one value, for how long a solve may run. The deadline is now sourced
  from the server and carried unchanged to the browser's `AbortController`, rather
  than each layer keeping its own answer under its own name.

  **Fixed — the client could abort a solve the server would have finished.** The
  throttle defaulted to `60_000` while the server's deadline was `100_000`, so any
  host that embedded `<ComputeApp>` without passing a timeout aborted at 60 s a
  solve the server was still happily running. The user saw a failure for work that
  succeeded. `@selvajs/solve` can't read env, so the fix is to require the value
  rather than guess it — there is no client-side default left to drift.

  **Breaking — the per-solve deadline is now required:**

  - `createAsyncThrottle`: `options.timeout` → **`options.runDeadlineMs`**, required,
    and the options bag itself is no longer optional. The name says what elapses;
    the throttle is generic, so its field is named after a run, not a solve.
  - `createRequestResponseDriver`: `options.timeout` → **`options.solveDeadlineMs`**,
    required.
  - `ComputeApp`: `solveTimeoutMs?` → **`solveDeadlineMs`**, required. Pass the value
    the server enforces; omitting it is now a type error rather than a silent 60 s.
  - `ComputeLimits.maxSolveDurationMs` → **`solveDeadlineMs`**.

  **Renamed — `MAX_SOLVE_DURATION_MS` → `COMPUTE_SOLVE_DEADLINE_MS`.** It joins the
  `COMPUTE_*` namespace every other compute knob already uses, and says what it
  bounds — one solve — instead of a vague "duration". The old name still works for
  one minor version and warns at boot, so no deployment breaks on upgrade.

  **`selva migrate` now rewrites deprecated env keys in your `.env`**, so a tuned
  value survives the shim being dropped later instead of silently reverting to a
  default. Only the key changes — value, comments, ordering and spacing are left
  byte-identical, a commented-out old name is ignored, and the old line is dropped
  outright when the new name is already set. `.env.bak` is written alongside the
  existing backups and restored if the migration rolls back.

  `selva doctor` reports the same deprecations without changing anything, covering
  this rename plus the four that were previously silent
  (`COMPUTE_DEFINITION_BYTE_CACHE_MB`, `COMPUTE_RESPONSE_CACHE_MB`,
  `DEFINITION_CACHE_TTL_MS`, `SELVA_FLAG_COMPUTE_DEBUG_VERBOSE`). The last of those
  is reported but not auto-fixed: its replacement encodes a value
  (`SELVA_FLAG_COMPUTE_DEBUG=verbose`), so migrate won't guess at it.

  Migration: run `selva migrate` to rewrite the env var, and pass `solveDeadlineMs`
  wherever you mount `ComputeApp` or build a driver.

## 1.0.0-beta.0

### Major Changes

- 49cac15: The solve core moves out of `@selvajs/server/compute` into `@selvajs/solve/server`, so the whole
  "input change → solve result" chain has one owner on both sides of the wire.

  ## Breaking — `@selvajs/server`

  **1. The solve core moved and is NOT re-exported.** Update the import path:

  ```diff
  -import { runSolvePipeline, createClientCache } from '@selvajs/server/compute';
  +import { runSolvePipeline, createClientCache } from '@selvajs/solve/server';
  ```

  Affected: `runSolvePipeline`, `adaptEnvelopeToEncoding`, `COMPUTE_CONTRACT_VERSION`,
  `COMPUTE_VERSION_HEADER`, `transformInputParameter`, `createClientCache`, `serverIdentity`,
  `createDefinitionByteCache`, `createMemorySolveResultCache`, `deriveSolveCacheInputKey`,
  `encodeSolveCacheEntry`, `decodeSolveCacheEntry`, `gunzipEntryBody`, `createSolveCacheSingleFlight`,
  and their types (`SolveOutcome`, `SolveEnvelope`, `SolvePipelineArgs`, `SolvePipelineCacheHook`,
  `SolvePhaseMetrics`, `PipelineInput`, `CachedClient`, `ByteCacheRef`, `ByteCacheStats`,
  `SolveCacheConfigSubset`, …). Add `@selvajs/solve` as a dependency.

  **2. The root export is gone.** `import … from '@selvajs/server'` no longer resolves; use a subpath:

  ```diff
  -import { resolveComputeLimits } from '@selvajs/server';
  +import { resolveComputeLimits } from '@selvajs/server/compute';
  ```

  The root barrel re-exported all nine subpaths into a single 41-symbol namespace, which hid which
  slice a consumer actually depended on. Nothing in this repo imported it.

  ## What each package owns now

  `@selvajs/server/compute` is **10 exports it owns**: `resolveComputeLimits`,
  `createComputeRateLimiter`, the SSRF guard (`isSafeRemoteDefinitionUrl` /
  `assertSafeRemoteDefinitionUrl`), `createRemoteDefinitionFetcher`, and their helpers/types. That is
  HTTP request policy — admission control and URL safety — which is a different job from running a
  solve. `@selvajs/server` no longer depends on `@selvajs/solve` at all.

  A compatibility shim was considered and rejected: it left `/compute` at 24 exports of which 14 were
  borrowed, so the package's surface no longer described what the package did — the exact problem this
  extraction exists to fix.

  ## `@selvajs/solve` — new `./server` sub-path

  Alongside `./client` and `./shared`, and still deliberately **no root barrel**. Also newly exported:
  `ByteRefOutcome` and `SolveCacheSingleFlightOptions`, which existed but were never public.

  The client/server boundary is enforced three ways: no root barrel, eslint `no-restricted-imports` on
  `src/client/**`, and a bundle test that checks the shipped `dist/client.js` for server modules,
  `process.env` reads and `node:*` imports.

### Patch Changes

- Updated dependencies [53da168]
- Updated dependencies [7751bd0]
  - @selvajs/compute@4.0.0-beta.0

## 0.2.1

### Patch Changes

- Updated dependencies [efb003a]
  - @selvajs/platform@0.16.0

## 0.2.0

### Minor Changes

- aa2abf6: Beta release covering the pre-open-source hardening pass and follow-on work across the app stack:

  - **Audit/erasure**: user-deletion erasure now scrubs `audit_events`, `invites`, and redacts embedded emails from surviving `invite.created` payloads; `solve_metrics` is anonymized rather than cascaded.
  - **Logging**: structured logging via Pino with request-ID correlation, replacing ad hoc console logging across the server.
  - **Caching**: durable L2 solve-result cache with a memory backend, client-side result memoization (LRU), warm-client caching per server, backpressure controls, and definition byte caching; response wire-size tracking feeds caching efficiency metrics.
  - **Definitions**: extracted definitions server slice (`@selvajs/server/definitions`) with schema-version-aware extraction/caching and hardened schema-version parsing/error handling.
  - **Tests**: new e2e core-loop tests against a fake compute server, and per-file test isolation to fix flaky mocks.

- 5077fe9: Adding advanced caching
- 594b5ad: Adding advanced caching
- 2673995: Extract the definitions server slice into `@selvajs/server/definitions` (embeddable-server-layer K4) and implement the ADR 0005 schema-versioning story:

  - **`@selvajs/server/definitions`** — new subpath exporting `DefinitionService` (write orchestration across data + storage), `fetchSchemaFromCompute` / `SchemaExtractionError` (the upload validate-and-cache gate), `assertSupportedSchemaVersion` (rejects schemas authored with a newer plugin than the app supports), and `createDefinitionLoader` (the render loader, all wiring injected via `DefinitionLoaderDeps`). The loader treats a stored schema as a disposable cache: used only when its `schemaVersion` matches the app's `UI_SCHEMA_VERSION`, otherwise re-extracted from compute (which runs the C# migrator) and persisted back best-effort.
  - Fixed a latent bug in schema extraction: shallow `camelcaseKeys` is a no-op on arrays, so the PascalCase `Schemas` wrapper key from compute was never normalized; each wrapper element is now camelcased individually.
  - **`@selvajs/supabase-provider`** — new migration adding a `schema_version` GENERATED column on `definition_versions` (derived from `schema->>'schemaVersion'`, ops/diagnostics only).
  - **`@selvajs/selva`** — `DefinitionService`, `schemaExtraction.server`, and `loadForRender.server` are now thin bindings over `@selvajs/server/definitions`.

- 2673995: Extract the configurable provider wiring into `@selvajs/server/providers` (embeddable-server-layer K5):

  - **`createSelvaProviders(env, options)`** — the reusable core of the app's composition root: env-driven provider selection (`SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`) over a caller-supplied `ProviderRegistry` of `fromEnv`-style factories, the external `selva.config.js` override (pass `configPath`), lazy memoized instantiation (nothing touches provider secrets at import/build time), flags (`SELVA_FLAG_*`, compile-time-exhaustive over `SelvaFlags`), branding with defaults, tenancy parsing, and the solve-metrics duck-type pick. Provider implementations are NOT bundled — the registry keeps this package free of dependencies on `@selvajs/local-provider` / `@selvajs/supabase-provider`.
  - **`@selvajs/selva`** — `providers.server.ts` is now the app's composition root only: the bundled-provider registry, service singletons, and Sentry/process-hook error reporting; all wiring logic delegates to the package runtime.
  - The shared `readBool`/`readPositiveInt` env parsers now warn with a `[selva]` prefix (previously `[computeLimits]`), since they serve provider flags too.

- 8860c4b: Second-wave reusable utilities extracted from the Selva app into `@selvajs/server` (tracker items E1–E6), each as a new subpath:

  - `@selvajs/server/tokens` — `createTokenCodec({ prefix, secret })`, the HMAC capability-token primitive behind share links and invites (mint 32-byte base64url tokens, HMAC-SHA256 hash at rest, constant-time hash compare, prefix recognition). The factory enforces a ≥32-character secret so a short dev secret can't reach production silently; the app's share-link and invite token modules are now thin env bindings over one codec each.
  - `@selvajs/server/errors` — `SentryErrorReporter`, the `IErrorReporter` implementation backed by a dynamically-imported `@sentry/node` (now an optional peer dependency). Literal move from the app.
  - `@selvajs/server/http` — `safeRedirectTarget` (open-redirect guard), `declaredBodySizeExceeds` (transport-agnostic Content-Length guard; the app maps it to its 413), `applySecurityHeaders` (nosniff / Referrer-Policy / Permissions-Policy / opt-in HSTS; CSP and frame headers deliberately omitted for iframe embedding — cache-control stays app policy), and `createRouteClassifier` (deny-by-default route classification: exact public pages, public prefixes, public APIs, one self-gating prefix, static assets — the app supplies its route values).
  - `@selvajs/server/access` — `createProjectAccessInputBuilder(deps)`, the marshalling layer between an app's providers and platform's pure access rules: it owns the "which rows does each project visibility need" knowledge (`platform`→grants, `private`→member, `org`/`public`→member+orgMember with the cross-org-public skip) plus the zero-I/O `projectAccessInputFromRows` for batched listing pages. Row lookups and flag reads are injected as functions.
  - `@selvajs/server/ops` — channel-aware `parseSemver`/`isNewer` (stable ignores pre-release tails; beta orders `-beta.N` and ranks a stable core above its betas) and the `ReleaseChannel` type.
  - `ComputeRateLimiter` gains `peek(key)` and `clear(key)`, making it usable for failure-counting flows; the app's hand-rolled admin login rate limiter is deleted in favor of a limiter instance from this package.

### Patch Changes

- 79b1c7d: Local version bump for @selvajs/server (not yet published to npm).
- Updated dependencies [aa2abf6]
- Updated dependencies [5077fe9]
- Updated dependencies [b0d8bd8]
- Updated dependencies [b8607d4]
- Updated dependencies [243ae19]
- Updated dependencies [21124cb]
- Updated dependencies [2673995]
- Updated dependencies [a8e1b47]
- Updated dependencies [2f787d9]
- Updated dependencies [5b37862]
  - @selvajs/compute@3.1.0
  - @selvajs/platform@0.15.0
  - @selvajs/schemas@4.7.0

## 0.2.0-beta.6

### Minor Changes

- Adding advanced caching

### Patch Changes

- Updated dependencies
  - @selvajs/compute@3.1.0-beta.15
  - @selvajs/platform@0.15.0-beta.4
  - @selvajs/schemas@4.7.0-beta.2

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
