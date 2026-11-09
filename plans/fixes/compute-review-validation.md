# `@selvajs/compute` review: validation

Checks [compute-review-audit](./compute-review-audit.md) against the tree, then reviews the package
independently. Line numbers drift: when one stops resolving, grep the quoted text.

**How this was checked.** Runtime claims ran against the built `dist` with Node's real `fetch` and a
local HTTP server, not the test mock. Build claims ran as tsdown builds into a scratch directory.
Turbo claims ran as `--dry=json` in a throwaway clone. Source, public API and IO test rows were read
directly. The core and scheduler test rows went to two read-only reviews: every row they called
wrong was opened and confirmed, and rows they passed were not all re-read.

**Not verified.**

- External consumers. Consumer A has no checkout here, and Consumer B is known only through
  [compute-cleanup-audit](../archive/compute-cleanup-audit.md) and
  [compute-package-cleanup](../archive/compute-package-cleanup.md).
- A live Rhino Compute server. No wire shape here was observed on a real server; the
  `COMPUTE_LIVE_URL` suites stayed skipped.
- Browser behaviour. Nothing ran in a browser; browser findings come from reading the code and the
  fetch spec.
- Why `publishConfig.provenance: false` has no effect, and why `compute` lacks `selva-source`. The
  history starts at one squashed commit, so intent is not recorded.

## 1. Corrections to the review

### Source: duplication and logic

| Where                                                | Verdict | Review says                                                                               | Actually                                                                                                                                                                                         | Evidence                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/files/handle-files.ts:227-235`                 | WRONG   | A `Map` or `Object.create(null)` for the zip entries removes the `__proto__` special case | Neither does. fflate's `fltn` writes each entry into its own plain `{}`, so the entry is lost for any input container. A `Map` zips to an empty archive with no error                            | fflate async `zip`: plain object with own `__proto__` gives `['ok.txt']`, `Object.create(null)` gives `['ok.txt']`, `Map` gives `[]`. The rename stays. Regression test: `handle-files.test.ts` `__proto__` case                       |
| `grasshopper/io/output/response-processors.ts:16`    | WRONG   | `rhino` can be `RhinoModule` through a type-only import                                   | That puts `import ... from 'rhino3dm'` into the public `.d.ts`. `rhino3dm` is a devDependency, and `rhino-objects.ts:1` exists to keep it out of public types                                    | `rg rhino3dm dist/*.d.ts` hits comments only today. Use a small structural type (`Point`, `Line`, `CommonObject.decode`) instead                                                                                                       |
| `grasshopper/solve.ts:162`, `io/definition-io.ts:30` | PARTLY  | Validate once at the client boundary                                                      | The fan-out is real, but `solveGrasshopperDefinition` and `fetchDefinitionIO` are public and reach no client. These two calls are the only blocked-host check on those paths                     | `solve.test.ts` "blocked public endpoint", on the review's own keep list, would fail. Move the `solve.ts` call into `solveGrasshopperDefinition`; keep the `definition-io.ts` one                                                      |
| `core/compute-fetch/response.ts:56-87`               | PARTLY  | One message template                                                                      | The table is rebuilt per error and 401, 403 and the fallback share a template, but 404 uses `fullUrl`, 413 uses `requestSize`, and 429 omits `statusText`                                        | A status table works only with a per-status message function                                                                                                                                                                           |
| `grasshopper/scheduler/solve-scheduler.ts:57,74,202` | PARTLY  | Three layers memoize one hash; keep one                                                   | They differ: the WeakMap covers bytes across calls, `lastStringDefinition` covers strings across calls, `SolveInputHashes` is per-call laziness                                                  | Dropping the WeakMap re-hashes multi-MB bytes on every solve. Dropping `SolveInputHashes` makes hashing eager; see the definition-identity row below                                                                                   |
| `core/errors.ts:73,88`                               | PARTLY  | `ComputeError` stores the cause twice                                                     | True, but `originalError` is a public field. Removing it is an API change and belongs under Public API candidates                                                                                | No monorepo reader outside compute's own tests; external use unknown                                                                                                                                                                   |
| `core/utils/encoding.ts:112`                         | PARTLY  | `new TextEncoder().encode(str).length` does the same                                      | Same result, higher cost on the Node path, which runs on every request body                                                                                                                      | 100 MB string: `Buffer.byteLength` 23 ms and no allocation, `TextEncoder` 79 ms and 200 MB. Keep the Buffer branch; replace only the hand-rolled fallback. No test pins the choice beyond the shared length list in `encoding.test.ts` |
| `core/utils/encoding.ts:20-30`                       | PARTLY  | Two validation layers do not earn their place                                             | The review names no removal. `stripBase64` exists so the decoder skips an alphabet regex over multi-MB payloads, and the fallback decoder stays until `Uint8Array.fromBase64` is in the baseline | Comment at `:25`, and `typeof Uint8Array.fromBase64` is `undefined` on the Node 24 in use                                                                                                                                              |

### Public API candidates

The review says these have no consumer in the monorepo outside tests and generated docs.

| Symbol                         | Verdict | Actually                                                                                                  | Evidence                                                                                                                                                     |
| ------------------------------ | ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TreeBuilder.replaceTreeValue` | WRONG   | Documented and used                                                                                       | `packages/compute/README.md:141-142`, `examples/simple-example.ts:68`, `docs/adr/0001-pre-step-producers.md:420`; Consumer B, `compute-cleanup-audit.md:603` |
| `TreeBuilder.getTreeValue`     | WRONG   | Documented and used                                                                                       | `README.md:147`; Consumer B, `compute-cleanup-audit.md:603`                                                                                                  |
| `TreeBuilder.appendFlat`       | WRONG   | Used inside compute                                                                                       | `data-tree.ts:206`. Only its visibility can change                                                                                                           |
| `processInput`                 | PARTLY  | No monorepo source caller, but the archive names it an external symbol not to prune                       | `plans/archive/compute-package-cleanup.md:152-156`                                                                                                           |
| `DEFAULT_BLOCKED_HOST`         | PARTLY  | Unused outside compute, but a caller extending `blockedHosts` needs it, or they silently drop the default | `validate-server-url.ts:12`                                                                                                                                  |

`getParamName`, `flatten`, `getConfig`, `getMaxConcurrent`, `launchChildren`, `launchChild`,
`recycleChildren` and `getServerTime` have no consumer in the monorepo. The `getConfig` hits in
`packages/selva` belong to a different method on the compute server store.

### Package, scripts and config

| Where                                            | Verdict | Review says                                                                      | Actually                                                                                                                                                                                                               | Evidence                                                                                                                                                     |
| ------------------------------------------------ | ------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsdown.config.ts` `minify`                      | WRONG   | About 1 MB of maps; dropping `minify` roughly halves them                        | The maps total about 630 KB and do not shrink: they embed `sourcesContent`, so unminified maps are about 620 KB                                                                                                        | Dropping `minify` grows the JS from 134 KB to 335 KB. The recommendation still stands for another reason: `err.constructor.name` is `t` in the shipped build |
| `eslint.config.mjs`                              | WRONG   | Most warnings are `rhino?: any` and `getValue(): any`                            | Three of 25. 17 are in test files; 11 of those are in `encoding.test.ts`                                                                                                                                               | `pnpm lint`                                                                                                                                                  |
| `tsdown.config.ts` `platform`                    | PARTLY  | `neutral` makes a static Node import fail the build; verify output unchanged     | Output is byte-identical, but a Node import is only a warning and the build exits 0. It fails with `failOnWarn: true`, and that also fails on tsdown's CJS recommendation unless `checks: { legacyCjs: false }` is set | CJS output stays on `platform: 'node'` regardless (`build-*.mjs:556`). A guard for the `.js` half only                                                       |
| `tsdown.config.ts` `fixedExtension`, `clean`     | PARTLY  | Both read as defaults                                                            | `clean: true` is the default. `fixedExtension` defaults to `platform === 'node'`, so `false` is load-bearing: without it the build emits `core.mjs` and breaks `exports`                                               | Scratch build. `platform: 'neutral'` would make it droppable                                                                                                 |
| `engines.node` to tsdown `target`                | PARTLY  | Link exists; set `target` if the browser baseline matters                        | The link is real (`target: node24.0.0` in the build log). No action needed: `dist` parses as ES2022, and `AbortSignal.timeout` already sets a higher floor than that syntax                                            | acorn parse of `dist`; `signal.ts:19`                                                                                                                        |
| `package.json` typedoc plugin                    | PARTLY  | The plugin exists because public types are not exported; exporting them drops it | Those types are reachable and unexported, but typedoc builds with no not-exported warning without the plugin. It can go today; the plugin only adds a page for those types                                             | Plugin-free typedoc run: 0 errors, 6 unrelated warnings                                                                                                      |
| `package.json` `fast-check`                      | PARTLY  | Goes with the fuzz test                                                          | Only if the fuzz test goes, and it should stay (see below). The catalog entry stays either way: `server` and `visualization` use it                                                                                    | `rg fast-check packages`                                                                                                                                     |
| `package.json` `keywords`                        | PARTLY  | Keep `rhino-compute` and `typescript`                                            | Neither is in the list today, so those are additions                                                                                                                                                                   | `package.json:15-32`                                                                                                                                         |
| `tsconfig.json` split                            | PARTLY  | `types: []` for `src/`                                                           | Needs edits first: `encoding.ts:3` and `sha256.ts:9` use Node types on purpose, and tests sit under `src/**/__tests__`                                                                                                 | Sound aim; costs more than one config line                                                                                                                   |
| `verbatimModuleSyntax`                           | PARTLY  | `handle-files.ts` and `grasshopper-client.ts` import types without `import type` | Also `solve.ts`, `definition-io.ts`, `data-tree.ts`, `response-processors.ts`, `grasshopper-response-processor.ts`. Types are already elided from `dist`                                                               | `rg` over `src`; the flag is a style guard                                                                                                                   |
| `hasOwnProperty` helper with the ES2022 override | PARTLY  | Both proposed                                                                    | They conflict. With ES2022, `Object.hasOwn` needs no helper, so do the tsconfig change first and skip the helper                                                                                                       | `tsconfig.base.json`                                                                                                                                         |
| `compute` lacks `selva-source`                   | PARTLY  | Likely blocker is the `@/` alias                                                 | True for `compute`, which has 21 alias files, and no consumer maps `@`. It is not the general cause: `solve` and `visualization` have no alias imports and lack the condition too                                      | The split follows the build tool: `tsc` ESM-only packages have the condition, `tsdown` dual-format packages do not. Intent is not recorded                   |
| `scripts/fetch-server-contract.mjs`              | PARTLY  | Three exports exist only for a test; about 40% comment                           | `SERVER_REPO` is imported by nothing; the test takes the other two. Comments are 50 of 181 lines                                                                                                                       | `rg SERVER_REPO`; `resolve-ref.test.ts:12`                                                                                                                   |
| Contract machinery                               | PARTLY  | The parser exists only to build the snapshot                                     | `server-contract.test.ts:20` also imports `flatten` from it                                                                                                                                                            | Direct read                                                                                                                                                  |

### Tests

"Keep" below means keep the behaviour. Folding it into a table is fine.

| Test                                                                   | Verdict                             | Review says                                  | Why it must stay                                                                                                                                                                                                                                                                         | Evidence                                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `redirects-and-limits` `asks fetch not to follow redirects`            | WRONG                               | Drop                                         | The only pin of `redirect: 'manual'`, which keeps the API key from following a redirect. The 3xx test passes without it because the mock returns 307 regardless                                                                                                                          | `compute-fetch.ts:47`, test `:40` and `:46`                                                                                |
| `redirects-and-limits` `leaves host blocking to the backend`           | WRONG                               | Tests an absent feature                      | The feature is `blockedHosts: []` on a public function, with no other test                                                                                                                                                                                                               | `compute-fetch.ts:176`, test `:164`                                                                                        |
| `compute-fetch` 418 case                                               | WRONG                               | Drop                                         | The only test of the unmapped-status fallback. Proxies send 405, 422, 501                                                                                                                                                                                                                | `response.ts:84-87`, test `:221`. Fold into the status table                                                               |
| `compute-fetch` auth-token negative                                    | WRONG                               | Drop                                         | Its second half is the only test that the missing-credentials warning fires at all                                                                                                                                                                                                       | `request.ts:37-47`, test `:178-180`                                                                                        |
| `compute-fetch` case-variant header                                    | WRONG                               | Drop if it is one more key in the loop       | There is no loop at the precedence test. This is the only test of the lowercase comparison                                                                                                                                                                                               | `request.ts:67-68`, test `:137`                                                                                            |
| `encoding` pool aliasing, keep the sibling test                        | WRONG                               | Keep the sibling test, drop three others     | Backwards. Two decodes get different slab offsets, so `a.fill()` never reaches `b`: the sibling test passes with the bug. Keep `:80` or `:253`, which read `.buffer`                                                                                                                     | `encoding.ts:87`, test `:88`                                                                                               |
| `classify-probe-failure` non-auth 4xx                                  | WRONG                               | Drop                                         | The only test of the `status >= 500` false side, which stops the probe ladder                                                                                                                                                                                                            | `classify-probe-failure.ts:71`, `grasshopper-client.ts:174`, test `:26`                                                    |
| `handle-files` `carries subFolder on base64 items too`                 | WRONG until the push branches merge | Drop                                         | The base64 branch is its own object literal; no other test asserts its `subFolder` or `metadata`                                                                                                                                                                                         | `handle-files.ts:158-164`, test `:325`                                                                                     |
| `solve-scheduler` stringify-fallback test                              | WRONG                               | Drop                                         | The only test that sizes an unhinted response. Custom executors are public, and they always take this path                                                                                                                                                                               | `solve-scheduler.ts:144`, test `:684`; every other byte test sets a hint                                                   |
| `solve-scheduler` `notifies subscribers`                               | WRONG                               | Drop                                         | The only `subscribe()` test, and `README.md:62` documents it. Strengthen it: `>= 2` passes on enqueue alone                                                                                                                                                                              | Test `:946`                                                                                                                |
| `solve-scheduler` duplicate half of `dispose`                          | WRONG                               | Drop                                         | Neither half is a duplicate: one is the only test that `dispose()` settles work, the other the only `INVALID_STATE` after dispose                                                                                                                                                        | Test `:1142-1147`; `packages/solve/src/server/client-cache.ts:378,398,430` dispose live schedulers                         |
| `solve-cachekey` `pointer hit never calls load()`                      | WRONG                               | Drop                                         | The only test of the real pointer path. `definition-ref` covers a mock executor that never touches `load`                                                                                                                                                                                | `solve.ts:117-120`, test `:177`. `solve-scheduler-definition-ref` stays green if `load()` moves before the pointer attempt |
| `empty-inner-trees` `does not warn when every output has data`         | WRONG                               | Drop                                         | The only guard on `solve.ts:66`; without it every healthy debug solve warns                                                                                                                                                                                                              | Test `:60`, no other `debug: true` case                                                                                    |
| `compute-server-stats` `POSTs to /cache/purge`, `launchChildren` shape | WRONG                               | URL and shape echoes                         | The only two `method` assertions. A wrong method gives a silent `null`                                                                                                                                                                                                                   | Test `:340`, `:485`                                                                                                        |
| `compute-server-stats` `getServerTime` parse                           | WRONG                               | Trivial parse-and-return                     | The only test of the JSON quote strip; `new Date('"…"')` is invalid. Goes only if `getServerTime` goes                                                                                                                                                                                   | `compute-server-stats.ts:387`, test `:448`                                                                                 |
| `data-tree` `ignores null bounds`                                      | WRONG                               | Drop                                         | `minimum: null` is the normal unbounded input, and a negative value with a null minimum clamps to `null` without the guard. The list-access test only covers the max side                                                                                                                | `normalize-schema.ts:22`, `data-tree.ts:344`, test `:472`                                                                  |
| `normalize-schema` `groupName` null vs empty                           | WRONG                               | Drop                                         | Two source comments state this rule and nothing else tests it                                                                                                                                                                                                                            | `normalize-schema.ts:10`, `input-processors.ts:49`, test `:27`                                                             |
| `process-input` fallback `stepSize`                                    | WRONG                               | A constant                                   | It is a branch output. Remove `stepSize` from the fallback and only this fails; the type is optional, so the compiler says nothing                                                                                                                                                       | `input-type-parsers.ts:150`, test `:282`                                                                                   |
| `response-processors` item with no key                                 | WRONG                               | Drop                                         | `byId` on a stock server, which sends no `id`                                                                                                                                                                                                                                            | `response-processors.ts:199`, test `:110`                                                                                  |
| `response-processors` PascalCase `FileData` through `getValue`         | WRONG                               | Drop                                         | The only test of `extractItemValue`'s FileData branch, the path output widgets read                                                                                                                                                                                                      | `response-processors.ts:108`, test `:312`                                                                                  |
| `definition-io.diagnostics` parsed-wrapper copies                      | WRONG                               | Copies                                       | `:110` is the only test that `fetchParsedDefinitionIO`, which `client.getIO` calls, forwards the fields. `:122` can go                                                                                                                                                                   | `definition-io.ts:138-139`                                                                                                 |
| `input-parsing.fuzz.test.ts`                                           | PARTLY                              | Main property is "does not throw"; delete it | Four properties, and "never throws" pins a documented contract at the `/io` boundary that table cases cannot replace. It is cheap, and 20,000 runs pass in about a second. The two `decimalsOf` properties can move to `numeric-parser` tables                                           | `input-processors.ts:32`. The file's comment at `:88-89` needs fixing either way                                           |
| `process-inputs.characterization`                                      | PARTLY                              | Move four tests                              | Five others have no surviving coverage: Geometry JSON parse (`:139`), Color unquote (`:161`), ValueList `values` map (`:102`), Boolean list fallback `[false]` (`:75`), Integer tree step (`:203`). "Invalid boolean recovers" need not move: `process-input.test.ts:185` already has it | `rg` for each across the test tree                                                                                         |
| `data-tree` per-type coercion                                          | PARTLY                              | Keep one `it.each`                           | `fromValues` is the production path (`packages/solve/src/server/transform-input.ts:9`). Fold into a table, but keep clamp, Integer rounding, explicit `false` and the warning count                                                                                                      | Tests `:445-489`                                                                                                           |
| `response-processors` `getValue` cases                                 | PARTLY                              | Keep one or two                              | Keep `byName` multi-item and `byId`: `byId` is what `packages/solve` reads. Fold both unknown-key cases into one row                                                                                                                                                                     | Tests `:138-163`                                                                                                           |
| `definition-io.diagnostics` object and blank diagnostics               | PARTLY                              | Drop unless the server sends them            | The tests are droppable only with `coerceDiagnostic`, or the code goes untested. The server types them as strings                                                                                                                                                                        | `definition-io.ts:78`, `IoResponseSchema` in the snapshot                                                                  |
| `normalize-schema` `fills required fields`                             | PARTLY                              | Restates constants                           | `atMost ?? 1` decides list vs scalar fallback shape. Keep that line                                                                                                                                                                                                                      | `input-type-parsers.ts:47`                                                                                                 |
| `normalize-ui-schema` already-camelCase pass-through                   | PARTLY                              | Fold into idempotence                        | No idempotence test exists. Write one                                                                                                                                                                                                                                                    | Direct read                                                                                                                |
| `rhino-decoder` prefix-match case                                      | PARTLY                              | Check against the collision test             | Distinct: one decodes on prefix, the other falls through. The wire type carries no suffix, so the case is unreachable. Remove the `startsWith` loop in `findDecoder` with the test; the collision then cannot occur                                                                      | `rhino-decoder.ts:32-38`                                                                                                   |
| `sub-folder` single-segment root                                       | PARTLY                              | Drop                                         | Same code path as a two-segment value, but the archive-root outcome is untested. Move it to `download-by-root`                                                                                                                                                                           | Test `:70`                                                                                                                 |
| `solve-scheduler` cache and cancel merges                              | PARTLY                              | Merge                                        | Keep the only `hits: 1` (`:740`) and the only `.code` on a cancelled FIFO item (`:326-328`). The hit-count merge must keep the cap of 2                                                                                                                                                  | Test file                                                                                                                  |
| `stable-hash` binary collisions                                        | PARTLY                              | Keep one                                     | Two paths, not one: the `u8` marker and `hashDefinition` bytes. Keep `:148` and `:159`                                                                                                                                                                                                   | `stable-hash.ts:39,95`                                                                                                     |
| `solve-scheduler-hash-memo` hash-once cases                            | PARTLY                              | Drop one or both                             | They guard separate paths; keep both                                                                                                                                                                                                                                                     | `solve-scheduler.ts:63,660`                                                                                                |
| `solve.test` `applyOptionalComputeSettings`                            | PARTLY                              | Drop both                                    | `:95` is the only forwarding assertion; `:101` can go. Five settings have none                                                                                                                                                                                                           | Test `:95`                                                                                                                 |
| Overlap: `definitionReuploaded`                                        | PARTLY                              | Keep `solveDetailed` and client integration  | `undefined` for URL and reuse off is covered only by `solve-scheduler-cachekey:94,109`, and `packages/solve` branches on it                                                                                                                                                              | `client-cache.ts:311-313`                                                                                                  |
| Overlap: "Null on failure"                                             | PARTLY                              | All through `getText`                        | `isServerOnline` and friends go through `probeServer`. Exclude them from the table                                                                                                                                                                                                       | `compute-server-stats.ts:151-175`                                                                                          |
| Overlap: base64 strictness                                             | PARTLY                              | Keep the fuzz pair and `atob` test           | That drops `encoding.test.ts:44`, which the core row says to fix. Without it the Buffer path has no `ENCODING_ERROR` assertion                                                                                                                                                           | Fuzz `attempt` swallows every throw                                                                                        |
| `tests/helpers/mock-fetch.ts`                                          | PARTLY                              | `arrayBuffer` is the problem                 | Drop `arrayBuffer`, `blob` and `json`. The bigger gap: the mock has no `body`, so the status tables take `read-body.ts:20-23` while every real error takes `:33-48`                                                                                                                      | `rg` for uses                                                                                                              |

### Simplification and architecture

| Proposal                                              | Verdict                 | Finding                                                                                                                                                                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                    |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Input parsers: `defineParser`                         | WRONG                   | "Every parser ... has a fallback" is false: Text, File and Color have none, and ValueList parses by hand. The helper fits four parsers at most                                                                                                                                                                                                                                                                            | `input-type-parsers.ts:43,187,276,292`                                                                                                      |
| `ComputeServerStats`: `probeServer` repeats `getText` | WRONG                   | Both already call `fetchWithTimeout`. Nothing is repeated, and `probeServer` differs on purpose: it reads no body and returns the status                                                                                                                                                                                                                                                                                  | `compute-server-stats.ts:101,164`                                                                                                           |
| File size: four copies of one POST helper             | WRONG                   | `postJson` already is that helper; the four methods are one-liners over it                                                                                                                                                                                                                                                                                                                                                | `compute-server-stats.ts:480`                                                                                                               |
| Boundary casing normalization                         | PARTLY, not recommended | Unsound as written. `visualization` and `selva` read `InnerTree` directly from the same response, so a camelCase normalizer silently empties them. Data that never crosses `runSolve` keeps raw casing: `/io` fields, `default` trees, `FileData` JSON inside `data`, schema wrappers. Only `solve.ts`, `client`, `scheduler`, `data-tree` and `response-processors` calls go, at most 30 of the 78 lines that mention it | `packages/visualization/src/parse/webdisplay/webdisplay-parser.ts:137`, `packages/selva/src/lib/server/mcp/tools.ts:194`, `rg -c readField` |
| Folding `latest-wins` into `queue`                    | PARTLY, not recommended | Not behaviour-preserving as stated: `setMaxConcurrent` would raise concurrency, the cache-hit supersede has no queue equivalent, and `maxQueueDepth` and `queueWaitMs` must stay queue-only. A policy object replaces about as much code as it removes                                                                                                                                                                    | `solve-scheduler.ts:409,540,671`, `scheduler/types.ts:67,75`                                                                                |
| Single `settle()`                                     | PARTLY                  | Sound but smaller than claimed. `fail`, `supersede` and `shedAsQueueFull` already delegate to `settleError`, so the copies are `settleError` and `settleSuccess`. Trap: `onSettle` must still fire after `writeLastState`, because a hook can read `lastResult`; queued failures write no state at all                                                                                                                    | `solve-scheduler.ts:601-625,706-732`                                                                                                        |
| One abort listener                                    | PARTLY                  | Sound, but the pairing stays: a queued item removes it at settle, an in-flight one in `finally`, and the two states must keep settling differently so `durationMs` stays right                                                                                                                                                                                                                                            | `solve-scheduler.ts:483,574,627`                                                                                                            |
| One definition identity                               | PARTLY                  | "Once on entry" must stay lazy, or a URL or uncached solve hashes multi-MB bytes it never needs. A `Uint8Array` still needs an identity memo                                                                                                                                                                                                                                                                              | `solve-scheduler.ts:381,639`                                                                                                                |
| One `coerceForParam`                                  | PARTLY                  | Rules differ: `normalizeDefault` keys on wire item type, parsers on `paramType`, invalid items are reported or silently filtered depending on the path, and only `TreeBuilder` clamps. Clamping at parse time changes `InputParam.default`. Share the coercion and rounding primitive only                                                                                                                                | `normalize-default.ts:76-84`, `data-tree.ts:171-177`                                                                                        |
| Response processors: one iterator                     | PARTLY                  | `getValue` stops at the first matching param; `getValues` aggregates across params. A flat `*items()` filter silently changes that unless the generator yields param boundaries                                                                                                                                                                                                                                           | Duplicate `paramName` gives `getValue` 1, `getValues` `[1, 2]`; no test pins it                                                             |
| One retry combinator                                  | PARTLY                  | Sound and small. The probe has no jitter and no signal today, so the abortable `sleep` only pays off with finding 15                                                                                                                                                                                                                                                                                                      | `grasshopper-client.ts:157-180`                                                                                                             |
| `monitor` as an async loop                            | PARTLY                  | Sound, but `getServerStats` takes no signal, so the plumbing goes through every read                                                                                                                                                                                                                                                                                                                                      | `compute-server-stats.ts:508`                                                                                                               |
| Optional spreads: `defined(obj)`                      | PARTLY                  | `applyOptionalComputeSettings` uses `!= null`, so a helper that drops only `undefined` starts sending `null`. There are 22 conditional spreads, not dozens                                                                                                                                                                                                                                                                | `solve.ts:233-238`                                                                                                                          |
| `warnIfClientSide` once at the client                 | PARTLY                  | `fetchDefinitionIO` is public, and the cleanup audit moved the warning there on purpose. Keep it there                                                                                                                                                                                                                                                                                                                    | `definition-io.ts:29`, `compute-cleanup-audit.md:118`                                                                                       |

### The review document itself

- The header says `git diff packages/compute` shows fixed findings. The tree is clean: they are
  committed.
- "Tracked in: unfiled" and "Order of work" are a status and a task list, which
  [CONVENTIONS](../CONVENTIONS.md) rules out for plans. The cleanup audit's "Implemented; what's left
  is Before release" is the same.

## 2. Confirmed findings

**Source: duplication.** `hasOwnProperty.call` appears three times. `handle-files.ts` repeats the path
ternary, the two pushes and the metadata spread. The numeric parse and fallback field lists match.
Geometry and file make the same `coerceDefault` call. `schema.nickname || 'unnamed'` appears five
times. `handle-files.ts:71` copies `err.message` into context beside `originalError`.

**Source: logic.** `normalizeBase64` is used only by `detectBase64Payload`. `response.ts` has three
debug blocks, emoji lines and a threaded `debug` flag. `@public` and `@internal` tags are scattered.
`grasshopper-client.ts` has two narrative docblocks. `index.ts` banners restate names. Three `any`s
sit in `response-processors.ts`. Seven `grasshopper/*` files import the `@/core` barrel, and `solve.ts`
mixes both styles.

**Public API candidates.** No monorepo consumer: `getParamName`, `flatten`, `getConfig`,
`getMaxConcurrent`, `launchChildren`, `launchChild`, `recycleChildren`, `getServerTime`.

**Package and scripts.**

- `publint --strict` passes; the tarball holds only `dist`, `README.md`, `LICENSE`, `package.json`.
- `are-the-types-wrong` on the tarball: node16 (CJS and ESM) and bundler are green for both entries;
  node10 fails to resolve, as the review expects.
- `provenance: false` appears only in compute. npm attaches provenance on trusted publishing
  ([docs](https://docs.npmjs.com/trusted-publishers/),
  [opt-out](https://docs.npmjs.com/generating-provenance-statements/)), and the registry shows an
  attestation on the current `compute` beta despite the flag. The line is inert in this pipeline, so
  it can go.
- `typedoc` and its plugin pin versions directly, and the website runs `typedoc` through compute
  (`build-api-docs.mjs:83`). No `./package.json` export, no `typesVersions`.
- `prepack` relies on root `publint`; `verify-pack` overlaps it. `test:live` works.
- `sideEffects: false` is correct, and tree-shaking works: a browser bundle of `ErrorCodes` alone is
  740 bytes.

**tsdown and TypeScript config.** `entries` is a one-use constant. `lib: DOM` with `types: ["node"]`
applies to the whole program. `ES2020` forces the two workarounds, and an `ES2022` override removes
them. The `@tests/*` alias has 17 users and two declarations. The `include` list is right.

**vitest, setup, ESLint.** `__dirname` can be `import.meta.dirname`. The `setup.ts` stash can become
`vi.stubGlobal` plus `vi.unstubAllGlobals`. `afterEach` can be `clearMocks: true`.
`resolve.conditions` is inert here. The shared config loads Svelte and shadcn rules. `docs/api/` must
stay ignored. All warnings are `no-explicit-any`. `typedFiles` exists and suits a scoped typed pass.

**Monorepo.** `@types/node` is `^26` against Node 24. `tsdown.config.ts` differs only in `entry` and
`external`. Compute's dependency edges are as described. The release path needs no per-package wiring.
`compute` is outside `fixed` and `linked`. An edit to `packages/config` changes the hash of compute's
`lint`, `test`, `type-check` and `build`, measured in a clone. Website and build inputs are current.

**Other.** `fflate` is reached only through a dynamic import. `resolveRef` can move next to the
parser. No workflow runs `contract:check`. `CLIENT_REQUEST_KEYS` and `CLIENT_INPUT_FIELDS` are copied
lists. `schema-endpoint.live > reports the raw wire casing` is the only real-casing test.

**Tests: delete whole files.** `types.test.ts`: the runtime bodies read back constants, and
`tsc --noEmit` already enforces the `expectTypeOf` lines, so a `.test-d.ts` move is unnecessary.
`param-type-casing.test.ts`: `process-input.test.ts:210` covers lowercase through the canonical parser.

**Tests: drops that hold.** Everything in the per-file tables not listed in section 1, including:

- Core: PascalCase partial-success merge, duplicate Compute8 500 message, 500-with-values copy,
  server-timing tables (add 504 to the status table when dropping the label test), compose-signal
  merge, `read-field` cache tests (the cache is gone), `sha256` delegation tests, `warnings` merges,
  `validate-server-url` merges, `handle-files` traversal and `::` merges, `sub-folder` separators.
- The `ENCODING_ERROR` test does pass silently for `####`, though `:45` still fails if the first
  input stops throwing.
- `test-data-builders`: each typed builder has one user file.
- Scheduler: the pending-supersede, `SUPERSEDED`, `respects maxConcurrent`, already-aborted-signal,
  TTL, LRU and `lastResult` merges. Cachekey and definition-ref merges. Client `partial-success`
  duplicate and 503 merge. `stable-hash` shape and FNV renames. Response-processor forwarding tests.
- IO: `numeric-parser` real-world, `text-parser` Unicode, `normalize-default.casing` drops, camelCase
  twin in `definition-io.casing` (reads are case-insensitive by construction), the
  `normalize-ui-schema` top-level and non-object drops, `schema-endpoint` merge, `rhino-decoder`
  merges.

Every keep claim in the per-file tables names a test that exists.

**Simplification.** Explicit retryability and the `handleResponse` split are sound; keep the 2xx
order where `onServerTiming` fires before the body read. Scheduler cache extraction is sound: the
error and `selva.outcome` policy moves with it. The warn-once helper and error-enrichment items are
sound.

**Considered and left.** Agreed on all three. `Uint8Array.fromBase64` is absent on the Node 24 in use.

## 3. New findings the review missed

Ranked by impact. All were reproduced against `dist` unless marked.

### High

**1. On Node, a refused connection or DNS failure is never classified.**
`grasshopper/server/compute-server-stats.ts:172` renders `${err.name}: ${err.message}`, which is
`TypeError: fetch failed`; undici keeps `ECONNREFUSED` and `ENOTFOUND` on `cause`. So
`classifyProbeFailure` returns `unknown`, retryable. `create()` spends its whole ladder on a port
nothing listens on, and the admin status route (`packages/selva/.../compute/status/+server.ts:29`)
reports a dead port as retryable. Both test suites miss it by using strings real `fetch` never
produces: `grasshopper-client.integration.test.ts:53`, `classify-probe-failure.test.ts:36,47`.
Include `err.cause` in the string, and rebuild the mocks as
`new TypeError('fetch failed', { cause })`.

**2. On Node, `timeoutMs` above 300 s is not honoured.** With `timeoutMs: 420_000` the request died
at 301 s: `NETWORK_ERROR`, `HeadersTimeoutError` from undici's default. `timeoutMs: 0` has the same
limit, though `README.md:75` recommends it with `retry: { attempts: 1 }` for long jobs, so the solve
is re-sent while the first still runs. Selva's default deadline of 100 s hides this until
`COMPUTE_SOLVE_DEADLINE_MS` passes 300 s. Add a `ComputeConfig.fetch` seam so a Node host can pass a
dispatcher, and state the limit in the README.

**3. An API key with an invalid header character lands in the error message.**
`compute-fetch.ts:96-110` wraps any `TypeError` as a retryable network error, and undici's message
quotes the value: `Network error: Headers.append: "super-secret\nkey" is an invalid header value.`
It is also retried, labelled `CORS_ERROR` in a browser, and reaches logs through `renderThrown` in
`solve.server.ts`. `probeServer` copies it into `ProbeFailure.summary`, documented as "Never includes
the API key". Build the headers once with `new Headers()` before the loop, and throw `INVALID_CONFIG`
without quoting the value.

**4. `validateServerUrl` echoes the credentials it rejects.** `validate-server-url.ts:34`:
`Invalid serverUrl: "https://admin:hunter2@my.server"`, and again in `context.receivedServerUrl`.
A `?api_key=` query behaves the same. Report `origin` with credentials and query removed.

**5. Aborting with a reason loses the `ABORTED` code.** `isAbortError` checks the name, but fetch
rejects with `signal.reason`. `controller.abort(new Error('x'))` gives `UNKNOWN_ERROR`; a `TypeError`
reason gives a retryable `NETWORK_ERROR`; mid-body it gives `Failed to parse JSON response`, which
then goes through the retry path (`compute-fetch.ts:75`, `response.ts:247`). The scheduler passes no
reason, so only direct `signal` callers are hit. Check `ctx.config.signal?.aborted` first in both
places. `compute-fetch.test.ts:530,582` hide it by rejecting a fixed `AbortError`.

**6. A hung `DefinitionRef.load()` wedges the scheduler for good.** `load()` takes no signal and
`timeoutMs` does not cover it, so the item stays in `inFlight`. In latest-wins every later solve
waits forever, and `cancelAll()` does not free the slot: reproduced, still wedged afterwards
(`solve.ts:137-151`). In production `load` reads definition storage. Race `load()` against the signal in
`materializeDefinition`, and pass the signal to `load` as an additive argument.

**7. Text outputs change type, and long numeric strings lose digits.** `tryDecodeJSON`
(`response-processors.ts:52-72`) re-parses a decoded string, so for `System.String`: `"12345678901234567890"`
gives `12345678901234567000`, `"123"` gives `123`, `"true"` gives `true`, `"null"` gives `null`.
`"01234"` stays a string, so a part-number output changes type by value. Re-parse only when the inner
string starts with `{` or `[`. Separately, `System.Int64` and `System.Single` stay strings while
`normalize-default.ts:10` lists them as numeric.

### Medium

**8. Numeric config has one validated field.** `maxResponseBytes` is checked; the others are not.
`timeoutMs: Infinity` or `NaN` throws a raw `RangeError` outside any `ComputeError`, because
`composeSignal` runs before the `try` (`compute-fetch.ts:37`). `retry.attempts: NaN` never reaches
`isFinal`: 120 requests in 400 ms until aborted. `maxConcurrent: NaN`, or `setMaxConcurrent(NaN)`,
passes `Math.max` and wedges the queue, against the comment at `solve-scheduler.ts:302`. Validate once
in `fetchCompute` and the scheduler constructor.

**9. Payloads reach the logger, which the repo forbids.**

- `grasshopper-client.ts:286` logs the whole error, including `context.values`.
- `response.ts:164,200,203` log server bodies and solve errors.
- `transformers.ts:94` logs the raw default; `normalize-default.ts:113` logs rejected values.
- `handle-files.ts:193,211` log the full URL, signed query included.

The review's `logDebug` proposal would keep all of them. Log `requestId`, status and sizes only.

**10. `context.responseHeaders` carries `Set-Cookie` on Node.** `response.ts:41` copies every header.
A 403 gave `set-cookie: sid=topsecret`. Allowlist the headers worth keeping. Related:
`solve.server.ts:451` logs `context.responseBody`, deliberately, but erasure cannot reach it.

**11. A list or tree Text default keeps its JSON quotes.** `normalize-default.ts:96-106` pushes `data`
raw, and the Text parser skips tree defaults, so `"hello"` is sent with literal quotes while the
scalar path strips them. Reproduced in code; whether the fork sends quoted strings there needs a live
server, since `normalize-default.casing.test.ts:89` uses unquoted labels.

**12. `null` is sent as the text `"null"`.** `data-tree.ts:299`: `replaceTreeValue(trees, 'x', null)`
and `append([0], [null])` emit `{ data: 'null' }`, though `DataTreeValue` allows `null` and
`fromValues` drops it. Skip nulls in `append`, or take `null` out of the type.

**13. The contract check guards the wrong branch.** `contract:check` passes against `Compute8` and
`merge/8x`, but the client sends `selvaevents` and reads `selva`, which exist only on `8.x.selva`.
Against that branch the parser returns `[]` for `IoResponseSchema`. `stepSize` and `acceptedFormats`
are in neither the snapshot nor the copied lists. `server-contract.test.ts:99-101` also still says the
client reads `ParamName` verbatim.

**14. Public types that do not match runtime.**

- `SolveResult`'s `{ status: 'superseded' }` is never produced: supersede fires `onSuperseded`
  (`scheduler/types.ts:124`).
- `GrasshopperComputeResponse.values` is required, but `response-processors.ts:148` handles its
  absence.
- `DataItem.id` is required, but only the fork sends it.
- `ValueListInputType.default` can be a number (`input-type-parsers.ts:209`).
- `ProcessedFile.fileName`, documented as a filename, can hold `dir/nested.txt`.

**15. `create()` ignores `config.signal`.** The probe and its `setTimeout` sleep cannot be cancelled
(`grasshopper-client.ts:166,178`), so a caller waits out the ladder. `client.dispose()` also leaves
schedulers it created running with the credentials (`:321`).

**16. Test gaps.**

- Real `TypeError` with `cause` through probe and classifier.
- Abort with a reason.
- Invalid header values.
- The `Content-Encoding` exemption at `read-body.ts:28`.
- Real error bodies through `read-body.ts:33-48`; the mock has no `body`.
- `getValue` first-param stop, and FileData filtered by `stringOnly`.
- `System.String` numeric round trip.
- `handle-files.ts:99`, extras with no files.
- `setMaxConcurrent`, which has no test at all.
- Guard `compute-server-stats.ts:534`, unreachable by both dispose tests.

### Low

**17. Drive-relative names pass the zip-slip filter.** `handle-files.ts:124` drops `C:` but not
`C:evil.txt` or `D:folder`, a path that escapes the extraction root on Windows. Reject any segment
matching `^[a-zA-Z]:`.

**18. `runSolve` crashes on a `null` body.** `solve.ts:179` destructures it: raw `TypeError` from the
public function. `fetchDefinitionIO` guards the same case, but `definition-io.ts:47` reports it as
`INVALID_INPUT` rather than `INVALID_RESPONSE`.

**19. `describeDefinition` puts a short URL, token included, into error context.**
`grasshopper-client.ts:49`. Strip the query.

**20. Cache written after dispose.** `solve-scheduler.ts:604` has no disposed check, so an executor
resolving late repopulates the cleared cache (`entries: 1` after `dispose()`).

**21. `ComputeServerStats` keeps the header bug the cleanup audit fixed for solves.**
`compute-server-stats.ts:67-70` spreads `Content-Type` over caller headers, so a lowercase caller key
sends `text/plain, application/json`. It also sends `Content-Type` on every GET, which forces a CORS
preflight (read, not run in a browser). Drop it from GETs.

**22. Dual-package state.** `ComputeError` and the logger are separate between `core.js` and
`core.cjs`: `instanceof` fails across formats and `setLogger` reaches one. Worth deciding whether CJS
stays.

**23. `fetchRemoteFiles` has no size limit and follows redirects.** `handle-files.ts:189`. Nothing in
the monorepo passes `additionalFiles`, so external callers only.

**24. JSDoc that contradicts the code.**

- `grasshopper-response-processor.ts:82`: the `{ name, data }` example is not a `FileBaseInfo`.
- `validate-server-url.ts:19-20`: "the same way everywhere"; `fetchCompute` passes `blockedHosts: []`.
- `classify-probe-failure.ts:32-37`: false for undici (finding 1).
- `core/types.ts:42`: the warning fires with no API key too.
- `grasshopper-response-processor.ts:70-72`: there is no download directory, only a zip name.
- typedoc reports four unresolved `{@link}`s and an unknown `@requires` tag.

**25. Outside compute.** `packages/solve/package.json:78` publishes `@selvajs/schemas` as
`workspace:*`, unlike its sibling edges.

## 4. Decisions that still need a human

- **Contract machinery: delete it.** Remove the parser, `.d.mts`, snapshot, script, offline tests and
  both `contract:*` scripts; keep the two `*.live.test.ts` files. It pins a branch the client has
  moved past (finding 13), and its parser cannot read `8.x.selva`. Scheduling it means choosing the
  production branch and rewriting a C# regex parser first.
- **Public API in 5.0.** Remove `getParamName`, `flatten`, `getConfig` and `getMaxConcurrent` after the
  Consumer A check; `getConfig` also hands out the API key. Keep `replaceTreeValue`, `getTreeValue`,
  `appendFlat`, `processInput`, `DEFAULT_BLOCKED_HOST`, and the child-control methods: they wrap
  documented proxy endpoints beside `shutdownChildren`, which `selva` uses.
- **Boundary casing normalization: no.** Keep `readField`. The public `DataTree` stays as it is; the
  change breaks `visualization` and `selva` silently and leaves most readers in place.
- **`provenance: false`: remove it.** No reason is recorded and it has no effect today. A move to
  plain `npm publish` could make it start working.
- **Monorepo items: file them apart from this plan.** `@types/node` is a one-line issue. The `tsdown`
  preset belongs with the `minify` and `platform` decisions. Relative imports only pay with
  `selva-source`, so decide that for `compute`, `solve` and `visualization` together.
- **`minify`: drop it.** Readable class names and stack traces outweigh 200 KB that bundlers remove
  anyway. It applies to all three `tsdown` packages.
- **Test cuts: apply section 1 first.** Together with section 2 it replaces the review's verdict columns,
  IO rows included.
- **CJS: decide with finding 22.** If no consumer needs it, ESM-only removes the dual-state hazard and
  the `.d.cts` copies. Consumer A's pin makes this a question for that check.
