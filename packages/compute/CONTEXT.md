# CONTEXT

The names `@selvajs/compute` uses for its concepts and seams. When a module is named after a
concept, it is the concept named here.

## Vocabulary

- **Definition**: a Grasshopper `.gh` file. Sent as a URL (`pointer`), as bytes or base64
  (`algo`), or held as a `DefinitionRef`: a stable key plus a lazy `load()`. `SolveDefinition` is
  the union.
- **Solve**: one request that sends a definition and its input data trees to Rhino Compute and
  gets computed values back.
- **Data tree**: Grasshopper's value structure, items under branch paths like `{0}`, `{0;1}` or
  the root `{}`. Inputs and outputs both travel as `DataTree[]`; `TreeBuilder` builds and reads
  them. `isDataTreeDefault` in `data-tree/tree-path.ts` is the one test for "is this tree-shaped?".
- **IO**: the inputs and outputs a definition declares. `getIO` fetches and parses them.
- **Input param**: one declared input, parsed into a typed member of the `InputParam` union.
- **Input-type parser**: the per-`paramType` adapter that turns one raw input schema into an
  input param, with its own fallback for bad input. Adding one:
  [compute-contributing.md](../../docs/contributing/compute-contributing.md#adding-an-input-param-type).
- **Transport**: `fetchCompute`, the HTTP layer. Owns retries, backoff, timeout and abort, and
  the status-to-`ErrorCodes` mapping. The caller names the response type (`fetchCompute<R>`), so
  `core/` never imports a feature.
- **Scheduler**: runs solves over time (`latest-wins`, `queue`, `parallel`) with cancellation,
  retries, a response cache and observable state.
- **Server definition-cache reuse**: the server answers an uploaded definition with an `md5_…`
  cache key, and the scheduler sends that key as `pointer` instead of the bytes on later solves of
  the same definition. It is neither the scheduler's response cache nor the server's `cachesolve`.
- **Response processor**: reads computed values out of a solve response.
- **Decoder**: turns one typed output item (a system type or Rhino geometry) into a JS value.

## Core seams

The transport in `core/` knows no backend. What a backend needs arrives through three seams; add
a fourth here rather than naming a backend inside `core/`:

- `ComputeConfig.apiKeyHeader`: the name of the header that carries `apiKey` (default
  `RhinoComputeKey`).
- `ComputeConfig.serverErrorCodes`: the backend's wire error codes mapped to `ErrorCodes`,
  outranking the status mapping. Grasshopper's table is in `grasshopper/solve.ts`.
- `validateServerUrl(url, { blockedHosts })`: the shared public endpoint a caller must not target
  (default `compute.rhino3d.com`).

Two parts of `core/` are Rhino Compute-shaped all the same: the partial-success parsing of a 500
body in `compute-fetch/response.ts`, and `core/files/` (Selva's Sub Folder convention).

`ComputeServerStats` probes rhino.compute's control plane, so it ships from `/grasshopper`.
`DefinitionRef` and `SolveDefinition` hold nothing Grasshopper-specific and sit in the solve
signature, so they live in `/core`.
