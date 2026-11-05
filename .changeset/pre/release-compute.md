---
'@selvajs/compute': major
---

Smaller public API, ESM only, and security hardening of the solve path.

**Breaking**

- No root entry: import `@selvajs/compute/core` or `@selvajs/compute/grasshopper`. `/grasshopper` no longer re-exports `/core`; import `extractFilesFromComputeResponse`, `downloadFileData`, `ProcessedFile`, `FileData`, `FileBaseInfo`, `isDefinitionRef`, `DefinitionRef` and `SolveDefinition` from `/core`.
- ESM only. On Node 24 a CommonJS project can still `require()` it.
- `rhino3dm` is no longer a dependency; install it yourself to decode geometry.
- Redirects are not followed, since fetch keeps a custom API key header across origins. A 3xx rejects with `INVALID_CONFIG` and names the target in `context.location`.
- Solve-cache keys are SHA-256 (`hashSolveInput`, `hashDefinition` return a new format), so a durable cache keyed by them misses once.
- `fetchCompute`, `solveGrasshopperDefinition` and `fetchDefinitionIO` validate `serverUrl` before any request.
- The `'parallel'` scheduler mode is gone: use `{ mode: 'queue', maxConcurrent: n }`. `new SolveScheduler(executor, config, options)` takes one executor. `GrasshopperClient.create(config, { probe })` has its own retry ladder.
- The `cacheerroredsolves` request option is removed.
- `TreeBuilder`: `getTreeValue` and `replaceTreeValue` take `DataTree[]` only and throw on more than one branch (use `getTree`); `appendSingle`, `getInnerTree`, `fromInputParam`, `getPaths`, `getPath`, `getParamName` and `flatten` are removed. `fromInputParams` coerces defaults like `fromValues` and drops items that fail.
- Removed: `GrasshopperClient.getConfig`, `SolveScheduler.getMaxConcurrent`, `ComputeError.missingValues` / `unknownParamType`, `OutputType`, `GrasshopperRequestSchema`, `getResponseWireSize` / `setResponseWireSize`, and the `debug` argument of `GrasshopperResponseProcessor`.
- The scheduler remembers a `Uint8Array` definition's hash by identity: pass a new buffer instead of mutating one.
- Values: repeated `getValue(s)` reads return fresh objects. A text output of `"123"` stays a string; `Int64` past 2^53 keeps its digits as a string. A solve always returns `values`. `SolveResult` loses `superseded`; `DataItem.id` is optional.
- Errors no longer carry secrets or bodies: rejected URLs show scheme and host only, `context.responseHeaders` is an allowlist, query strings are stripped, and scheduler errors no longer carry `context.key`.

**Added**

- `scheduler.solveDetailed()` with `{ response, fromCache, definitionReuploaded, durationMs }` and per-call `onServerTiming`. `ServerTiming` reads the VektorNode fork's `gh`, `recomputed` and `cacheHit`.
- `TreeBuilder.getTree` and `TreeBuilder.fromValues`.
- `ComputeConfig.maxResponseBytes` (`RESPONSE_TOO_LARGE`) and `ComputeConfig.fetch` for long solves on Node.
- Request bodies of 1 KB or more are gzipped for servers that advertise it.
- `downloadFileData(…, { saveBlob })` for WebViews where anchor downloads don't work.
- Cancellation reaches `DefinitionRef.load()`, `create()` and `probeServer`; `client.dispose()` disposes its schedulers.

**Fixed**

- A timeout or abort during the body download rejects as `TIMEOUT_ERROR` / `ABORTED`, not a retryable `NETWORK_ERROR`.
- The liveness probe authenticates with the client's auth settings and treats a root redirect as online.
- List-access input defaults expand into branches. `TreeBuilder` handles any branch length. Prototype-named outputs and archive files are kept. Step sizes ignore float noise.
- `dist` is no longer minified.
