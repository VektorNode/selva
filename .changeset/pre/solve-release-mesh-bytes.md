---
'@selvajs/solve': patch
---

`createComputeFetchSolveFn` drops the mesh bytes from a binary result's `source` once `meshes.extract` has built them. The last result and every memoized one kept a reference to the whole response frame, and the memo's byte cap never counted it.
