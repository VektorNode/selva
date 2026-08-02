# @selvajs/solve

## 0.2.0-beta.2

### Minor Changes

- 105275c: `@selvajs/solve/server` gains `SolveEngine`, a facade over the four primitives a consumer previously
  had to hand-assemble (`createClientCache`, `createDefinitionByteCache`, `createSolveCacheSingleFlight`,
  `runSolvePipeline`) plus the coalesce-key/abort/outcome-mapping glue every app route rewrote by hand.

  ```ts
  import { SolveEngine } from '@selvajs/solve/server';

  const engine = new SolveEngine({ limits }); // the 11-field subset of ComputeLimits it needs

  const outcome = await engine.solve({ server, definitionSource, inputs, values, signal });
  return engine.toWebResponse(outcome); // or toResponse() for a framework-agnostic {status,headers,body}
  ```

  `engine.solve()` accepts raw bytes, a string, a `DefinitionRef`, an already-built `ByteCacheRef` (from
  `engine.definitionRef()`, for a caller that needs the bytes before solving — e.g. schema extraction), or
  a `{ versionId, load }` pair that builds and caches the ref internally. `engine.stats()` aggregates
  client-cache, definition-byte-cache, and coalescing counters in one call.

  `@selvajs/solve/client` gains `createComputeFetchSolveFn`, a ready-made `SolveFn` for a
  `/api/compute`-shaped endpoint: 429 cooldown, session-expiry/redirect detection, non-JSON-response
  guarding, and abort handling at every await point, so a new consumer doesn't have to re-derive them.
  Mesh decoding stays a caller-supplied `meshes: { loadRhino, extract }` hook — the package never imports
  a renderer. Debug console telemetry defaults off; pass `debug: true` to enable it.

  `@selvajs/solve`'s TypeScript target moved ES2020 → ES2022 (matching `@selvajs/server`), enabling
  `Error(message, { cause })`.

  ## `@selvajs/selva`

  Migrated to the new facade: `clientCache.server.ts` + `definitionByteCache.server.ts` +
  `solveCache.server.ts` collapse into one `engine.server.ts` constructing a single app-wide
  `SolveEngine`; `/api/compute`'s hand-written coalesce/abort/outcome-mapping block is replaced by
  `engine.solve()` + `engine.toResponse()` (app policy — auth, DB reads, share tokens, rate limiting,
  metric recording — stays in the route, unchanged); the library page's `onSolve` closure is replaced by
  `createComputeFetchSolveFn(...)`. No public behavior change.

## 0.2.0-beta.1

### Patch Changes

- e4f83b2: Bound the scheduler's solve cache by bytes only. `CacheOptions.maxEntries` is
  removed and `maxBytes` is now required, so `cache: true` is no longer valid —
  enabling a cache always states a budget. A budget of `0` disables caching, the
  same as `cache: false`.

  Two bounds meant every caller had to reason about which one would bind first,
  and omitting `maxEntries` silently fell back to a default of 50 that could cap
  the cache far below its byte budget. Responses range from KB to hundreds of MB,
  so memory is the constraint that actually matters.

  Migration: `cache: true` → `cache: { maxBytes: <budget> }`; drop `maxEntries`.

- Updated dependencies [e4f83b2]
  - @selvajs/compute@4.0.0-beta.1

## 0.2.0-beta.0

### Minor Changes

- 8b2c168: The solve session moves out of `@selvajs/visualization` into `@selvajs/solve/client`.

  `@selvajs/visualization` is now **mesh conversion + viewer, and nothing else**. The session was a
  schema-driven form state machine that typed meshes as `unknown` and never inspected one — its
  presence was why the package couldn't be described in a sentence. With it gone the package also
  drops its last Selva dependency (`@selvajs/schemas`), so every sub-path needs only `three`,
  `rhino3dm` and `fflate`.

  **Breaking — `@selvajs/visualization`:**

  - **The `/session` sub-path export is removed.** Import from `@selvajs/solve/client` instead
    (`createSolveSession`, `createRequestResponseDriver`, `SolveDriver`, `SolveReporter`,
    `createSolveMemo`, `stableInputKey`, the external-input storage helpers, the pure
    `solve-session-core` transitions). `SolveFn`/`SolveResult` come from `@selvajs/solve/shared`.
  - The root barrel no longer re-exports any of the above.
  - `@selvajs/ui` re-exports all of it unchanged, so hosts importing from `@selvajs/ui` or
    `@selvajs/ui/public` need no edit.

  **Renamed — `createComputeThrottle` → `createAsyncThrottle`** (`isComputing` → `isRunning`). It is
  generic over `T`, takes any `(values, signal) => Promise<void>`, and mentions neither Rhino.Compute
  nor HTTP nor geometry — plugin-ui drives it over a WebSocket. The old name said "compute" only
  because of where the file happened to live.

  **Mesh ownership is now injected, not assumed.** `SolveResult<TMesh>` is opaque and the result memo
  no longer imports `three`; the clone/dispose rules are a `MeshPolicy` passed in. The three.js
  implementation is `meshPolicy`, newly exported from `@selvajs/visualization/parse`:

  ```ts
  import { meshPolicy } from '@selvajs/visualization/parse';
  const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
  ```

  `ComputeApp` wires this for you. A custom driver must pass it, or a memo hit will serve geometry the
  viewer already disposed. `createSolveMemo(max)` accordingly becomes
  `createSolveMemo({ max, meshPolicy })`.

  **Fixed while extracting it:** the memo's mesh clone copied `geometry.userData` **by reference**, so
  a cloned geometry shared the cross-solve geometry cache's ownership flag. `clearScene` skips flagged
  geometries (the cache disposes those itself), which meant nothing ever freed the memo's clones. The
  clone now copies `userData` before dropping the flag, and `releaseSceneObjects` refuses to dispose
  genuinely cache-owned geometry.

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
