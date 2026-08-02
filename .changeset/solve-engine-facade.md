---
'@selvajs/solve': minor
'@selvajs/selva': patch
---

`@selvajs/solve/server` gains `SolveEngine`, a facade over the four primitives a consumer previously
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
