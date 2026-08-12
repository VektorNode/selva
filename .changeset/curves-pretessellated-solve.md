---
'@selvajs/solve': major
---

**`ComputeFetchSolveFnOptions.meshes.loadRhino` is gone**, along with the `TRhino` type parameter
and the `rhino` field on the `extract` callback's options.

```diff
 const onSolve = createComputeFetchSolveFn({
 	endpoint: '/api/v1/compute',
 	meshes: {
-		loadRhino: () => import('rhino3dm').then((m) => m.default()),
-		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
+		extract: (response, opts) => getThreeMeshesFromComputeResponse(response, opts)
 	}
 });
```

Curves arrive pre-tessellated from the plugin (see `@selvajs/visualization`), so nothing in a
viewer decodes Rhino geometry anymore. This option was worse than unnecessary: it loaded the WASM
**unconditionally whenever `meshes` was configured** — on every viewer solve, not just those
carrying curves — so removing it is a straight win for first paint and bundle size.

There is no replacement and no fallback. A definition whose Display component predates backend
tessellation now fails the solve with an actionable error — upgrade the component in Grasshopper
(Solution → Upgrade obsolete components) and re-save.
