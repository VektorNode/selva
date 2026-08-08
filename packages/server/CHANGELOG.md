# @selvajs/server

## 1.0.0-beta.9

### Minor Changes

- 39db6f5: The supported Node floor moves from 22 to 24.

  Node 24 ("Krypton") is the active LTS; Node 22 leaves maintenance in April 2027. Every package's
  `engines.node` is now `>=24.0.0`, and CI builds and tests on 24 instead of 22.

  **This is visible to operators before it is visible to anyone else.** `@selvajs/cli` derives its
  floor from its own `engines.node` rather than a literal, so `selva doctor` and the create-time
  guard follow the bump automatically: a deployment running Node 22 that passed `doctor` yesterday is
  reported as out of range today. Nothing about the deployment changed — the floor moved under it.
  Upgrade the host's runtime before taking this version of the CLI.

  The admin UI's update check reports the same thing from the other direction: it compares the
  running Node against the `engines.node` of the release it fetched from npm, so it starts flagging a
  Node 22 host as soon as a `>=24` version is published, with no client-side change at all.

  No source change was needed. The Node builtins in use are long-stable (`fs`, `path`, `crypto`,
  `url`, `os`, `net`, `zlib`), there are no experimental APIs or `--experimental` flags in the tree,
  and every dependency's own engine range already admitted 24.

### Patch Changes

- Updated dependencies [39db6f5]
  - @selvajs/compute@4.0.0-beta.6
  - @selvajs/platform@0.17.0-beta.3
  - @selvajs/schemas@5.0.0-beta.3

## 1.0.0-beta.8

### Patch Changes

- a011c5e: Unify the vitest setup across the workspace behind `@selvajs/config/vitest`.

  Packaging fix: `@selvajs/compute`, `@selvajs/solve`, `@selvajs/visualization`
  and `@selvajs/schemas` had no test-file exclusion in `files`, so a change of
  build tool would have shipped tests to npm. All publishable packages now carry
  the same exclusion.

  `@selvajs/platform`'s test suite was never wired to a runner and had never
  executed; it now runs with the rest.

- Updated dependencies [0629321]
- Updated dependencies [a011c5e]
  - @selvajs/schemas@5.0.0-beta.2
  - @selvajs/platform@0.16.1-beta.2
  - @selvajs/compute@4.0.0-beta.5

## 1.0.0-beta.7

### Patch Changes

- 0e2c428: Clean up published tarballs. The monorepo-internal `source` export condition is renamed to `selva-source` so it can never collide with a consumer resolving the common `source` condition; published packages no longer ship raw `src/` TypeScript or compiled test files. Publish-time manifest rewriting is gone — the committed package.json is what ships, gated by `publint --strict` and a tarball contents check.
- Updated dependencies [0e2c428]
  - @selvajs/platform@0.16.1-beta.1
  - @selvajs/schemas@5.0.0-beta.1
  - @selvajs/compute@4.0.0-beta.4

## 1.0.0-beta.6

### Patch Changes

- 28944ae: Fixed two bugs:

  - `POST /api/v1/compute/schema` reimplemented compute's fetch/error-mapping logic instead of
    reusing it. Extracted the shared part into `postSchemaFormData` (new export of
    `@selvajs/server/definitions`), used by both the single-file `fetchSchemaFromCompute` and the
    multi-file schema-preview route.
  - The admin health check's compute-reachability probe hit `/healthcheck`, a route the
    rhino.compute proxy doesn't have, so it always reported the default server as unreachable. It
    now reuses `ComputeServerStats.isServerOnline()` from `@selvajs/compute`, which probes the
    correct liveness root (`GET /`).

## 1.0.0-beta.5

### Major Changes

- 5292563: **Public vocabulary stops promising Rhino.** Coordinated pre-1.0 major — no deprecation shims, no
  aliases left behind. Every reference across the workspace was updated in the same commit.

  ```diff
  -import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
  +import { fetchCompute, ComputeError } from '@selvajs/compute/core';
  ```

  ```diff
  -import type { GrasshopperParamType, GrasshopperInputStructure } from '@selvajs/schemas';
  +import type { ParamType, InputStructure } from '@selvajs/schemas';
  ```

  Both renamed schema types were already backend-agnostic in value (`ParamType` is
  `number|integer|boolean|text|valueList|dynamicValueList|file|color|generic`; `InputStructure` is
  just arity — `item|list|tree`). Only the names were Rhino-flavored. The rename does not touch wire
  data: `paramType` still serializes as its lowercase string value, never the type name. Regenerated
  via `pnpm generate` — the C# plugin types regenerate too (`Plugin/Selva.Schema/Models/UISchema.Generated.cs`),
  so this needs a plugin rebuild.

  **`@selvajs/compute`'s root barrel is gone** — subpaths only, matching `@selvajs/solve` (no root
  export) and `@selvajs/visualization` (root deliberately empty):

  ```diff
  -import { GrasshopperClient } from '@selvajs/compute';
  +import { GrasshopperClient } from '@selvajs/compute/grasshopper';
  ```

  **Env var renamed:** `MAX_GH_FILE_SIZE_BYTES` → `MAX_DEFINITION_FILE_SIZE_BYTES`. No dual-read —
  operators update `.env` on upgrade. Everything else in `.env.example` was already neutral
  (`COMPUTE_*`).

  Also reworded the Rhino-flavored doc strings in `ui-schema.json` that described backend-agnostic
  fields (e.g. a parameter identifier documented as "Grasshopper instance GUID" when the field
  itself is just a bare string, backend-specific by convention rather than by type).

### Patch Changes

- Updated dependencies [5292563]
  - @selvajs/compute@4.0.0-beta.3
  - @selvajs/schemas@5.0.0-beta.0
  - @selvajs/platform@0.16.1-beta.0

## 1.0.0-beta.4

### Minor Changes

- 9f60b66: **Every deprecated symbol in `@selvajs/compute` is gone.** Nothing is left as a stub — this is a
  coordinated pre-1.0 major, so there is nothing to ease.

  **`camelcaseKeys` and `toCamelCase` are removed from `@selvajs/compute/core`.** They were
  deprecated in favour of `readField`, which now takes their export slot alongside `hasField`:

  ```diff
  -import { camelcaseKeys } from '@selvajs/compute/core';
  -const { schemas } = camelcaseKeys(entry) as { schemas?: UISchema[] };
  +import { readField } from '@selvajs/compute/core';
  +const schemas = readField<UISchema[]>(entry, 'schemas');
  ```

  Blanket key-rewriting was the wrong tool for wire payloads: it corrupted user-authored keys
  (value-list labels, `Display3d` → `display3d`) while the actual problem — server branches
  disagreeing on casing for a handful of known fields — is what `readField` solves per-field.

  **If you were unwrapping compute's schema endpoint with it, you had the bug described below.**
  Use the new `readSchemaResults` instead of hand-rolling the unwrap:

  ```diff
  -const results = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as { schemas?: UISchema[] }[];
  +import { readSchemaResults } from '@selvajs/compute/grasshopper';
  +const results = readSchemaResults<UISchema>(raw);
  ```

  **`ComputeConfig.suppressClientSideWarning` is removed.** Use `suppressBrowserWarning`, which it
  has been an alias for.

  **New: `readSchemaResults` on `@selvajs/compute/grasshopper`** — the one correct way to unwrap
  `/grasshopper/schema`'s `[{ FileName, Schemas }]` body.

  It exists because everyone who hand-rolled that unwrap got it wrong the same way. The wrapper's
  casing varies by server branch (mcneel `FileName`/`Schemas`, our fork `fileName`/`schemas`), so a
  fixed-key read yields `undefined` against half of them — and the endpoint answers 200 either way,
  so the failure surfaces as "this definition has no schemas". Reaching for `camelcaseKeys` looked
  like the fix but passed the response **array** to a shallow key-rewriter, which returns arrays
  untouched: same `undefined`, now with a comment claiming it was handled.

  That was live in this repo: every upload through `/api/v1/compute/schema` 422'd with "No schemas
  found in definition". Fixed here, and `@selvajs/server/definitions` re-exports the helper typed to
  `UISchema` so the app layer keeps its concrete type.

  `readSchemaResults<TSchema>(raw)` returns `SchemaEndpointResult<TSchema>[]` — `{ schemas?, error? }`
  per file. `TSchema` is pass-through; the helper reads only the two wrapper keys and never looks
  inside a schema, so `@selvajs/compute` still doesn't depend on `@selvajs/schemas`. Pass your own
  schema type, or omit it for `unknown`.

  Also removed the unused legacy test builders (`createMockGrasshopperInput` and friends,
  `createMockThreeGeometry`) from the package's test helpers.

### Patch Changes

- Updated dependencies [9f60b66]
- Updated dependencies [9f60b66]
  - @selvajs/compute@4.0.0-beta.2

## 1.0.0-beta.3

### Patch Changes

- 2cc44d3: Fix the library app page solving against a route that no longer exists.

  The `/api/v1` restructure moved `POST /api/compute` to `POST /api/v1/compute`, but
  `routes/library/[guid]/+page.svelte` still pointed at the old path. Every solve on a
  published definition failed with a 404 whose body was SvelteKit's HTML error page, so the
  client reported `non-JSON error body (HTTP 404)` rather than a usable message.

  The path escaped the rename because it is passed as an `endpoint` string to
  `createComputeFetchSolveFn` instead of appearing as a literal `fetch('/api/...')` call —
  worth knowing before the next route move, since a grep for fetch sites will miss it again.

  The definition-upload assertion in the `core-loop` E2E had the same stale path
  (`/api/definitions`). It waited on a response that could never arrive, so a broken upload
  would surface as a timeout instead of a failed assertion.

  Comment-only corrections to paths the restructure invalidated: the three limit fields in
  `@selvajs/server`'s `compute/limits.ts` (`/api/compute` → `/api/v1/compute`), the
  `orgDefaults` pointer in `/api/admin/compute` (`/api/org/compute` →
  `/api/v1/orgs/[orgId]/compute`), and the PATCH reference in the team-members page.

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
