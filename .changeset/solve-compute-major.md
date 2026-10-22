---
'@selvajs/solve': major
---

Built against the `@selvajs/compute` major.

- **`transformInputParameter` is removed.** `buildSolveInputTree` (now in `transform-input`) builds the tree with `TreeBuilder.fromValues`, which changes what a solve sends:
  - `generic` inputs reach the solve; they were dropped.
  - A value compute can't coerce is left out, so Grasshopper keeps its own value: `'abc'` for a number used to send `0` (or the minimum), and `['abc']` used to send `"abc"`.
  - Text and Color values pass through unchanged. File strings pass through. Numbers are no longer snapped to step decimals.
- **`CachedClient` is `{ client, scheduler }`.** `solveMeta` and `rhinoTiming` are gone: the pipeline reads each solve's cache verdict and Rhino timing from `scheduler.solveDetailed()`, so overlapping solves no longer drop their `selva_cache`, `def_reupload` and `rhino_*` Server-Timing entries.
