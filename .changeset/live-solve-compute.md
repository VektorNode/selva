---
'@selvajs/compute': minor
---

Add `selvaevents` (a `SelvaEventTarget`: callback URL, solve id, bearer) to `GrasshopperComputeConfig`, the request body, `SolveOptions` and `SolveScheduler.solve()`. The VektorNode fork hands it to the plugin so it can POST live events mid-solve; a stock server ignores it. It is not part of the scheduler's cache key.

`GrasshopperComputeResponse` gains `selva?: SelvaResponseBlock`, the plugin's verdict on the solve as returned by the fork.
