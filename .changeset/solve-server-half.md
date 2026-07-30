---
'@selvajs/solve': minor
'@selvajs/server': major
'@selvajs/selva': patch
---

The solve core moves out of `@selvajs/server/compute` into `@selvajs/solve/server`, so the whole
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
