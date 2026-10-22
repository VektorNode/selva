# `@selvajs/compute` cleanup audit

> **Tracked in:** unfiled. Implemented; what's left is [Before release](#before-release).
>
> Five read-only audits of `packages/compute` (core, solve path, IO/data trees/types/stats, docs,
> config and exports) against the tree on 2026-10-21. That tree included the uncommitted
> abort-during-body, list-access-default and probe-auth fixes
> (`.changeset/compute-abort-tree-probe-auth.md`). Line numbers drift: when one stops resolving,
> grep the quoted text.

## Ground rules

- **Behaviour stays identical** except for the defects listed below, each fixed with a test that
  fails before the fix.
- **The public API changes only as listed in [Public API](#public-api)**, all in one major.
  `@selvajs/compute` is published and has two consumers outside this monorepo (Consumer A and
  Consumer B in [compute-package-cleanup](../archive/compute-package-cleanup.md)): check both
  before the release.
- **Comments follow the repo rules:** default to none; one or two lines for a non-obvious why, a
  footgun, or a suppression; never history, ticket or audit pointers; one fact, one place, at the
  narrowest scope. JSDoc on public API stays where it adds information beyond the name. Wire
  formats and tuned thresholds keep full comments.
- **One editor per file set**, so edits don't collide. Shared helpers land first.
- **Proof the API didn't move:** build before and after, and diff `dist/core.d.ts` and
  `dist/grasshopper.d.ts`. Plus `pnpm type-check && pnpm lint && pnpm test` across the monorepo.

## Size

| Area                                  | Source lines now | After (no API change) | Comment lines now | After |
| ------------------------------------- | ---------------- | --------------------- | ----------------- | ----- |
| `src/core/**`                         | 2,473            | ~1,520                | 848               | ~230  |
| Solve path (solve, client, scheduler) | 2,234            | ~1,600                | 834               | ~290  |
| IO, data trees, types, server stats   | 3,847            | ~2,150                | 1,454             | ~395  |
| **Total**                             | **8,554**        | **~5,270**            | **3,136 (37%)**   | ~915  |

Tests: 8,343 non-blank lines, 1,110 comment lines, 79 `issue N` and 7 `audit` references. Source
has another 24 `issue N` references. Nothing in `plans/` or `docs/` defines those numbers.

## Defects

Fix these first. Each changes behaviour on purpose.

**D1 — First upload reported as a server cache hit.** `grasshopper-client.ts:349-352` hard-codes
`missed: false` on the `cacheKey === null` branch, and `solve-scheduler.ts:697` maps `missed` to
`definitionReuploaded`. So every definition's first solve, which uploads the full bytes, reports
`definitionReuploaded: false`. Selva then logs "def-cache HIT — definition reused from server
cache (no upload)" (`packages/solve/src/server/client-cache.ts:334`) and emits
`def_reupload;dur=0` (`solve-pipeline.ts:409-410`). Fix: `missed: true` whenever the upload path
ran. Fix the doc at `scheduler/types.ts:118-125` to match.

**D2 — Server error code read off the prototype.** `core/compute-fetch/response.ts:104-110` does
`serverErrorCodes[serverCode]` on a plain object. A 400 with body `{"code":"constructor"}` gives
`err.code === Object`. Fix: own-property check (`Object.prototype.hasOwnProperty.call`; the lib is
ES2020, so `Object.hasOwn` doesn't type-check).

**D3 — Caller headers override nothing when the case differs.** `core/compute-fetch/request.ts`
`buildAuthHeaders`/`buildHeaders` merge plain objects. Caller headers
`{ 'x-request-id': 'spoof', rhinocomputekey: 'k2', 'content-type': 'text/plain' }` are sent as
`x-request-id: spoof, <id>`, `rhinocomputekey: k2, <key>`, `content-type: text/plain, application/json`.
This contradicts `core/types.ts` (`headers` doc), `request.ts` and `CONTEXT.md`. The test at
`compute-fetch.test.ts:114-134` only uses same-case keys. Fix: drop caller keys whose lowercased
name matches a key the transport sets.

**D4 — Whole definition pinned on an error.** `grasshopper/io/definition-io.ts:44` and `:56` put
`definition` (possibly a multi-MB base64 string or `Uint8Array`) into `ComputeError.context`.
Fix: leave it out, as `client.solve` already does with `describeDefinition`.

**D5 — A flattened tree default is dropped.** `io/input/normalize-default.ts:58-62` marks a
default with no `innerTree` key as `MALFORMED_DEFAULT` and nulls it. That includes an
already-flattened `DataTreeDefault` like `{ '{0}': [1, 2] }`, the exact shape the parsers have
pass-through branches for (`input-type-parsers.ts:79, 218`). `processInput` is public. Through
`packages/solve/src/server/transform-input.ts`, a `number` input with `inputStructure: 'tree'` and
that value gives `default: null`, and `TreeBuilder.fromInputParams` returns `[]`: the value never
reaches the solve. No app code sends this shape today, so it only bites direct `processInput`
callers. Fix:
`if (Array.isArray(input.default) || isDataTreeDefault(input.default)) return { schema: input };`.

**D6 — Step size inferred four different ways.** "Count decimals from `String(x)`" exists at
`input-type-parsers.ts:138-145` and `numeric-rounding.ts:18-22, 30-41, 44-47`. Results:
`0.30000000000000004` → step `0.1`, `3.3000000000000003` → `1e-12`, `1.5e21` → `0.00001`. Fix:
one `decimalsOf(x)` in `numeric-rounding.ts` (exponent notation: exponent plus mantissa
decimals; otherwise decimals of `toFixed(12)` with trailing zeros trimmed; cap 12). Every value in
the current tests keeps its step (1.5→0.1, 0.25→0.01, 1e-7→1e-7, 5→1, 123.456→0.001).

**D7 — `getValue` hands out WASM objects nobody can free.** With `rhino` passed, `getValue`
returns rhino3dm objects with no `dispose` handle, and its doc (`response-processors.ts:316-317`)
points at `disposeRhinoObjects`, which no entry point exports. `getValues`/`getValue` can also
return the `RhinoDecodeError` sentinel, whose guard `isRhinoDecodeError` isn't exported either.
Fix (additive): export `disposeRhinoObjects`, `isRhinoDecodeError` and `RhinoDecodeError` from
`/grasshopper`.

**D8 — Docs that teach broken code.**

- `README.md:90` `cache: { ttlMs: 60_000 }` fails type-check (`maxBytes` is required) and at
  runtime leaves the cache off (`solve-scheduler.ts:236-239`). Use `cache: { maxBytes: 64 * 1024 * 1024 }`.
- `src/grasshopper/README.md:24-25, 67-72`, `examples/simple_example.ts:84-88` call
  `TreeBuilder.replaceTreeValue(...)` and discard the result. It is copy-on-write, so the solve
  uses the defaults. Assign the result. The example also matches on `name`; trees are keyed by
  `nickname`.
- `README.md:55, 59` and `data-tree/README.md:60, 71` pass `'my-definition.gh'`. A string that
  isn't `http(s)://` or long base64 is encoded as the definition text (`solve.ts:294-305`). Use a
  URL or `new Uint8Array(await readFile(...))`.
- `data-tree/README.md:63-70` doesn't compile (`{ ...input, default: 25 }` widens the union).
- `README.md:154` `curl …/healthcheck`: the proxy has no such route; the probe is `GET /`.
- Port 5000 in `src/grasshopper/README.md:14`, `simple_example.ts:20, 29, 36`,
  `validate-server-url.ts:58`; everything else uses the proxy default 6500.
- `src/grasshopper/README.md:92-106` checks `result.errors` after `client.solve`, which throws
  `COMPUTATION_ERROR` when `errors` is present (`grasshopper-client.ts:274-295`). That branch never
  runs. `scheduler.solve` resolves instead.
- `README.md:76-77` filters cancellations by regex on the message; the contract is
  `err.code === ErrorCodes.SUPERSEDED || err.code === ErrorCodes.ABORTED`.
- `simple_example.ts:123` calls `process.exit(1)` inside `catch`, so `finally` never disposes the
  client. Use `process.exitCode = 1`.
- JSDoc examples that don't type-check: `grasshopper-client.ts:107` (`client.solve(url, { x: 1 })`),
  `data-tree.ts:268-273, 357-363` (treat the solve result as `DataTree[]`),
  `definition-io.ts:152` (uses the blocked `compute.rhino3d.com`).

**D9 — Smaller.** `fetchDefinitionIO` sends the API key but only `fetchParsedDefinitionIO` warns
about running in the browser (`definition-io.ts:167`); move the warning down. `response.ts:76-79`
labels 504 "Service unavailable" (should be "Gateway timeout"). `types/inputs.ts:155-157` says
colors are hex strings; they are `"R, G, B"`.

## Config and tooling

No runtime effect. Evidence for each is a `git ls-files` / `rg` miss.

- **devDependencies to delete:** `@eslint/js`, `eslint-config-prettier`, `eslint-plugin-svelte`,
  `globals`, `typescript-eslint` (only `packages/config/eslint.config.js` imports them, resolved
  from the root), `lint-staged` (run from the root), `prettier-plugin-svelte`,
  `prettier-plugin-tailwindcss`, `svelte` (0 `.svelte` files), `typedoc-plugin-extras` (none of
  its options is set), and `eslint`, `prettier`, `vite` (they only satisfy `@selvajs/config`
  peers; mark those peers optional).
- **`rhino3dm` → devDependencies.** Only `import type` uses it (`rhino-decoder.ts:1`); nothing in
  `dist` references it. Consumers stop installing 6.4 MB. A consumer that relied on the
  transitive install must add it.
- **`fflate` → catalog.** Hardcoded `^0.8.2` here and in `packages/visualization/package.json`.
- **Files to delete:** `packages/compute/.gitignore`, `.gitattributes`, `.prettierignore`,
  `prettier.config.js` (byte-identical to the shared one), the `lint-staged` block in
  `package.json`. The root versions cover them. Add `js,mjs` to the root Prettier and lint-staged
  globs so the four `.mjs` files stay covered. Root `.gitignore` lists `packages/compute/docs/api/`
  and `**/dist/` twice each.
- **Scripts to delete:** `bench` (no bench files), `lint:fix` (root passes `--fix`), `format`,
  `format:check`, `test:seams:live` and `tests/contract/server-contract.live.test.ts` (it runs
  `contract:check` with a tautological marker test), `test:stats:live` (skips without
  `COMPUTE_LIVE_URL`), `test:seams`, `build-docs`. `build` becomes plain `tsdown`, without the
  duplicate type-check.
- **`scripts/make-demo-hdr.mjs`** writes `packages/compute/examples/baseHDR.hdr`, which doesn't
  exist; its output matches `packages/visualization/examples/baseHDR.hdr` byte for byte. `git mv`
  it to `packages/visualization/scripts/` (the relative path then resolves).
- **`turbo.json`:** `type-check` inputs miss `tests/**` (compute's tsconfig includes it); `test`
  inputs miss `scripts/**` (`resolve-ref.test.ts` imports one).
- **ESLint:** import `@selvajs/config/eslint` instead of `../config/eslint.config.js`; delete the
  stale `tsup` comment (`eslint.config.mjs:3-8`, same comment in solve and visualization) and the
  `coverage/` ignore.
- **tsconfig:** `outDir` and `exclude` do nothing (`noEmit`, `include` is `src/**`/`tests/**`).
- **typedoc:** drop `./src/index.ts` from `entryPoints` (empty module page), `customFooterHtml`
  (the website overrides it), and the `exclude` globs.
- **Test infrastructure:**
  - `tests/setup.ts:3-6` sets `global.window = {}` for every test; two tests depend on it. Move
    `compute-fetch.test.ts:314-327` to `vi.stubGlobal`, delete `warnings.test.ts:36-43`, delete
    the stub.
  - Unused helpers: `mockFetchSuccess`, `mockFetchError`, `mockFetchNetworkError`
    (`tests/helpers/mock-fetch.ts:39-70`), `createIntegerInputSchema`
    (`test-data-builders.ts:102-119`). `createInputSchema` hides a missing `id` with a cast.
  - `tests/contract/parse-server-contract.ts` re-declares types the `.mjs` already has as
    `@typedef`; replace with a `.d.mts`.
  - Three live suites use three opt-in schemes (`RUN_LIVE_CONTRACT`, `COMPUTE_LIVE_URL`,
    `RUN_LIVE_SCHEMA` + `COMPUTE_URL`, ports 6500 and 6001). One URL/key pair, one script.
  - `schema-endpoint.live.test.ts:37` reads a fixture from `packages/selva/e2e/fixtures/`.
  - `scripts/fetch-server-contract.mjs:11` and `server-contract.live.test.ts:8` claim a scheduled
    CI job; none exists.
- **Lint:** 262 of 263 warnings are `no-explicit-any`; 225 are in tests. A `tree(name): DataTree`
  helper in `solve-scheduler.test.ts` removes 66; dropping needless `(x as any).default` and
  `(tree.InnerTree as any)` casts in `input-audit-fixes`, `data-tree` and
  `process-inputs.characterization` tests removes most of the rest. `logger.ts:32` needs a
  reasoned `eslint-disable-next-line no-console`.
- **`packages/compute/docs/`** on disk is stale, gitignored typedoc output. Safe to delete locally.

## One home per fact

These facts are each stated in several places today. Keep the one in the "home" column; delete or
shorten the rest to a pointer-free sentence.

| Fact                                                              | Told in                                                                                                                                                                                                                       | Home                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Server casing varies (mcneel PascalCase, fork camelCase)          | 13+ places: `read-field.ts`, `core/index.ts`, `definition-io.ts`, `normalize-schema.ts`, `schema-endpoint.ts`, `normalize-default.ts`, `response-processors.ts` (×4), `types/inputs.ts`, `types/schema.ts`, `handle-files.ts` | `read-field.ts` module doc, without the `camelcaseKeys` history |
| Why `algo` is stripped from responses                             | `solve.ts` ×2, `types/schema.ts` ×2, `wire-size.ts`                                                                                                                                                                           | `runSolve`                                                      |
| Definition hashed once per solve                                  | `solve-scheduler.ts` ×3, `stable-hash.ts` ×2                                                                                                                                                                                  | `hashSolveInputForDefinition`                                   |
| Settle-once invariant                                             | `solve-scheduler.ts` ×3, `CONTEXT.md`                                                                                                                                                                                         | `settleError`                                                   |
| Server definition-cache reuse                                     | `CONTEXT.md`, `scheduler/types.ts` ×2, `solve.ts`, `solve-cachekey.test.ts` header                                                                                                                                            | option JSDoc; `CONTEXT.md` keeps two lines                      |
| Retry-After outranks `maxDelayMs`, under a 60 s cap               | `retry.ts`, `compute-fetch.ts` ×2, `types.ts`                                                                                                                                                                                 | `RETRY_AFTER_CAP_MS`                                            |
| A retry can re-run a POST                                         | `compute-fetch.ts` ×2, `types.ts`                                                                                                                                                                                             | `RetryPolicy`                                                   |
| Timeout is per attempt                                            | `compute-fetch.ts`, `types.ts`                                                                                                                                                                                                | `ComputeConfig.timeoutMs`                                       |
| Non-JSON 2xx → `INVALID_RESPONSE`; cut-off JSON → `NETWORK_ERROR` | `errors.ts`, `response.ts`, `compute-fetch.ts` ×2                                                                                                                                                                             | `response.ts`, one line on the enum member                      |
| Server error code outranks the status mapping                     | `types.ts` ×2, `response.ts` ×3                                                                                                                                                                                               | `ComputeConfig.serverErrorCodes`                                |
| Never attach the input tree to an error                           | `grasshopper-client.ts` ×3                                                                                                                                                                                                    | `summarizeDataTree`                                             |
| `DefinitionRef` immutability contract                             | `definition-ref.ts` ×2, `core/README.md`, `solve-scheduler.ts`                                                                                                                                                                | `DefinitionRef.key`                                             |
| Sub Folder / archive convention                                   | `sub-folder.ts`, `handle-files.ts` ×2, `core/files/README.md`                                                                                                                                                                 | `sub-folder.ts` + a README table                                |
| Branch-path predicate                                             | `CONTEXT.md` ×2, `tree-path.ts`, `input-type-parsers.ts`                                                                                                                                                                      | `tree-path.ts`                                                  |
| `loadWarnings` / `loadErrors`                                     | `types/outputs.ts` ×3, `definition-io.ts`                                                                                                                                                                                     | `GrasshopperParsedIORaw` field docs                             |
| Visualization keeps a copy of the base64 decoder                  | `core/index.ts`                                                                                                                                                                                                               | `encoding.ts`, above `decodeBase64ToBinary`                     |

Stale facts to delete outright: `CONTEXT.md:104` "stableStringify's deliberate sampling" (it hashes
the full content now); `CONTEXT.md:117-119` and `handle-files.ts:179-181` "the view is bounded"
(`decodeBase64ToBinary` copies now); `server-timing.ts:8` cites "RFC 9110 §10.1.10" (it is the W3C
Server Timing spec); `solve-scheduler.ts:825` "their finally blocks will reject" (`cancelAll`
settles them itself); `solve-scheduler.ts:102-108` "count bound" (bytes are the only bound);
`solve.ts:126` `@returns … extracted file data` (it returns the response); `types/inputs.ts:25-39`
"see `DataTree.toCompute()`" (it is `TreeBuilder.toComputeFormat()`); `normalize-default.ts:54-57`
"`processInputs` is public" (it isn't exported); `utils/warnings.ts:6-16` "browser/worker" (a worker
has no `window`); `core/types.ts` `authToken` "Bearer token" (sent verbatim, scheme included) and
`onServerTiming` "fires once per request" (only when a recognised metric is present).

## Code: core

Paths under `src/core/`.

**`compute-fetch/compute-fetch.ts`** (382 → ~220)

- `:231-234` the `RETRYABLE_STATUS.has(status) || 429` part never changes the outcome: retryable
  statuses on non-final attempts return before `handleResponse`. Replacing it with `throw` left
  the suite green. Keep only `isTruncatedSuccess`.
- `:18-44` three result interfaces plus three copies of "retry if not final, else fatal". Return
  `{ ok: true; value } | { ok: false; cause; retryable; delayMs? }` and let the loop decide; move
  the catch body into `classifyFetchError(error, ctx)`.
- Seven error-context literals (`:117-121, 138-145, 154-159, 190-196, 235-243, 254, 325, 377`):
  build `ctx.errorContext` once. Two copies of the caller-abort `ComputeError` → one helper.
- The `AbortError`/`TimeoutError` name test appears here and in `response.ts`: `isAbortError()` in
  `signal.ts`.
- `:64-65, :74-77` → `isRetryableStatus(status, policy)` and `retryDelay(header, attempt, policy)`
  in `retry.ts`; unexport `RETRYABLE_STATUS` and `RETRY_AFTER_CAP_MS`.
- `:264-307` 44-line JSDoc → ~8 lines (facts move to their homes above).

**`compute-fetch/response.ts`** (285 → ~180)

- `throwHttpError` and `handleResponse` take 9 positional parameters: pass `(response, ctx, …)`.
  Unexport `throwHttpError` (one caller). `rawBody` is always passed, so `rawBody ?? errorBody` is
  dead.
- `:155` and `:164` `JSON.parse` the same string twice: parse once.
- `mapServerErrorCode` has one caller: inline it with the D2 fix.

**`compute-fetch/log.ts`** — delete. 11 of 12 callers sit inside `if (debug)` and pass `true`; use
`getLogger().debug()` directly.

**`compute-fetch/request.ts`** — D3; unexport `isLocalhost` and `DEFAULT_API_KEY_HEADER` (used
only here).

**`compute-fetch/signal.ts`** — drop the fallbacks for runtimes without
`AbortSignal.timeout` (`:26-29, :42-46`, and `handle-files.ts:226-229`); `engines` is `node >= 24`
and only Safari < 16 lacks it. The fallback tests in `compose-signal.test.ts:13-60` go with them.
That test file's header says the code uses `AbortSignal.any`; it deliberately doesn't.

**`compute-fetch/wire-size.ts`** — header to three lines.

**`utils/encoding.ts`** (202 → ~120)

- `isBase64` has no production caller. Delete it with its test blocks; `solve.test.ts:28, 80`
  switch to a regex assertion.
- `detectBase64Payload` and `decodeBase64ToBinary` duplicate the forgiving-base64 normalization:
  extract `normalizeBase64`. Mirror it in `packages/visualization/src/shared/encoding.ts`.
- Six unused `@internal` tags; "Node 20+ safe" is stale.

**`utils/logger.ts`** (126 → ~45) — the two classes become `const silent: Logger = {…}` and
`enableDebugLogging = () => setLogger(console)`. `packages/visualization/src/shared/logger.ts` is a
copy.

**`utils/read-field.ts`** (72 → ~30) — the WeakMap key cache benchmarked slower than none (216 ms
vs 141 ms warm, Node 24) and returns stale results when a key is replaced without the key count
changing. Replace with a `findOwnKey` that loops `Object.keys`. `:30` points at an explanation
that isn't there.

**`errors.ts`** (112 → ~65)

- `ComputeError.missingValues` / `unknownParamType` carry Grasshopper input semantics into core,
  one caller each: inline at `input-type-parsers.ts:271` and `input-processors.ts:120`.
- `e instanceof Error ? e : new Error(String(e))` appears 8 times across the package: accept
  `originalError: unknown` and normalize in the constructor.
- 10 of 22 `ErrorCodes` members have JSDoc, 12 don't: one line each.

**`types.ts`** — five `// WHY:` line comments on public members don't show in hover or typedoc:
convert to JSDoc. `serverUrl`'s note names `ComputeServerStats` (a Grasshopper concept in core):
move it.

**`files/handle-files.ts`** (363 → ~200)

- Dead: the dedupe inside `createAndDownloadZip` (`:302-311`, its input is already deduped) and
  the `saveFile` document guard (`:342-350`, `downloadFileData` already throws `BROWSER_ONLY`).
  Making each throw if reached left the suite green.
- `sanitizeArchivePath` (`:102-122`) repeats `subFolderSegments`.
- `isBase64Flag` exists here and in `response-processors.ts` with "the two must agree" comments:
  one copy.
- `extractFilesFromComputeResponse` is a one-line wrapper over `processFiles`.

**`files/sub-folder.ts`** — unexport `rootOf` (used only here).

**`server/validate-server-url.ts`** (114 → ~70) — four copies of the `Invalid serverUrl` error:
an `invalid(reason)` helper.

**`definition-ref.ts`** — state the contract once, on `key`.

**Placement (no change proposed):** `core/files/*` (browser download, zip, Selva's Sub Folder
convention) and the 500 partial-success parsing in `response.ts` are not backend-agnostic, though
`core/index.ts` and `CONTEXT.md` say core "names no Rhino concept". Moving `core/files` changes
public paths used by `packages/ui`. `utils/warnings.ts` and the `detectBase64Payload` /
`encodeStringToBase64` / `base64ByteArray` helpers are used only by `/grasshopper` and can move
there freely.

## Code: solve path

Paths under `src/grasshopper/`.

**`solve.ts`** (326 → ~210)

- `solveGrasshopperDefinition`, `solveGrasshopperDefinitionWithCacheKey` and `solveByCacheKey`
  repeat warn + materialize + `runSolve(prepareGrasshopperArgs…)`. Merge the last two into one
  internal `solveWithServerCacheKey(dataTree, cacheKey | null, definition, config)` plus a private
  `uploadAndSolve`; the first becomes a two-liner. Carries the D1 fix.
- Unexport `GRASSHOPPER_SERVER_ERROR_CODES` (used only in this file, not in the barrel).
- The `/^https?:\/\//i` test is repeated in `solve-scheduler.ts:99`: `isDefinitionUrl()` next to
  `SolveDefinition`.

**`index.ts`** — import scheduler types from `./scheduler/types`; delete the four comments that
repeat `CONTEXT.md`.

**`client/grasshopper-client.ts`** (396 → ~285)

- `:9` imports from `'..'`, the barrel that re-exports this file: a circular import. Import
  `../io/definition-io` and `../solve` directly.
- `normalizeComputeConfig` (`:381-395`) is generic over two types where one extends the other,
  called once, and copies three fields onto themselves: inline it.
- Unexport `DataTreeSummaryEntry` (not in the barrel).
- `definition?.trim()` after a `typeof === 'string'` check.

**`client/grasshopper-response-processor.ts`** (126 → ~62) — the "REMOVED:
extractMeshesFromResponse" block (`:82-93`) sits above `private getFileData()`, so typedoc attaches
it to that method: delete. Inline `getFileData` (one caller). The `debug` parameter is dead (see
[Public API](#public-api)).

**`scheduler/solve-scheduler.ts`** (961 → ~750)

- `if (this.settleError(item, err)) this.runHook(this.onSettle, …)` five times: `fail(item, err,
durationMs = 0)`. `indexOf` + `splice` twice: `dequeue(item)`.
- `isAbortLikeError`'s `DOMException` branch can never return true: `return error instanceof Error
&& error.name === 'AbortError'`.
- `cacheEnabled` is checked by caller and callee in two places; `writeLastState`'s return value is
  never read; `const defKey = definitionHash` is an alias; the server-key eviction `while` can only
  run once.
- `:26-34` re-export block, `:84-87` orphaned JSDoc, 74-dash separators.
- `queue` and `parallel` share one `switch` case and one drain loop; only the default
  `maxConcurrent` differs. `types.ts:16-17` says `parallel` means "no scheduling", which is wrong.

**`scheduler/stable-hash.ts`** (168 → ~115)

- `fnv1aCore`'s shift-and-add is the cost, not the closure: `Math.imul(hash, 0x01000193) >>> 0`
  gives identical keys and is 2.8× faster (10 MB: 37.9 ms → 13.4 ms).
- Memoize `hashDefinition` by `Uint8Array` identity (WeakMap). Local definitions in Selva are
  `DefinitionRef` (free); remote-URL definitions are bytes, and the remote fetcher returns the same
  instance within its TTL (`packages/server/src/compute/remote-definition.ts:100-102`), so every
  repeat solve would hit. Document: don't mutate a buffer after solving it.
- `fnv1a`/`fnv1aBytes` are exported only for tests.

## Code: IO, data trees, types, server stats

Paths under `src/grasshopper/`.

**`io/definition-io.ts`** (184 → ~105) — D4, D9. `fetchCompute<IoResponseSchema>` asserts a shape
that is then read field by field with `readField`: use `unknown` and delete `IoResponseSchema`.
Assemble the payload as `algo ? { algo } : { pointer }`.

**`io/normalize-schema.ts`, `io/normalize-ui-schema.ts`, `io/schema-endpoint.ts`** — comments
only. A 53-line JSDoc on an internal helper becomes ~5 lines. The three code paths have different
contracts (deep PascalCase rewrite vs per-field any-case reads vs two wrapper keys); keep all three.
The ILRepack/Newtonsoft root cause stays in `normalize-ui-schema.ts`.

**`io/input/input-processors.ts`** (196 → ~110)

- The `{ inputName, paramType: rawInput.paramType, message, code }` object is built four times: a
  `toParseError` helper. The label is `name || 'unknown'` here and `name ?? 'unknown'` in
  `normalize-default.ts`, which disagree for `''`: compute it once and pass it in.
- Nothing in `src` reads `processInputWithError().error`; return `{ input, errors }` with `errors`
  always present.
- Delete `processInputs`: no `src` caller, not exported.
- `'VALIDATION_ERROR'` and `'MALFORMED_DEFAULT'` string literals → `ErrorCodes.*`.

**`io/input/input-type-parsers.ts`** (398 → ~285)

- D6 (`decimalsOf`).
- `isList ? [x] : x` six times: `listOr(schema, value)`. `serverStep ?? (isInteger ? 1 : 0.1)`
  twice: `defaultStep(schema)`. Two "map a scalar or array of numbers" blocks: `mapNumbers`.
  Three identical finite-and-nonzero checks: one `.find`.
- The registry is fixed: a literal `Map` replaces `ALL_PARSERS` + `types` + `flatMap`.
- The Text, File and Color `fallback`s can't be reached (their `parse` never throws; unknown
  types use the Geometry parser): make `fallback` optional and delete them.
- `:17-29` is a stacked JSDoc TypeScript never attaches; mid-file imports at `:53-61`;
  re-exported transformers at `:63-64`; `roundingTolerance` parameter nobody passes.

**`io/input/normalize-default.ts`** (172 → ~110) — D5. Rename `normalizeDefaultWithWarning` to
`normalizeDefault` (every comment, the README and test titles already say that). Three copies of
"warn and drop the default": a `dropDefault` helper. `NormalizeDefaultWarning` duplicates
`ParserWarning`. The final if/else chain is one expression.

**`io/input/numeric-rounding.ts`** — D6; the `tolerance` parameter is always `1e-8`; `:68-73` is an
orphaned JSDoc describing a function in another file.

**`io/input/transformers.ts`** — rename `setUndefinedOnEmpty` to `dropInvalidScalar` (it controls
rejected scalars, not empty values). This is internal, so not an API rename.

**`io/output/response-processors.ts`** (367 → ~200)

- `decodedJsonCache` (`:100-120`) never hits for the one in-repo consumer
  (`packages/solve/src/client/compute-fetch-solve-fn.ts` reads each output once via
  `getValue({ byId })`). It costs a WeakMap write per item and makes parsed objects shared across
  reads, which is why two docs warn about mutation. Delete it and both warnings; repeated reads
  of one response then return fresh objects. Note that in the major's changeset.
- `EXCLUDED_TYPES` is a one-entry array; the same item filter is written twice.

**`io/output/rhino-decoder.ts`** (260 → ~140) — `decodeRhinoObject`, `decodeDeepArray`,
`DecodeRhinoOptions` (`:192-260`) have no `src` caller and aren't reachable from any entry point:
delete with their ~110 test lines. The decoder registry has two fixed entries: a literal map.
D7.

**`data-tree/data-tree.ts`** (605 → ~330, ~240 with API removals) — over 200 comment lines are
`@param`/`@returns` blocks restating signatures. `input.nickname || 'unnamed'` repeated;
`isNumericInput` guard is redundant (the `paramType` check already narrows). The dual-mode and dead
methods are in [Public API](#public-api).

**`types/*`** — `GrasshopperComputeConfig` re-declares all six `GrasshopperBaseSchema` fields:
`extends ComputeConfig, GrasshopperBaseSchema`. `GrasshopperParsedIO` → `extends
Omit<GrasshopperParsedIORaw, 'inputs'>`. Delete `IoResponseSchema` and the unused re-exports of
`GrasshopperBaseSchema` / `GrasshopperDefinitionSource` from `types/index.ts`.

**`server/compute-server-stats.ts`** (722 → ~470)

- Seven copies of ensure-not-disposed / fetch / warn-on-non-OK / text / parse / warn-on-catch
  (`:179-198, 213-237, 264-283, 343-364, 443-457, 473-484, 567-587`): one `getText(path, init,
timeoutMs)` plus `tryParseJson`. Keep `getVersion`'s non-JSON fallback, JSON `null` → null, and
  `json?.purged`. Only log text changes; no test asserts on it.
- The header-merge code in `fetchWithTimeout` serves an `init.headers` no caller passes; its own
  test says so. Delete it and its test block.
- `activeTimeouts` duplicates what each monitor's `currentTimeoutId` already holds.
- Literal `5000` three times where `DEFAULT_TIMEOUT_MS` exists. `ensureNotDisposed`'s context is
  always `{ disposed: true }`.

## Tests

- Strip all `issue N` and `audit` references, keep the reasons:
  `rg -n -i "issue\s+#?\d+|\baudit" packages/compute/src packages/compute/tests`.
- Rename `io/input/__tests__/input-audit-fixes.test.ts` by subject (its name and every `describe`
  narrate history).
- `process-inputs.characterization.test.ts:4-9` pins behaviour for an "upcoming" refactor that has
  shipped and points at a `CONTEXT.md` section that doesn't exist.
- `data-tree.test.ts:11, 53` say they mirror README examples that this cleanup deletes.
- Rename `grasshopper-client.e2e.test.ts` → `*.integration.test.ts` ("e2e" means Playwright
  elsewhere in the repo).

## Docs

| File                                  | Lines | Action                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                           | 204   | Keep, ~130. Apply D8; add short "Errors" (`client.solve` throws on definition errors, `scheduler.solve` resolves), "Data trees" (copy-on-write) and "File outputs" (Sub Folder table) sections.                                                                                                     |
| `CONTEXT.md`                          | 179   | ~50. Keep the vocabulary and the three core seams. Delete Mesh batch (visualization's, wrong today), every Invariant (each has its code home), Display-pipeline performance (visualization's, stale paths and numbers), Known follow-ups (plugin backlog; two items shipped, one has its own plan). |
| `src/core/README.md`                  | 74    | Delete. Wrong directory tree, an unverifiable example endpoint, and copies of `CONTEXT.md`.                                                                                                                                                                                                         |
| `src/core/files/README.md`            | 31    | Merge the corrected table into `README.md`. A single-segment Sub Folder is a root: `Panels` → `model.3dm` inside `Panels.zip`, not `Panels/model.3dm`.                                                                                                                                              |
| `src/grasshopper/README.md`           | 131   | Delete. Its one useful fact (the error contract) moves to `README.md`.                                                                                                                                                                                                                              |
| `src/grasshopper/data-tree/README.md` | 78    | Delete. Its two gotchas move to `README.md`.                                                                                                                                                                                                                                                        |
| `src/grasshopper/io/input/README.md`  | 164   | Move to `docs/contributing/compute-contributing.md` § "Adding an input param type", ~50 lines, plus the missing step "export the new type from `grasshopper/index.ts`". `STRUCTURE.md` puts package developer notes in `docs/contributing/`.                                                        |
| `examples/simple_example.ts`          | 138   | Keep. Apply D8, load the `.gh` with `readFile`, and add `examples/` to type-check and lint.                                                                                                                                                                                                         |

README details beyond D8: delete the TypeScript-version badge (nothing enforces it), the
duplicated "behind your own queue" paragraph (`:29-31`), the "every solve goes through a
scheduler" claim (`client.solve` doesn't), "they share the connection pool" (there is none), the
third-party proxy timeout numbers, and "code adapted from McNeel is marked" (nothing is).

## Public API

Additive and breaking changes ship together in one major.

### Additive

- **`scheduler.solveDetailed()`** resolving `{ response, fromCache, definitionReuploaded,
durationMs }`, with `solve()` as `solveDetailed().then(r => r.response)`, plus a per-call
  `onServerTiming`. Today `packages/solve` recovers the per-solve verdict through a shared
  `onSettle` hook and a sequence counter (`solve-pipeline.ts:162-170, 253-260`,
  `client-cache.ts:47-64`). It drops the data whenever solves overlap, which happens in production
  because `maxConcurrent` follows the server's child count. `packages/solve` switches to it in the
  same change and drops `solveMeta` / `rhinoTiming` and their sequence counters. The per-call
  `onServerTiming` fires only for the call that reached the server, never on a `fromCache` hit.
- **`TreeBuilder.fromValues(entries)`**: coerce UI values to data trees without `/io` parsing.
  `transform-input.ts` builds a fake IO schema to push values through `processInput`, then patches
  two cases where it drops the default. The root cause is that `valueListParser.parse` throws with
  no `values` map, which `SchemaInput` never carries. The patch also re-ships values compute
  rejected (`['abc']` for a number reaches the tree as `"abc"`). Shape:
  `fromValues(entries: { paramName, paramType, value, minimum?, maximum? }[]): DataTree[]`.
  `paramType` matches case-insensitively. A value is a scalar, an array (branch `{0}`) or a
  branch-path map. Number/Integer items go through the numeric transformer (Integer rounds) and
  are clamped; Boolean items through the boolean transformer; every other type, including
  ValueList, File, Color and generic, passes through. An item a transformer rejects is dropped
  with a warning; an entry left with no items, or with a `null`/`undefined`/empty value, is
  omitted, so Grasshopper uses its own value. `transform-input.ts` is replaced by it in the same
  change, which fixes `generic` inputs too.
- **A probe option for `GrasshopperClient.create()`** separate from `config.retry`. Today
  `retry: { attempts: 0 }`, set to stop solve retries, also cuts `create()` to one probe. Shape:
  `create(config, { probe?: { attempts?, baseDelayMs?, maxDelayMs? } })`, defaults 2 / 250 / 1000;
  `config.retry` no longer affects the probe.
- **Missing exports:** `ColorInputType` (member of the exported `InputParam` union),
  `InputParseError` (in `GrasshopperParsedIO.parseErrors`), plus D7's `disposeRhinoObjects`,
  `isRhinoDecodeError`, `RhinoDecodeError`, and the `ServerVersion` / `ServerStats` interfaces.
- **`ComputeError` accepts `originalError: unknown`** and normalizes it in the constructor, so the
  eight `e instanceof Error ? e : new Error(String(e))` call sites go.
- **`TreeBuilder.getTree(trees, paramName)`** returning `Map<path, DataTreeValue[]>`, the whole
  Grasshopper tree with branch paths (`'{0;1}'` → items), from a solve result. Keys are the
  `DataTreePath` strings Grasshopper uses. A missing param gives `null`; a param with no branches
  an empty `Map`. `ParamName` and `InnerTree` are read in any casing.

### Breaking

- `GrasshopperResponseProcessor`'s `debug` parameter: never read. One in-repo caller passes
  `false` (`packages/solve/src/client/compute-fetch-solve-fn.ts:183`).
- `SolveScheduler` takes one executor (`(definition, tree, cacheKey | null, config)`) instead of
  `SolveExecutor` + `CacheKeyExecutor`. No workspace package constructs it.
- Fold `'parallel'` into `'queue'`: `SchedulerMode` loses `'parallel'`, and passing it at runtime
  throws `INVALID_CONFIG` naming `{ mode: 'queue', maxConcurrent: 4 }`.
- `TreeBuilder.replaceTreeValue` / `getTreeValue` lose the `TreeBuilder[]` mode. The two modes
  disagree: builders flatten every branch, `DataTree[]` reads only the first; an empty
  `TreeBuilder[]` returns `DataTree`s typed as builders; `DataTree[]` matches only PascalCase
  `ParamName`. No consumer outside compute.
- `getTreeValue` becomes the single-branch convenience over `getTree`: it returns the branch's
  value (unwrapped when it holds one item) and throws when the param has more than one branch,
  naming `getTree`. A missing param or an empty tree gives `null`. Today it silently returns only
  the first branch.
- Remove `TreeBuilder.appendSingle`, `getInnerTree`, `fromInputParam` (no caller anywhere), and
  `getPaths` / `getPath` (tests and README only).
- Remove `ComputeError.missingValues` / `unknownParamType` (public statics carrying Grasshopper
  input semantics into core); inline them at their one caller each in `/io/input`.
- Delete `decodedJsonCache`: repeated `getValue` reads of one response return fresh objects.
- `rhino3dm` → devDependencies: a consumer that relied on the transitive install must add it.
- Remove from `/core`: `getResponseWireSize`, `setResponseWireSize` (internal side channel; the
  setter lets a consumer corrupt the scheduler's byte budget).
- Remove from `/grasshopper`: `OutputType` (unused even inside the package),
  `GrasshopperRequestSchema` (in no public signature), and the duplicates of `/core` exports
  (`extractFilesFromComputeResponse`, `downloadFileData`, `ProcessedFile`, `FileData`,
  `FileBaseInfo`, `isDefinitionRef`, `DefinitionRef`, `SolveDefinition`; switch
  `packages/solve/src/server/solve-engine.ts` to `/core` first).
- Remove the empty root `"."` export, `main`/`module`/`types` and `src/index.ts`, so
  `import '@selvajs/compute'` fails loudly. `packages/solve` already ships no root entry.

### Keep

- Latest-wins mode, `subscribe`, `lastResult` / `lastError` / `lastDurationMs`, `onStart` /
  `onSuperseded`, `isSolving` and friends (~170 lines). Unused in this repo
  (`client-cache.ts` uses queue mode only), but documented in the README and plausibly used by
  browser consumers.
- `stableStringify`, `hashDefinition`, `hashSolveInput`, and the low-level solve path
  (`solveGrasshopperDefinition`, `fetchDefinitionIO`, `fetchParsedDefinitionIO`): the previous
  cleanup decided these stay public.
- Every type that appears in a public signature.

## Outside compute

- **`CLAUDE.md`** compute section: the root entry exports nothing (it says "utilities and types");
  errors are one `ComputeError` class with a typed `code` (it says "discriminated unions"); the
  solve session lives in `@selvajs/solve/client` (it says visualization). The "pnpm lint, NOT via
  turbo" note is stale too: root `lint` is `turbo run lint`. In the visualization section,
  replace "The solve session used to be a fifth layer here; it now lives in…" with a plain
  statement of where it lives.
- **`packages/solve/src/server/transform-input.ts`**: `generic` inputs become `Geometry` with a
  null default and never reach a solve. Its comment at `:31-35` says arrays are rejected as
  malformed, which stopped being true.
- **`docs/contributing/testing.md:27-28`** says compute has a bench script; it doesn't.
- **`docs/contributing/turborepo.md:19-20`**: same stale lint claim as `CLAUDE.md`.
- **`docs/contributing/compute-contributing.md`**: `:3-14` repeats `publishing.md`; `:24` claims
  both barrels use section headers (`core/index.ts` doesn't).
- **`docs/adr/0003-large-file-output-streaming.md:150-167`** names removed APIs
  (`extractMeshesFromResponse`, `getValueByParamId`); `0004…:157` has a version literal.
- **`packages/ui/src/lib/utils/file-download.ts:27-30`** hand-rolls the base64 decode
  `decodeBase64ToBinary` already provides.
- **`packages/website/src/lib/architecture.ts:524`** and
  **`routes/architecture/SolveWalkthrough.svelte:40`** write the cache key as `md5:…`; Rhino.Compute
  returns `md5_…` (see `solve-cachekey.test.ts`).

## Before release

Both downstream apps were checked against the breaking list on 2026-10-22. Each change below is
in the app, not here.

**The main downstream app** imports only `/core` and `/grasshopper`, and solves through
`SolveEngine`.

- `new GrasshopperResponseProcessor(solved, false)` and `processor.debug` (passed on to
  `getThreeObjectsFromComputeResponse`): drop the argument and pass `debug: false` or nothing.
- `extractFilesFromComputeResponse` and `type FileData` move from `/grasshopper` to `/core`.
- It pins `@selvajs/compute` exactly and overrides every engine package's copy to match, so
  `@selvajs/solve`, `server`, `ui` and `visualization` ship together with the major.
- Its solves change through `buildSolveInputTree`: see the `@selvajs/solve` changeset. Run its
  solve e2e suite against the release.
- Not hit: `GrasshopperClient.create` (no `retry`, so the probe is unchanged), `ComputeServerStats`,
  `fetchCompute`, `ComputeError`/`ErrorCodes`, and `rhino3dm`, which it depends on directly.

**Consumer B** pins `^4.1.3` in both packages, so it stays on 4.x until it bumps. On bumping:

- `new GrasshopperResponseProcessor(solved, false)` in the compute page and the autosolve
  emulator test fails type-check: drop the argument.
- Preset load calls `TreeBuilder.getTreeValue` on trees it saved with `replaceTreeValue`. A preset
  that stored a tree-access input as a branch map with more than one branch now throws instead of
  silently loading the first branch: read those with `getTree`.
- Not hit: it builds input trees through its own `processInput` path, not `fromValues`;
  `createScheduler({ mode: 'queue' })`, `GrasshopperClient.create` without `retry`,
  `normalizeUISchemaCasing`, and `rhino3dm`, which it depends on directly.

**Consumer A** (exact pin on `3.1.0`, root imports) has no checkout on this machine; check it
wherever it lives, or confirm it is the main downstream app at an earlier stage.
