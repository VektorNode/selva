# `@selvajs/compute` review: source and tests

> **Tracked in:** unfiled. Review of `packages/compute`. Findings already fixed are removed from
> this document; `git diff packages/compute` shows them.
>
> A second pass after [compute-cleanup-audit](./compute-cleanup-audit.md). It looks for
> duplication, logic that does not earn its place, config drift, and tests that do not exercise a
> real case. Line numbers drift: when one stops resolving, grep the quoted text.

## Ground rules

- `@selvajs/compute` is published and has consumers outside this monorepo. Removing a public
  export is a major bump, so [Public API candidates](#public-api-candidates) are listed apart
  from the fixes that leave the API alone.
- **A test earns its place** only if it exercises a case a caller or the Rhino Compute server can
  actually hit, and its assertion fails when that behaviour breaks. A test does not earn it if it:
  - restates the implementation line by line,
  - mocks away the thing under test,
  - asserts a constant or a shape the compiler already enforces,
  - repeats another test's case with cosmetic input changes,
  - reaches an internal helper through an input no caller can produce,
  - pins accidental behaviour ("characterization"), or
  - is named after an issue or audit number instead of a behaviour.

## Source: duplication

- **Server URL validated repeatedly per solve.** `validateServerUrl` runs in the
  `GrasshopperClient` constructor, the `ComputeServerStats` constructor, `fetchDefinitionIO`,
  `runSolve` and `fetchCompute`. `runSolve` and `fetchDefinitionIO` discard the result. The call
  in `fetchCompute` passes `blockedHosts: []`, so it differs from the others. Validate once at the
  client boundary.
- **`hasOwnProperty.call` written three times:** `read-field.ts`, `response.ts`,
  `response-processors.ts`. One shared helper. The lib is ES2020, so `Object.hasOwn` does not
  type-check.
- **File decoding in `handle-files.ts`.**
  - `subFolder !== '' ? `${subFolder}/${name}` : name` appears in `decodeResponseFiles` and
    `fetchRemoteFiles`.
  - The two `processedFiles.push({...})` branches differ only in `content`.
  - The `...(metadata ? { metadata } : {})` spread repeats.
- **Input parsers (`input-type-parsers.ts`).**
  - `numericParser.parse` and `.fallback` build the same field list.
  - `geometryParser` and `fileParser` make the identical `coerceDefault(..., objectTransformer(...), true)` call.
  - The `schema.nickname || 'unnamed'` label is rebuilt in five places.
- **Error table in `response.ts`.** `errorMap` is rebuilt on every error. Statuses 401, 403 and the
  fallback share one message template. A module-level `Record<number, { code, label }>` with one
  template is shorter.
- **Definition hash memoized in three layers.** `u8DefinitionHashes` (WeakMap),
  `lastStringDefinition`, and the `SolveInputHashes` class. The WeakMap keeps the old hash if the
  caller mutates the buffer. Keep one layer unless a benchmark needs more.
- **`ComputeError` stores the cause twice** (`originalError` and `cause`). `handle-files.ts` also
  copies `err.message` into `context.originalError` beside `originalError`.

## Source: logic that does not earn its place

- **`utf8ByteLength` in `encoding.ts`.** A hand-rolled surrogate-pair counter that only feeds size
  accounting. `new TextEncoder().encode(str).length` does the same.
- **Base64 decoding in `encoding.ts`.** Two validation layers (`normalizeBase64`, `stripBase64`)
  and two decoders with Node-specific leniency checks. `normalizeBase64` is used only by
  `detectBase64Payload`.
- **Debug logging in `response.ts`.** Three separate `debug` blocks, emoji log lines, and a `debug`
  flag threaded through `fireServerTiming`. One helper that checks the flag collapses them.
- **`createAndDownloadZip` in `handle-files.ts`.** It special-cases a root entry named `__proto__`.
  A `Map` or `Object.create(null)` for the zip entries removes the special case.
- **Comments against the repo rules.**
  - `@public` and `@internal` tags are scattered through the source.
  - `grasshopper-client.ts` carries two long narrative docblocks.
  - Most section banners in `grasshopper/index.ts` only restate the export names.
- **Loose `any`.** `response-processors.ts` has `[key: string]: any`, `rhino?: any` and
  `getValue(): any`. `rhino` can be `RhinoModule` through a type-only import.
- **Mixed imports.** `grasshopper/*` imports the `@/core` barrel in several files and deep paths
  in others, sometimes in the same file (`solve.ts`). Pick deep paths.

## Public API candidates

Exported or public, with no consumer in this monorepo outside tests and generated docs. Each needs
an external-consumer check. The 5.0 major is still in beta, so they can go in it rather than
waiting for the next major.

- `TreeBuilder`: `getParamName`, `flatten`, `appendFlat`, `replaceTreeValue`, `getTreeValue`
- `GrasshopperClient.getConfig`
- `SolveScheduler.getMaxConcurrent`
- `ComputeServerStats`: `launchChildren`, `launchChild`, `recycleChildren`, `getServerTime`
- `processInput`, a one-line wrapper over `processInputWithError`
- `DEFAULT_BLOCKED_HOST`

## Package, scripts and config

Every line of `package.json`, the scripts, and the config files read against what it does.
`publint --strict` passes and the packed tarball holds only `dist`, `README.md`, `LICENSE` and
`package.json`. `are-the-types-wrong` was not run (not installed, no network): run
`pnpm dlx @arethetypeswrong/cli --pack .` once, since the dual ESM/CJS `exports` map is exactly
what it checks.

### `package.json`

- **`publishConfig.provenance: false`** is the only package in the monorepo that sets it, and the
  history records no reason. `release.yml` publishes through npm trusted publishing (OIDC), which
  attaches provenance on a public repo. Remove the line unless there is a reason, and if there is,
  say why in the release workflow, not here.
- **`typedoc` and `typedoc-plugin-missing-exports`** pin versions directly; the repo rule is
  `catalog:` in `pnpm-workspace.yaml`. Both must stay devDependencies of `compute`, since the
  website runs `pnpm --filter @selvajs/compute exec typedoc`. The plugin exists only because types
  such as `GrasshopperBaseSchema` and `GrasshopperDefinitionSource` are reachable from the public
  API but not exported. Exporting them drops the plugin.
- **`keywords`** carries `rhino3dm` (not a dependency), and generic terms that attract no search
  (`design`, `cloud`, `automation`, `3d`, `cad`, `gh`, `geometry-processing`). Keep `rhino`,
  `rhino-compute` (`rhino.compute` is not a tag people type), `grasshopper`, `compute`,
  `parametric`, `typescript`.
- **`fast-check`** is a devDependency for one file, the fuzz test proposed for deletion. It goes
  with it.
- **`prepack: publint --strict`** relies on `publint` declared only in the root `package.json`. It
  works through the workspace bin path; the dependency is implicit. Acceptable, but the root
  `release` script already runs `verify-pack`, so the two checks overlap on export-target
  resolution. Keep `prepack` as the cheap per-package guard.
- **`test:live`** (`vitest run live.test`) is a name filter and works. The contract scripts follow
  the contract decision below.
- **`exports`** has no `./package.json` entry (some tooling reads it) and no `typesVersions`, so a
  consumer on `moduleResolution: node10` cannot resolve the subpath types. Both are acceptable for
  a Node 24 package; the second is a deliberate floor and worth one line in the README.
- **`engines.node >= 24`** also sets tsdown's default build target (verify in `dist`). A browser
  consumer then receives Node-24-level syntax. If the browser baseline matters, set `target`
  explicitly in `tsdown.config.ts`.
- **`sideEffects: false`** is correct: the module-level state (logger, warn-once sets, wire-size
  `WeakMap`) mutates at call time, not import time.

### `tsdown.config.ts`

- `entries` is a one-use constant; inline it.
- **`platform`** defaults to `node`. The library runs in browsers too and avoids static `node:`
  imports on purpose (`process.getBuiltinModule`, `globalThis.Buffer`). `platform: 'neutral'`
  would make an accidental static Node import fail the build instead of being silently externalized.
  Verify the output is unchanged before adopting.
- **`minify: true` with `sourcemap: true`.** The maps embed `sourcesContent`, so debugging works,
  but about 1 MB of maps ships in the tarball to support minified output. A library normally
  ships readable output and lets the consumer's bundler minify. Dropping `minify` also roughly
  halves the maps. Recommended unless bundle size of the untouched dist matters to a direct
  `<script type="module">` user.
- **`fixedExtension: false`** and **`clean: true`** read as defaults or near-defaults. Confirm
  against the tsdown version in use and drop the keys that match the default. If `fixedExtension`
  is load-bearing (it keeps `.js` for ESM under `type: module`), a one-line comment says why.

### `tsconfig.json` (and the shared base)

- **`lib: DOM` plus `types: ["node"]` for the whole program.** `src/` is isomorphic, so Node-only
  APIs (`Buffer`, `process`) type-check everywhere, and the code defends with
  `globalThis as { Buffer? }` casts. A `tsconfig.json` for `src/` with `types: []` and a test/script
  config with `types: ["node"]` makes the type checker enforce the guard instead.
- **`target`/`lib: ES2020`** (from the base) forces workarounds the code already documents: no
  `Object.hasOwn`, and `ComputeError` assigns `cause` through a cast. Overriding to `ES2022` in this
  package removes both, and matches Node 24 and every supported browser.
- **No `verbatimModuleSyntax`.** `handle-files.ts` and `grasshopper-client.ts` import types without
  `import type`. The flag turns that into a compile error and keeps type-only imports out of the
  emitted code.
- The `@tests/*` alias is used by 17 test files and is declared twice (`tsconfig.json`,
  `vitest.config.ts`). Keep it; it is the one place to change if the helpers move.
- `include` of `tests/` and `examples/` is correct: `type-check` must cover them.

### `vitest.config.ts` and `tests/setup.ts`

- `__dirname` via `fileURLToPath(import.meta.url)`: Node 24 has `import.meta.dirname`.
- `setup.ts` stashes native `fetch` on `globalThis.__nativeFetch` through an `any` cast so the live
  tests can restore it. `vi.stubGlobal('fetch', vi.fn())` in setup and `vi.unstubAllGlobals()` in the
  live tests does the same without the stash, the cast, or a lint warning.
- `afterEach(() => vi.clearAllMocks())` is `test.clearMocks: true` in the config.
- The shared base's `resolve.conditions: ['selva-source']` does nothing here (no workspace source
  imports). Harmless; it is the base's rule, not this package's.

### `eslint.config.mjs`

- Spreads the shared `config`, which loads Svelte and shadcn rules for a pure-TypeScript package.
  Cost is small; the clean form is a library preset in `@selvajs/config`.
- `ignores: ['docs/api/']` is needed: typedoc output contains JavaScript. Keep.
- All warnings are `no-explicit-any`. Warnings that never reach zero are ignored. Either fix them
  (most are `rhino?: any` and `getValue(): any`) or accept the rule with suppressions that carry a
  reason, as the repo's code style requires.
- The type-aware pass (`createConfig(..., { typed: true })`) is off. It pays for the scheduler and
  `compute-fetch`, where a dropped promise is a real bug (`execute()` is deliberately not awaited
  and would need an explicit `void`). Scope it with `typedFiles` to those two folders.

### In the monorepo

- **No `selva-source` export condition, so every consumer reads `dist`.** `schemas`, `notifications`
  and `server` expose their TypeScript through `selva-source`, and the shared vitest and vite
  configs resolve it, so `docs/contributing/testing.md` can promise "no upstream rebuild". `compute`,
  `solve` and `visualization` do not: `ui`, `selva`, `solve` and `server` tests and dev servers see
  compute only after a build (turbo's `^build` covers CI; a dev server or `vitest` watch can run
  against stale output). For `compute` the likely blocker is its `@/` alias: 21 source files import
  through it, and a consumer's resolver would not map it. The packages that do expose source use
  relative imports throughout. Converting `src/` to relative imports would unlock the condition and
  drop the alias from `tsconfig.json` and `vitest.config.ts`; the `@tests/*` alias stays for tests.
  Worth deciding together with `exports`, since the condition is a new `exports` entry per subpath.
- **`@types/node` is `^26` in the catalog while the runtime is Node 24** (`.nvmrc`, every
  `engines.node`). The catalog's own comment says to track the runtime. `compute` compiles against
  types for APIs Node 24 does not have. Pin the catalog to `^24`.
- **`tsdown.config.ts` is copied across `compute`, `solve` and `visualization`.** Every option
  (`format`, `dts`, `minify`, `sourcemap`, `clean`, `fixedExtension`) is identical; only `entry` and
  `external` differ. The `minify` and `platform` decisions above apply to all three. A
  `createTsdownConfig({ entry, external })` in `@selvajs/config`, next to the existing vitest and
  eslint presets, keeps those choices in one place.
- **Dependency ranges are consistent:** published consumers use `workspace:^` (`solve`, `server`,
  `ui` peer), apps and dev-only edges use `workspace:*`. No change.
- **Release path covers compute with no per-package wiring.** `verify-pack.mjs` and
  `publishable-packages.mjs` iterate the workspace, and `verify-pack` already rejects test files in a
  tarball, so the removed `files` negations were redundant twice over. `compute` is outside `fixed`
  and `linked` in `.changeset/config.json`, so it versions on its own.
- **Turbo inputs are correct for `compute`.** `lint`, `test` and `build` list `compute`'s own
  config files, and the shared `packages/config` files reach the task hash through the
  `@selvajs/config` workspace dependency, so a shared-rule edit does invalidate the cache.

### `typedoc.json`

Entry points, `readme` and plugin are read by the website's generated `typedoc.site.json`; `name`,
`includeVersion` and `hideGenerator` apply to both. No change.

### `scripts/fetch-server-contract.mjs`

Part of the contract decision. If it stays: `resolveRef`, `SERVER_REPO` and `DEFAULT_SERVER_REF` are
exported only so a test can import them, which is why the file needs its `invokedDirectly` guard.
Move `resolveRef` next to the parser and the guard disappears. About 40% of the file is comment,
much of it narrating rather than constraining.

### Other

- `fflate` is a runtime dependency used only through a dynamic `import('fflate')` in the browser
  download path, so every `/core` consumer installs it. Kept: the dynamic import code-splits, and
  the alternative (an optional peer) makes `downloadFileData` fail at call time.
- `typedoc.json`, `README.md` and `package.json` are inputs to the website build in `turbo.json`;
  `tsdown.config.ts` is an input of `build`. No stale input found.

## Tests

Three reviewers each read a share of the suite. **Confidence differs by file.** The core and
scheduler reports read the source each test covers. The IO and data-tree report judged some files
from test names and line counts alone; those rows are marked _unverified_. Check them against the
source before deleting.

### Cross-file overlap

Each of these is one behaviour tested in several places. Keep the version at the right level and
drop the rest.

| Behaviour                                        | Where it repeats                                                                                                                                       | Keep                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| 500 with `values` passes through                 | `compute-fetch`, `error-surface`                                                                                                                       | `compute-fetch`                                |
| 500 error body message surfaces                  | `compute-fetch`, `error-surface`                                                                                                                       | one                                            |
| `serverUrl` shape validation                     | `redirects-and-limits`, `validate-server-url`                                                                                                          | `validate-server-url`, plus one wiring check   |
| Root grouping                                    | `sub-folder`, `download-by-root`                                                                                                                       | `download-by-root`, edge cases in `sub-folder` |
| Base64 strictness                                | three places in `encoding`                                                                                                                             | the fuzz pair and the `atob` same-error test   |
| Server-definition-cache key learn, miss, refresh | `scheduler-cachekey`, `hash-memo`, `definition-ref`, `solve-cachekey`                                                                                  | `scheduler-cachekey` and `solve-cachekey`      |
| `definitionReuploaded`                           | `scheduler-cachekey`, `solveDetailed`, client integration                                                                                              | the last two                                   |
| Cache hit and miss                               | three tests in `solve-scheduler`                                                                                                                       | one                                            |
| Binary hash collision                            | four tests in `stable-hash`                                                                                                                            | one                                            |
| Abort and cancel                                 | four near-copies plus `dispose`                                                                                                                        | one per path                                   |
| "Null on failure"                                | one per endpoint in `compute-server-stats`, all through `getText`                                                                                      | one table                                      |
| Casing                                           | `normalize-default.casing`, `param-type-casing`, `definition-io.casing`, `normalize-schema`, `normalize-ui-schema`, `data-tree`, `response-processors` | one per distinct normalizer                    |
| Happy-path parse                                 | `process-inputs.characterization`, `process-input`, the three parser files                                                                             | `process-input` and the parser files           |

### Delete whole files

- `src/grasshopper/__tests__/types.test.ts`. Its header says the assertions are type-level and
  enforced by `type-check`; the runtime cases read back constants they just assigned. If the pins
  matter, move them to a `.test-d.ts` with a typecheck project. Check `vitest.config` first for
  typecheck mode.
- `src/grasshopper/io/input/__tests__/input-parsing.fuzz.test.ts` _(unverified beyond this file)_.
  Its main property is "does not throw". Turn the step-size and `decimalsOf` invariants into
  table cases in `numeric-parser`. This also removes the `fast-check` devDependency and the
  `FUZZ_RUNS` hook.
- `src/grasshopper/io/input/__tests__/param-type-casing.test.ts`. Keep two cases (unknown
  `paramType` still reported; lowercase `valueList`, which Selva emits) and move them into
  `process-input.test.ts`.
- Most of `src/grasshopper/io/input/__tests__/process-inputs.characterization.test.ts`. Its happy
  paths are covered by `process-input` and the parser tests. Move out the four that carry weight:
  `minimum`/`maximum`/`atLeast`/`atMost` pass-through, `acceptedFormats` pass-through, batch order
  preserved, invalid boolean string recovers.
- `tests/contract/resolve-ref.test.ts`. Argument parsing for a script flag.

### Contract machinery: a decision, not a trim

`tests/contract/*`, `scripts/fetch-server-contract.mjs` and the `contract:snapshot` /
`contract:check` scripts guard the client's key list against a frozen snapshot of the server
source. No workflow runs `contract:check`. The offline tests (`server-contract`,
`parse-server-contract`, `resolve-ref`) run in CI with the rest of `vitest`; the two
`*.live.test.ts` files are gated on `COMPUTE_LIVE_URL`. The parser (`parse-server-contract.mjs`, its `.d.mts` and its
test) exists only to build the snapshot.

Either run `contract:check` on a schedule, or delete the parser, script, snapshot, `.d.mts` and
the offline tests together. If it stays:

- Drop `was generated from the Compute8 branch` (asserts a constant), `contains every class the
client depends on` (a presence check on the file) and the camelCase style check.
- Keep the fork-specific IO field tests (`groupName`, `values`, `id`) and the seam tests only if
  their key list comes from real client code rather than a copied list.
- Keep `schema-endpoint.live > reports the raw wire casing`; it is the only test of real server
  casing.

### Per file: core

| File                                  | Verdict          | Drop or merge                                                                                                                                                                                                                                                                                                                                                                                                                                | Keep                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compute-fetch.test.ts`               | trim             | the PascalCase partial-success case (make the camelCase test an `it.each` over both); the 418 case; a duplicate of the Compute8 500 message case; the "no warning with an auth token" negative; the case-variant header test if it is one more key in the header-precedence loop                                                                                                                                                             | retry block (Retry-After over `maxDelayMs`, the 60 s cap, HTTP-date), truncated 200 retried vs declared non-JSON 200 not retried, abort and timeout block including timeout while the body streams, per-attempt timeout re-arm, 500 partial-success, API-key header precedence |
| `error-surface.test.ts`               | trim             | the 500-with-values copy; the 504 label test; merge the two Compute8 message tests                                                                                                                                                                                                                                                                                                                                                           | raw bounded `responseBody`, the `Object.prototype` server-code case, declared code outranks status                                                                                                                                                                             |
| `redirects-and-limits.test.ts`        | keep, small trim | `asks fetch not to follow redirects` (asserts `redirect: 'manual'` was passed); `leaves host blocking to the backend` (tests an absent feature); URL-shape re-tests                                                                                                                                                                                                                                                                          | streaming cancel at the limit, declared-oversize refusal, UTF-8 byte counting, limit on a 500, no body stream, huge error page, `maxResponseBytes` validation                                                                                                                  |
| `server-timing.test.ts`               | trim             | merge the subset, unknown-metric, non-numeric-dur and malformed-recomputed cases into one table; merge the two `returns null` cases; drop whitespace/casing tolerance unless a proxy emits it                                                                                                                                                                                                                                                | fork `gh` time and `recomputed`, result-cache hit, 500 partial-success, throwing callback, same `requestId` as `X-Request-ID`                                                                                                                                                  |
| `compose-signal.test.ts`              | keep             | merge the two trivial no-signal cases                                                                                                                                                                                                                                                                                                                                                                                                        | listener-leak and cleanup tests                                                                                                                                                                                                                                                |
| `encoding.test.ts`                    | trim             | the round-trip and browser-fallback pair (one Buffer-vs-fallback comparison); the chunk-boundary fallback round-trip; `impossible length` and `misplaced padding`; three of the four pool-aliasing tests; `documents the residual ambiguity`; fold the `utf8ByteLength` duplicate list into a loop over both paths. The `ENCODING_ERROR` test has a `try/catch` with no `expect.assertions`, so it passes silently if nothing throws: fix it | mutating a result does not corrupt a sibling decode; the fuzz pair; the `atob` same-error test; forgiving-base64; newline-wrapped canonical form; non-canonical rejection                                                                                                      |
| `read-field.test.ts`                  | trim             | three tests of a key cache that does not exist (`sees keys added after the first read`, `sees a key replaced...`, `serves repeated cased reads...`); merge the `hasField` cases                                                                                                                                                                                                                                                              | inherited-key refusal, own key shadowing a prototype name, exact-case preference, present-but-null                                                                                                                                                                             |
| `sha256.test.ts`                      | trim             | `keeps lone surrogates distinct` and `gives the portable result on Node` (both restate delegation)                                                                                                                                                                                                                                                                                                                                           | FIPS vectors, block-boundary check against `node:crypto`, UTF-16LE chunking                                                                                                                                                                                                    |
| `warnings.test.ts`                    | trim             | merge the two once-per-function tests; the missing-`navigator` test; the `resetClientSideWarnings` test (`beforeEach` exercises it)                                                                                                                                                                                                                                                                                                          | both jsdom cases                                                                                                                                                                                                                                                               |
| `classify-probe-failure.test.ts`      | trim             | non-auth 4xx; merge `no detail at all` into the unrecognized-failure test                                                                                                                                                                                                                                                                                                                                                                    | 401/403, 5xx retryable, refused, `EAI_AGAIN`, status over error                                                                                                                                                                                                                |
| `validate-server-url.test.ts`         | trim             | merge accept, strip-slash and trim into one `it.each`; merge query and fragment; drop the message-wording test; merge the three blocked-host list tests                                                                                                                                                                                                                                                                                      | public endpoint in casing and trailing-dot variants, embedded credentials, IPv6 literals, linear-time ReDoS                                                                                                                                                                    |
| `handle-files.test.ts`                | trim             | merge the three traversal tests into an `it.each`; `keeps legitimate nested subFolders`; merge the two `::` tests; `carries subFolder on base64 items too`; merge the string `"true"`/`"false"` flag tests; fold the empty-subFolder and no-metadata cases into the happy path                                                                                                                                                               | network-error drop, undecodable base64 skip, colliding paths, `__proto__`, absolute and drive-letter paths                                                                                                                                                                     |
| `download-by-root.test.ts`            | keep, small trim | merge the two extras tests                                                                                                                                                                                                                                                                                                                                                                                                                   | one archive per root, unsafe root name, `saveBlob`                                                                                                                                                                                                                             |
| `sub-folder.test.ts`                  | trim             | merge the separator cases into one table; `treats a single-segment subFolder as a root`; `accepts slashes as separators`; `returns nothing for no files`                                                                                                                                                                                                                                                                                     | whitespace and rootless edge cases                                                                                                                                                                                                                                             |
| `tests/helpers/mock-fetch.ts`         | check            | `arrayBuffer` returns an empty buffer for any body; make it use the real bytes or drop it after a grep                                                                                                                                                                                                                                                                                                                                       |                                                                                                                                                                                                                                                                                |
| `tests/helpers/test-data-builders.ts` | check            | the three typed builders are each used by one file; inline them                                                                                                                                                                                                                                                                                                                                                                              | `createInputSchema`                                                                                                                                                                                                                                                            |

### Per file: scheduler, client, solve, server stats

| File                                     | Verdict             | Drop or merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Keep                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solve-scheduler.test.ts`                | trim, about a third | latest-wins: the pending-supersede test with a vacuous first assertion, the standalone `SUPERSEDED` code test (add `.code` to the abort test), merge the abort-window test into the 10-race test. Queue: merge `respects maxConcurrent` into the serial test. Backpressure: trim the unbounded-default test. Cancellation: `cancelAll rejects pending and aborts in-flight` (asserts only `instanceOf`), `per-call signal aborts in-flight with ABORTED`, merge the two already-aborted-signal tests. Cache: merge the three TTL tests; merge LRU eviction with the eviction counter; `retains entries far past any count cap`; the stringify-fallback test at `maxBytes: 10`; keep one cold-miss-then-hit test. Observability: `notifies subscribers` (`>= 2` calls, no check on what changed); merge `lastResult` with the hooks test. Also: the removed-`parallel`-mode message pin, `solve() resolves with the bare response`, and the duplicate half of `dispose` | the 10-race test; the hook-count contract for a superseded solve; `lastError` shows the original supersede cause; aborting a queued solve; aborting the pending latest-wins item; late rejection does not clobber newer state; `cancelAll` `durationMs`; cache hit supersedes an older in-flight solve; oversized response never retained; counters survive `clearCache`; errored and plugin-aborted solves not cached; per-call `onServerTiming` (all three); `QUEUE_FULL` and `QUEUE_TIMEOUT` |
| `solve-scheduler-cachekey.test.ts`       | trim                | merge the URL and `reuseServerDefinitionCache: false` cases into an `it.each`; `reports definitionReuploaded from the executor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | learn then reuse, refresh after a miss, per-definition keys                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `solve-scheduler-definition-ref.test.ts` | trim                | merge the pointer-map test into cachekey as an `it.each` over string and ref; the `Uint8Array` round-trip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | same `ref.key` across distinct objects never calls `load()`; abort while `load()` is pending                                                                                                                                                                                                                                                                                                                                                                                                    |
| `solve-scheduler-hash-memo.test.ts`      | trim                | spy-on-internals cases: the server-cache fast path, URL hashes nothing, one or both of the hash-once cases, the `\|t:[0-9a-f]{64}` half of the no-tree-hash test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | tree mutation after solve keys the hook correctly; remembered hash still keys the result cache                                                                                                                                                                                                                                                                                                                                                                                                  |
| `solve-scheduler-queue.test.ts`          | keep                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | all three (churn with aborts, freed `maxQueueDepth` slots, 50k-deep input)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `stable-hash.test.ts`                    | trim                | merge the four "differs in the middle byte" tests; `distinguishes different values`; `handles circular references`; merge the SHA-256 shape check into the pinned keys; the FNV-1a-named collision test becomes one generic assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `[undefined]` vs `[]`, sparse arrays, shared references, `toJSON`/`Date`, `Map`/`Set` order, `bigint` vs string, marker spoofing, pinned keys                                                                                                                                                                                                                                                                                                                                                   |
| `grasshopper-response-processor.test.ts` | trim to two         | the three value-access tests (they only prove forwarding); `exposes the bound response`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | file extraction forwarded to `downloadFileData`, plus the additional-files case                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `grasshopper-client.integration.test.ts` | trim slightly       | the partial-success test that `preserves partial-success values` already covers; merge the offline 503 and ladder-exhaustion tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | refused connection stops retrying, rejected key stops retrying, authenticated probe, flaky probe retried, probe ladder kept, empty definition, both `createScheduler` tests, `getIO`                                                                                                                                                                                                                                                                                                            |
| `solve-cachekey.test.ts`                 | keep                | `returns the response without the pointer field`; `pointer hit never calls load()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | both fallback variants (message-signalled and code-signalled miss), no fallback on an unrelated error, wire-size re-registration, `load()` failure wrapping                                                                                                                                                                                                                                                                                                                                     |
| `empty-inner-trees.test.ts`              | trim to three       | merge the "all" and partial-ratio cases; `does not warn when every output has data`; the empty-`values` guard; `<unnamed>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | debug off does nothing; case-insensitive read                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `solve.test.ts`                          | trim                | `should preserve data tree values`; merge the plain-string encode into the short-base64 test; the two `applyOptionalComputeSettings` tests unless forwarding is a rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | URL as pointer, real base64 passthrough, wrapped and unpadded normalization, blocked public endpoint, `maxResponseBytes` excludes the echoed definition                                                                                                                                                                                                                                                                                                                                         |
| `compute-server-stats.test.ts`           | trim, nearly half   | per-endpoint copies of "null on non-2xx" and "null on network reject" (one `it.each` through `getText`); URL and header echo tests; trivial parse-and-return tests for `getIdleSpan` and `getServerTime`; `launchChildren`, `shutdownChildren`, `recycleChildren` shape echoes; the duplicate redirect test; merge the two dispose-race tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `probeServer` 401, redirect and opaque redirect; garbage-prefixed `/activechildren` body; `purgeAllChildren` (`confident`, zero children, mid-loop failure); `monitor` interval validation; oversized body; probe body released; `ComputeConfig` auth merge; `launchChild` `?port=`                                                                                                                                                                                                             |

### Per file: IO, data trees (_unverified_ unless noted)

| File                                                    | Verdict          | Drop or merge                                                                                                                                                                                                                                                                                                                                                                                | Keep                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `data-tree.test.ts`                                     | trim lightly     | merge flat-build with `appendFlat`; one of the two camelCase read tests; merge the empty-string and whitespace-string tests into the non-canonical-strings test; one of each null-item pair; the case-insensitive `paramType` duplicates; the per-type coercion cases except one `it.each` proving `fromValues` wires them in; `ignores null bounds`; `slider scrub end-to-end` unless short | null items keep their index, non-canonical numeric strings stay strings, camelCase `paramName` replaced not appended, negative-index branches, malformed path error, unparseable default key, multi-branch `INVALID_INPUT`, dropped rejected Number item, far-past-stack-limit branch                                                            |
| `definition-io.casing.test.ts`                          | trim             | the camelCase twin; merge the typed-parse case into the PascalCase case; `surfaces the camelCase fields the parser reads`                                                                                                                                                                                                                                                                    | value-list keys verbatim; PascalCase top-level `Inputs`/`Outputs`                                                                                                                                                                                                                                                                                |
| `definition-io.diagnostics.test.ts`                     | trim             | object and blank diagnostics unless the server really sends them; the parsed-wrapper copies of the two diagnostics tests; exotic malformed-input rows                                                                                                                                                                                                                                        | load errors and warnings surfaced, clean load omits the fields, definition bytes kept out of an invalid-response error, browser API-key warning, no `inputs` array                                                                                                                                                                               |
| `normalize-schema.test.ts`                              | trim             | `fills required fields with honest defaults` and the output twin (restate constants); `groupName` null vs empty; the PascalCase read                                                                                                                                                                                                                                                         | non-numeric `stepSize` dropped; missing `paramType` becomes a per-input parse error                                                                                                                                                                                                                                                              |
| `normalize-ui-schema.test.ts`                           | keep, minor trim | the already-camelCase pass-through (fold into idempotence); the non-object input case; top-level keys and arrays (subsumed by the full-nesting test)                                                                                                                                                                                                                                         | user labels untouched, `defaultOptions`/`values` untouched, `optionMedia`/`assets` keys kept and entries recased, dynamic value-list seeds, `__proto__`, leading acronym                                                                                                                                                                         |
| `schema-endpoint.test.ts`                               | keep             | merge `reports missing keys as undefined`                                                                                                                                                                                                                                                                                                                                                    | per-file error on a 200                                                                                                                                                                                                                                                                                                                          |
| `boolean-parser`, `numeric-parser`, `text-parser` tests | trim             | `numeric-parser` "real-world scenarios"; merge the decimal-string case; `text-parser` Unicode case; merge the empty-quoted case into quote removal                                                                                                                                                                                                                                           | boolean file as is; escaped backslashes (Windows paths)                                                                                                                                                                                                                                                                                          |
| `normalize-default.casing.test.ts`                      | trim             | lowercase `innerTree` (speculative); the `GUARD` duplicate; `does NOT emit a parse error for a well-formed default`; merge the unknown-shape and `MALFORMED_DEFAULT` cases                                                                                                                                                                                                                   | PascalCase single Number default, PascalCase tree-access default, bracket-leading `System.String`, empty PascalCase `InnerTree`                                                                                                                                                                                                                  |
| `normalize-default.malformed.test.ts`                   | keep             | consider folding into `process-input`                                                                                                                                                                                                                                                                                                                                                        | batch not aborted; flattened branch-path map kept                                                                                                                                                                                                                                                                                                |
| `process-input.test.ts`                                 | keep, trim       | string-array default duplicate; one of the two locale-comma tests; merge blank-numeric with boolean trimming; the fallback `stepSize` constant                                                                                                                                                                                                                                               | empty-string tree double dropped, invalid tree boolean dropped, locale-comma tree double, `Infinity` and hex rejected, both warning and parser error reported, non-string-able `ValueList` default, default absent from values map, out-of-range default surfaced, `[undefined]` never fabricated, canonical-cased key on case-insensitive match |
| `response-processors.test.ts`                           | trim             | merge the five system-type cases into an `it.each`; keep one or two of the `getValue` cases; the item-with-no-key case; merge the camelCase and null-`InnerTree` resilience cases; PascalCase `FileData` through `getValue`; the string-flag case unless the server sends it                                                                                                                 | aggregation under one `ParamName`, array wrap not merge, missing `InnerTree`, PascalCase `FileData`, `dispose()` once and idempotent, aliased object deleted once, `Object.prototype`-named outputs, `WebDisplay` and `stringOnly` filters, fresh objects on repeated reads                                                                      |
| `rhino-decoder.test.ts`                                 | trim             | merge the `Point3d` and `Line` cases into an `it.each`; merge the two passthrough cases; check the prefix-match case against the prefix-collision test                                                                                                                                                                                                                                       | `null` falls through; prefix collision reaches `CommonObject`; decoder throw falls back; `CommonObject.decode` throw gives the sentinel; hard failure without a fallback; `isRhinoDecodeError`                                                                                                                                                   |

## Simplification and architecture

Structural changes, from reading the code rather than prototyping. Each should be done behind the
existing tests, one at a time. **API** says whether the change reaches the published surface.

### Normalize wire casing once, at the boundary

`readField` (case-insensitive lookup) is called on the read path in `solve`, the client, the
scheduler cache, `response-processors`, `data-tree`, `definition-io`, `normalize-default`,
`normalize-schema` and `handle-files`. `DataTree` carries both `InnerTree`/`ParamName` and
`innerTree`/`paramName`. Four normalizers exist (`normalizeInputSchema`, `normalizeOutputSchema`,
`normalizeUISchemaCasing`, `asFileData`), and every consumer re-defends against both casings.

One structural normalizer on the parsed solve response (`values[].paramName`, `innerTree`,
item `data`/`type`/`id`, `errors`, `warnings`, `selva.outcome`) would leave every consumer on plain
property access. It must rewrite known structural keys only: branch paths and user-authored labels
stay verbatim, which is why a generic key-recaser is wrong. Removes the dual-cased `DataTree`
fields and most `readField` calls. **API:** `DataTree` shape changes. Do it in 5.0 or not at all.

### One retry combinator

`fetchCompute` (attempt loop, outcome union, backoff, abortable sleep) and
`GrasshopperClient.create` (probe ladder with its own backoff and `setTimeout` sleep) are the same
loop. `core/compute-fetch/retry.ts` already has `backoffDelay` and `sleep`. A small
`retrying({ attempts, delay, classify }, attempt)` serves both and lets the probe reuse the abortable
`sleep`. **API:** none.

### Make retryability explicit instead of inferred

`classifyFetchError` treats a `ComputeError` with code `NETWORK_ERROR` and a 2xx status as "body cut
off mid-stream, retry". The protocol between `handleResponse` and the retry loop is a status-code
convention. Have `handleResponse` throw (or return) a typed outcome with `retryable` set, and
`classifyFetchError` stops pattern-matching its own errors. **API:** none.

### Split `handleResponse`

`handleResponse` in `response.ts` mixes four jobs: redirect rejection, reading an error body,
partial-success detection on a 500, and parsing a 2xx. Split into `readErrorBody`,
`extractPartialSuccess` and `parseSuccessBody`, with `throwHttpError` driven by a module-level
status table (see Source: duplication). The three debug blocks collapse into one `logDebug`.
**API:** none.

### Scheduler: extract the cache and the server-key map

`solve-scheduler.ts` owns the queue, the response cache (entries, bytes, TTL, LRU, counters), the
server-definition-key map, the hash memo, hooks and last-state. The cache is self-contained:
`ResponseCache { get, set, clear, stats }` takes the byte budget, TTL and error policy, and drops
about a hundred lines and four counters from the scheduler. The server-key map is a 15-line LRU
helper. The scheduler is then orchestration only. **API:** `cacheStats()` and `clearCache()` keep
delegating.

### Scheduler: one settle path, one abort listener

- `settleError`, `settleSuccess`, `fail`, `supersede` and `shedAsQueueFull` all end in "set
  `item.settled`, clear timer, remove listener, resolve or reject, fire a hook". One
  `settle(item, outcome)` with a discriminated outcome (`success | error | superseded`) picks the
  hook from the outcome and removes the four near-copies.
- `queuedAbortHandler` and `externalAbortHandler` are two listeners on the same signal with
  hand-managed removal. One listener for the item's lifetime that routes on its state removes
  `removeQueuedAbortHandler` and the add/remove pairing.
- `latest-wins` is `queue` with `maxConcurrent: 1` and a replace-pending-and-abort-in-flight
  policy. `pendingForLatestWins` plus `fifo` plus two `drainNext` branches become one queue with an
  `onEnqueue` policy. Riskiest item here; the existing scheduler tests cover it well.

**API:** none.

### Scheduler: one definition identity

`u8DefinitionHashes` (WeakMap), `lastStringDefinition` and `SolveInputHashes` are three memo layers
for the definition hash. Resolve a definition to a `DefinitionRef`-like identity once on entry
(`ref.key` is already the cache identity everywhere else) and memoize that one object. **API:** none.

### Input defaults: one coercion, one rounding rule

Numeric coercion and integer rounding happen in three places for the same value:
`normalizeDefault` (per wire item type), `computeNumeric` / `mapNumbers` (scalar defaults), and
`TreeBuilder.itemCoercer` (again on the way back into a request). `canonicalizeParamType` and
`TreeBuilder` each lowercase `paramType` separately. One `coerceForParam(paramType, value, { min,
max })` keyed by canonical `paramType`, used by both parsers and `TreeBuilder.fromValues`, removes
the repeated rules. **API:** none if behaviour is preserved; the parser and `TreeBuilder` tests pin it.

### Input parsers: a `defineParser` helper

Every parser spreads `...base`, sets `paramType`, coerces `schema.default`, and has a fallback
that differs only in the safe default. A helper taking `(paramType, parseExtra, fallbackDefault)`
builds both `parse` and `fallback`, and the numeric parse/fallback field list, the duplicate
geometry/file call, and the repeated `'unnamed'` label disappear. **API:** none.

### Response processors: one item iterator

`getValues`, `getValue` and `extractFileData` each walk params then tree items with a callback
(`forEachTreeItem`); `getValue` re-implements a `matched` flag across both. One generator
`*items(response)` yielding `{ paramName, item }` makes `getValues` a reduce, `getValue` a filter
and `extractFileData` a filter-map. **API:** none.

### `ComputeServerStats`: table-driven control calls

`launchChildren`, `launchChild`, `shutdownChildren` and `recycleChildren` are the same POST with an
optional `?port=`. One private `control<T>(name, port?)` replaces four builders. `probeServer`
repeats the fetch-with-timeout-and-no-redirect logic that `getText` wraps. `monitor` hand-rolls a
timer, an `active` flag and an `activeMonitors` set; an async loop over an `AbortController` per
monitor, aborted on `dispose`, is shorter and has one cancellation path. Half the file is JSDoc;
keep the contract lines (null on failure, `initialize: false`, the purge caveat) and drop the rest.
**API:** none.

### Smaller shared helpers

- **warn-once:** `warnings.ts` (`warnedFunctions`) and `request.ts` (`warnedNoAuth`) each keep a
  `Set` for "warn once per key". One `warnOnce(key, message)`.
- **optional spreads:** `...(x !== undefined && { x })` is written dozens of times (client options
  merge, scheduler config merge, `applyOptionalComputeSettings`, error contexts). A `defined(obj)`
  helper that drops `undefined` values, or a key list looped once in `applyOptionalComputeSettings`,
  removes the noise.
- **error enrichment:** `client.solve` builds `{ definition, inputSummary }` in two catch paths. Build
  it once.
- **`warnIfClientSide`:** called from three public functions with a name each. One call in the
  client and `solve` entry is enough.

### Considered and left

- **`crypto.subtle` instead of the portable SHA-256.** It is async and absent on non-secure
  browser origins, and the hash is taken synchronously. The 170 lines stay.
- **`Uint8Array.fromBase64` / `toBase64`.** Would replace most of `encoding.ts` but needs a newer
  runtime baseline than Node 24. Revisit when the baseline moves.
- **Splitting `core` and `grasshopper` into packages.** The two subpath entries already enforce
  the seam; separate packages add release overhead for no new guarantee.

## File size

No line limit is worth adopting. Line count is a weak proxy, the repo has no `max-lines` rule, and
`STRUCTURE.md` says nothing on size. A file is split when it has more than one reason to change.
In `compute` two files are large for that reason, and both are already items above:
`solve-scheduler.ts` (queue, cache, server-key map, hooks, last-state in one class) and
`compute-server-stats.ts` (half JSDoc, plus four copies of one POST helper). The largest test file,
`solve-scheduler.test.ts`, shrinks with the test cuts; split it by behaviour afterwards if it is
still long.

## Order of work

1. Source fixes that leave the API alone (behind the existing tests): URL validation fan-out, `response.ts` error table and
   debug helper, parser duplication, `handle-files` duplication, `hasOwn` helper, dead code.
2. Test cuts in the files marked keep or trim with source-checked reports (core, scheduler,
   client, solve, server stats).
3. Verify the _unverified_ IO and data-tree rows against source, then cut.
4. Decide on the contract machinery.
   Then the structural changes under [Simplification and architecture](#simplification-and-architecture),
   starting with the ones that leave the API alone (retry combinator, `handleResponse` split,
   scheduler cache extraction, input coercion). Boundary normalization goes in 5.0 or not at all.
5. Package and config items, including the monorepo ones, from [Package, scripts and config](#package-scripts-and-config); the
   `provenance`, keywords, `tsconfig` target and `setup.ts` items are independent one-line changes.
6. Public API candidates, with an external-consumer check, in the 5.0 major before it goes stable.

## How to validate this document

For a session checking this review. The document is findings, not a changelog: confirm each against
the tree, and say where one is wrong.

**Confidence.**

- Source findings (duplication, dead logic, public API candidates, simplification): read directly
  from the source by the author of this document. Re-verify with `rg` before acting.
- Test verdicts: three reviewers each read a share of the suite. Core, scheduler, client, solve and
  server-stats rows read the source each test covers. The IO and data-tree rows are marked
  _unverified_ and were partly judged from test names and line counts. Do not delete from those
  rows without opening the test and the source.
- Package, scripts and config: checked against real artifacts (`publint --strict`, the packed file
  list, `dist` contents, the source map, `turbo.json`, `pnpm-workspace.yaml`, `.changeset/config.json`).
- Marked "verify" in the text and not confirmed: the `engines.node` to tsdown target link, the
  effect of `platform: 'neutral'`, which `tsdown` keys are defaults, and that npm trusted publishing
  attaches provenance on its own.
- Not run: `@arethetypeswrong/cli` on the packed tarball.

**A reviewer claim that proved wrong.** An audit agent reported the `@tests/*` alias as unused. 17
test files import through it. Treat every "unused" claim from a delegated reviewer as a lead until
`rg` confirms it.

**Re-check commands** (from `packages/compute`):

- Baseline: `pnpm type-check && pnpm lint && pnpm test && pnpm build`.
- Tarball: `pnpm exec publint --strict` and `pnpm pack --dry-run`.
- Public API candidates with no in-repo consumer: `rg -n "<name>" ../ --glob '!compute/**' --glob
'!**/node_modules/**' --glob '!**/dist/**' --glob '!website/static/**'`.
- Alias users: `rg -l "from '@tests/" src` and `rg -l "from '@/" src --glob '!**/__tests__/**'`.
- Contract machinery in CI: `rg -n "contract" ../../.github ../../turbo.json ../../package.json`.
- Duplicate `validateServerUrl` calls: `rg -n "validateServerUrl\(" src --glob '!**/__tests__/**'`.

**What a validator should decide, not just check.**

- The contract machinery: schedule it or delete it.
- Which public API candidates go in the 5.0 major, after an external-consumer check.
- Whether boundary casing normalization changes the public `DataTree` type in 5.0.
- `provenance: false`: whether there is a reason that is not written down.
- Whether the monorepo items (relative imports in `compute`, the catalog `@types/node`, a shared
  `tsdown` preset) belong in this plan or in their own.
