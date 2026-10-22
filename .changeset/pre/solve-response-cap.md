---
'@selvajs/solve': patch
---

`SolveEngine` stops downloading a compute response once it passes `computeResponseMaxBytes`, and returns `too_large`. It used to read and parse the whole body before checking its size. `ClientCacheConfig` takes the cap as an optional `maxResponseBytes`.
