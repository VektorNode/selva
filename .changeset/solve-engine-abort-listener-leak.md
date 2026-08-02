---
'@selvajs/solve': patch
---

`SolveEngine.solve()` now removes the abort listener it attaches to the caller's signal once the
solve settles. `{ once: true }` only bounds how often a listener fires, not how long it stays
attached, so every completed solve left one behind on a signal that outlives the call. A request
signal fires `abort` after the response is consumed, and a session-scoped `AbortController` never
settles at all — on that second shape the listeners accumulated without bound and Node warned at 11.

Also simplified the mesh-extraction branch in `createComputeFetchSolveFn`, which checked the
`meshes` option twice and re-tested a value `getRhino()` already guards.
