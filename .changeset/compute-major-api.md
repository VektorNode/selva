---
'@selvajs/compute': major
---

The public API changes in one major. Migration:

- **No root entry.** `import '@selvajs/compute'` fails; import `@selvajs/compute/core` or `@selvajs/compute/grasshopper`.
- **`/grasshopper` no longer re-exports `/core`.** Import `extractFilesFromComputeResponse`, `downloadFileData`, `ProcessedFile`, `FileData`, `FileBaseInfo`, `isDefinitionRef`, `DefinitionRef` and `SolveDefinition` from `/core`. `OutputType` and `GrasshopperRequestSchema` are gone.
- **`/core` no longer exports `getResponseWireSize` / `setResponseWireSize`.**
- **`new GrasshopperResponseProcessor(response)`** takes no `debug` argument, and the `debug` property is gone.
- **`'parallel'` scheduler mode is gone.** Use `{ mode: 'queue', maxConcurrent: 4 }`; an unknown mode throws `INVALID_CONFIG`.
- **`new SolveScheduler(executor, config, options)`** takes one executor, `(definition, tree, cacheKey | null, config) => { response, cacheKey, missed }`. `GrasshopperClient.createScheduler()` is unchanged.
- **`GrasshopperClient.create(config, { probe })`**: the liveness probe has its own ladder (defaults 2 retries, 250 ms, 1000 ms). `config.retry` no longer shortens it.
- **`TreeBuilder`**:
  - `getTreeValue` and `replaceTreeValue` take `DataTree[]` only, and match `ParamName` in any casing.
  - `getTreeValue` throws `INVALID_INPUT` when the param has more than one branch; read those with the new `getTree`.
  - `appendSingle`, `getInnerTree`, `fromInputParam`, `getPaths` and `getPath` are removed.
- **`ComputeError.missingValues` / `unknownParamType` are removed.** `originalError` accepts any thrown value.
- **Repeated `getValue` / `getValues` reads of one response return fresh objects**; they were shared.
- **`rhino3dm` is no longer a dependency.** Install it yourself to decode geometry.

Added:

- `scheduler.solveDetailed()` resolves `{ response, fromCache, definitionReuploaded, durationMs }` for that call and takes a per-call `onServerTiming`.
- `TreeBuilder.getTree(trees, paramName)` returns the whole tree as a `Map` from branch path to items.
- `TreeBuilder.fromValues(entries)` builds trees from plain values: Number, Integer and Boolean items are coerced and clamped, values it can't coerce are dropped, every other type passes through.
- Exports: `disposeRhinoObjects`, `isRhinoDecodeError`, `RhinoDecodeError`, `ColorInputType`, `InputParseError`, `ServerVersion`, `ServerStats`, `TreeValueEntry`, `SolveDetail`, `SchedulerSolveOptions`, `SolveExecutor`, `CreateClientOptions`.
