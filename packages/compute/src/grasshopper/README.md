# `grasshopper/`: solving definitions through Rhino Compute

## Quick start

```typescript
import {
	GrasshopperClient,
	TreeBuilder,
	GrasshopperResponseProcessor
} from '@selvajs/compute/grasshopper';

const client = await GrasshopperClient.create({
	serverUrl: 'http://localhost:5000',
	apiKey: 'YOUR_API_KEY'
});

try {
	// Fetch definition inputs/outputs
	const { inputs, outputs } = await client.getIO('https://example.com/definition.gh');

	// Build the input data tree from the definition's parameters, then set values by name
	const inputTree = TreeBuilder.fromInputParams(inputs);
	TreeBuilder.replaceTreeValue(inputTree, 'radius', 10);
	TreeBuilder.replaceTreeValue(inputTree, 'height', 20);

	// Solve
	const result = await client.solve('https://example.com/definition.gh', inputTree);

	// Extract typed output values from the response's data trees
	const { values } = new GrasshopperResponseProcessor(result).getValues();
	console.log(values);
} finally {
	await client.dispose();
}
```

A runnable version of this flow lives in
[`examples/simple_example.ts`](../../examples/simple_example.ts).

## Layout

```
grasshopper/
├── client/        GrasshopperClient + GrasshopperResponseProcessor
├── solve.ts       the low-level solve call
├── io/
│   ├── input/     normalize-default, input-type-parsers, input-processors
│   └── output/    response processing, Rhino decoders, extractFileData
├── data-tree/     TreeBuilder + branch-path parsing
├── scheduler/     SolveScheduler (latest-wins / queue / parallel)
├── server/        ComputeServerStats: rhino.compute's control plane
└── types/         inputs, outputs, request/response schemas
```

Generic file zip/base64/download utilities live in [`core/files/`](../core/files/), not
Grasshopper-specific. Only `extractFileData`, which reads a Grasshopper response, stays in
`io/output/`.

## Data trees

Inputs and outputs travel as `DataTree[]`. `TreeBuilder` builds and edits them without
hand-writing branch paths:

```typescript
// Single values and arrays both go through replaceTreeValue
TreeBuilder.replaceTreeValue(inputTree, 'count', 5);
TreeBuilder.replaceTreeValue(inputTree, 'points', [
	[0, 0, 0],
	[1, 1, 1],
	[2, 2, 2]
]);

const count = TreeBuilder.getTreeValue(inputTree, 'count');
```

`fromInputParams` flattens geometry and file data-trees into one leaf: to set a value on those,
use `replaceTreeValue`. See [`data-tree/README.md`](data-tree/README.md) for branch paths and
multi-branch trees.

## Per-call options

```typescript
// Cancel or bound an individual solve without touching the client config
const controller = new AbortController();
const result = await client.solve(definitionUrl, inputTree, {
	signal: controller.signal,
	timeoutMs: 120_000
});
```

## Errors

A solve response carries `errors`/`warnings` from the definition itself; a thrown `ComputeError`
means the request failed.

```typescript
import { ComputeError } from '@selvajs/compute/core';

try {
	const result = await client.solve(definitionUrl, inputTree);
	if (result.errors?.length) console.error(result.errors);
} catch (error) {
	if (error instanceof ComputeError) console.error(error.code, error.context);
}
```

## GrasshopperClient

The constructor is private: `create()` validates the server is reachable first.

```typescript
const client = await GrasshopperClient.create(config); // GrasshopperComputeConfig

// definition: URL string, base64 string, or Uint8Array
await client.getIO(definition); // → { inputs, outputs, parseErrors }
await client.solve(definition, dataTree, options?); // → GrasshopperComputeResponse
client.createScheduler(options?); // → SolveScheduler
await client.dispose();
```

`GrasshopperComputeConfig` (in [`types/schema.ts`](types/schema.ts)) takes `serverUrl` plus
optional `apiKey`, `authToken`, `timeoutMs`, `debug`, `suppressBrowserWarning`, and the
Grasshopper-specific `cachesolve`, `absolutetolerance`, `angletolerance`, `modelunits`.

## More

- [`io/input/README.md`](io/input/README.md): adding a param type (the `InputTypeParser` registry)
- [`data-tree/README.md`](data-tree/README.md): branch paths and multi-branch trees
- [`io/output/response-processors.ts`](io/output/response-processors.ts): how output parsing works
- [`core/compute-fetch/`](../core/compute-fetch/): the low-level HTTP layer
