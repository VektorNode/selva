---
'@selvajs/compute': minor
---

`onServerTiming` gets the VektorNode fork's `X-Compute-Profile` as `timing.profile`: the objects a solve spent longest in, slowest first (`ComputeProfileEntry`). It reaches `@selvajs/solve`'s `metrics.rhino` too, so a server logging those sees which component made a solve slow.
