---
'@selvajs/visualization': patch
---

Fix `initThree`'s `edges` options being silently dropped: `maxTriangles`, `maxSegments` and
`screenSpaceFallback` never reached the edge pipeline.

All three are documented on `EdgesConfig` and read at runtime — `applyEdges` forwards the two caps to
`addEdgesAsync`, and `updateEdgeFallback` checks `screenSpaceFallback` before switching the
screen-space edge pass on. But `applyDefaults` never copied them out of the caller's options, so they
resolved to `undefined` on every viewer: the triangle cap was pinned to its 4M default (a host could
neither lower it to protect a weak GPU nor raise it), and `screenSpaceFallback: false` did nothing.

`ResolvedOptions` is `Required<>` only at the top level, so `edges` kept `EdgesConfig`'s optional
members and the omission type-checked. `applyDefaults` now passes the three through — left
`undefined` when unset, so `resolveOptions` in `edges/options.ts` stays the single owner of the 4M /
2M defaults instead of a second copy free to drift. A regression test asserts every `EdgesConfig` key
survives resolution.

Found by GPU-verifying the screen-space edge pass in a real browser, which no unit test can cover.
