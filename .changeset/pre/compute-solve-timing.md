---
'@selvajs/compute': minor
'@selvajs/solve': minor
---

`ServerTiming` reads three more fields that a VektorNode-fork Rhino.Compute sends: `gh` (the part of `solve` spent inside Grasshopper), `recomputed` (`{ ran, total }` objects) and `cacheHit` (the server answered from its result cache). A cache hit now reaches `onServerTiming`; it carries no durations, so the callback used to stay silent.

The solve pipeline's `Server-Timing` adds `rhino_gh`, `rhino_recomputed` and `rhino_cache` (1 on a compute cache hit) beside the other `rhino_*` entries.
