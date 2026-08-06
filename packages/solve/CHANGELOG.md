# @selvajs/solve

## 1.0.0-beta.9

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

## 1.0.0-beta.8

### Patch Changes

- Updated dependencies [0e2c428]
  - @selvajs/platform@0.16.1-beta.1
  - @selvajs/schemas@5.0.0-beta.1
  - @selvajs/compute@4.0.0-beta.4

## 1.0.0-beta.7

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

## 1.0.0-beta.6

### Major Changes

- 9f60b66: **`ComputeFetchSolveFnOptions.meshes.loadRhino` is gone**, along with the `TRhino` type parameter
  and the `rhino` field on the `extract` callback's options.

  ```diff
   const onSolve = createComputeFetchSolveFn({
   	endpoint: '/api/v1/compute',
   	meshes: {
  -		loadRhino: () => import('rhino3dm').then((m) => m.default()),
  -		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
  +		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
   	}
   });
  ```

  Curves arrive pre-tessellated from the plugin (see `@selvajs/visualization`), so nothing in a
  viewer decodes Rhino geometry anymore. This option was worse than unnecessary: it loaded the WASM
  **unconditionally whenever `meshes` was configured** — on every viewer solve, not just those
  carrying curves — so removing it is a straight win for first paint and bundle size.

  There is no replacement and no fallback. A definition whose Display component predates backend
  tessellation now fails the solve with an actionable error — upgrade the component in Grasshopper
  (Solution → Upgrade obsolete components) and re-save.

### Patch Changes

- Updated dependencies [9f60b66]
- Updated dependencies [9f60b66]
  - @selvajs/compute@4.0.0-beta.2

## 1.0.0-beta.5

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

### Minor Changes

- b9c9d6a: Make the reported `SolveResult` reachable from a `ComputeApp` host, so a commit path can pair the
  artifact it persists with the inputs that produced it.

  `source` and `values` travel correctly through the request/response driver's memo, but stopped at the
  session: `applySolveResult` merged `outputs` and discarded the rest, and `ComputeApp`'s only outbound
  seam was `onReady({ loadValues })`. So a host wanting the pair had to capture it inside its own
  `SolveFn` — which a memo hit never calls. Solve A, solve B, scrub back to A: the memo serves A, the
  viewer shows A, and the host commits B's geometry.

  `SolveSession` now exposes `lastResult: RetainedSolveResult | null` — the last reported result minus
  its meshes — and `ComputeApp` hands out `getLastResult()` alongside `loadValues`. Because the session
  fills it in `report()`, a memo hit populates it exactly like a fresh solve.

  Meshes are dropped from the retained slice rather than kept: they are GPU-backed and the viewer
  disposes what it renders on the next scene update, so retaining them would hand out disposed
  instances with no policy governing them. Live meshes stay on `session.meshes`. `rebuild()` nulls
  `lastResult` for the same reason it clears the driver memo; `reportError` deliberately leaves it, as
  the viewer still shows the geometry that produced it.

  `values` remains driver-supplied and absent on push transports (the plugin's WebSocket driver cannot
  attribute an unsolicited frame to a request) — documented on `SolveDriver` and `SolveResult`.

## 0.2.0-beta.4

### Minor Changes

- 64c954e: `SolveResult` now carries the payload it was built from and the inputs that produced it, so a
  consumer with a commit/persist step can hold onto the exact artifact it showed the user.

  ```ts
  const driver = createRequestResponseDriver(onSolve, () => session);
  // on report:
  result.source; // the raw GrasshopperComputeResponse, verbatim
  result.values; // the input set that produced it
  ```

  Both are optional and default to `unknown`/absent, so nothing existing changes shape.
  `createComputeFetchSolveFn` populates `source` and narrows its return to
  `SolveFn<TMesh, GrasshopperComputeResponse>`; `SolveFn`/`SolveResult` gained a matching `TSource`
  parameter so that narrowing survives an explicit return-type annotation.

  **Fixes a stale-result bug in the pattern this replaces.** Capturing the raw response inside your own
  `SolveFn` is silently wrong behind `createRequestResponseDriver`: a memo hit serves the cached result
  without ever calling the `SolveFn`. Solve A, solve B, scrub back to A — the viewer shows A while the
  captured response is still B's, and a commit path freezes that mismatch. The driver stamps `values`
  onto the result before storing it, so both fields travel through the memo with the result they belong
  to.

## 0.2.0-beta.3

### Patch Changes

- b5221ad: `SolveEngine.solve()` now removes the abort listener it attaches to the caller's signal once the
  solve settles. `{ once: true }` only bounds how often a listener fires, not how long it stays
  attached, so every completed solve left one behind on a signal that outlives the call. A request
  signal fires `abort` after the response is consumed, and a session-scoped `AbortController` never
  settles at all — on that second shape the listeners accumulated without bound and Node warned at 11.

  Also simplified the mesh-extraction branch in `createComputeFetchSolveFn`, which checked the
  `meshes` option twice and re-tested a value `getRhino()` already guards.

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
