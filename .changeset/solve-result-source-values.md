---
'@selvajs/solve': minor
---

`SolveResult` now carries the payload it was built from and the inputs that produced it, so a
consumer with a commit/persist step can hold onto the exact artifact it showed the user.

```ts
const driver = createRequestResponseDriver(onSolve, () => session);
// on report:
result.source; // the raw GrasshopperComputeResponse, verbatim
result.values; // the input set that produced it
```

Both are optional and default to `unknown`/absent, so nothing existing changes shape.
`createComputeFetchSolveFn` populates `source` and narrows its return to
`SolveFn<TMesh, GrasshopperComputeResponse>`; `SolveFn`/`SolveResult` gained a matching `TSource`
parameter so that narrowing survives an explicit return-type annotation.

**Fixes a stale-result bug in the pattern this replaces.** Capturing the raw response inside your own
`SolveFn` is silently wrong behind `createRequestResponseDriver`: a memo hit serves the cached result
without ever calling the `SolveFn`. Solve A, solve B, scrub back to A — the viewer shows A while the
captured response is still B's, and a commit path freezes that mismatch. The driver stamps `values`
onto the result before storing it, so both fields travel through the memo with the result they belong
to.
