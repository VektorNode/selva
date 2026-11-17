---
'@selvajs/solve': minor
'@selvajs/server': minor
---

`SolveEngine.solve` takes `boundValues`: values for `server`-sourced inputs, by input id, that the host resolved. They fill the input tree in place of the schema default; posted `values` still never reach such an input. `resolveBoundValues(schema, resolver, ctx, scope)` in `@selvajs/server/compute` builds them from an `IBindingResolver` in one batched call. A host no longer needs to clear `serverSourced` to fill these inputs.
