---
'@selvajs/solve': patch
---

`createComputeFetchSolveFn` drops the mesh bytes from a binary result's `source` once `meshes.extract` has built them. The last result and every memoized one kept a reference to the whole response frame, and the memo's byte cap never counted it. `SolveEnvelope` keeps its deprecated `encoding` field next to `variant`, so code that reads it compiles as before; code that builds an envelope must set `variant`.
