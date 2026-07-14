---
'@selvajs/platform': minor
---

Export the durable L2 solve-result cache contract from the platform barrel:
`ISolveResultCache`, `SolveCacheKey`, `SolveCacheSetOptions`, and the
`NoopSolveResultCache` default (from `./solveCache/interface.js`).

These types already lived in the platform source (added with the advanced-caching
work) but were never carried by a platform release — the `quiet-snakes-press`
changeset bumped `@selvajs/server`/`@selvajs/selva`/`@selvajs/ui` but not
`@selvajs/platform`. As a result the published `@selvajs/platform@0.14.3-beta.0`
tarball shipped no `solveCache` files, while `@selvajs/server@0.2.0-beta.3`'s
`memory-solve-cache` d.ts does `import type { ISolveResultCache } from
'@selvajs/platform'` — so a consumer that imports `createMemorySolveResultCache`
fails to typecheck against the published platform. This release publishes the
interface so the server package's L2 backend resolves its type contract.
