# Grasshopper Feature

This module provides a complete TypeScript interface for working with Grasshopper definitions
through Rhino Compute.

## Quick Start

```typescript
import { GrasshopperClient, TreeBuilder, GrasshopperResponseProcessor } from '@selvajs/compute';

// The constructor is private — create() validates the server is reachable first.
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

A complete runnable version of this flow lives in
[`examples/simple_example.ts`](../../../examples/simple_example.ts).

## Core Concepts

### 1. Definition I/O

Every Grasshopper definition has inputs (parameters you can set) and outputs (results it produces).
This library automatically discovers and types these for you.

### 2. Data Trees

Grasshopper uses a hierarchical data structure called "data trees" to organize information. Inputs
and outputs travel as `DataTree[]`; `TreeBuilder` builds and edits them without hand-writing branch
paths.

### 3. Type Safety

Raw API responses are transformed into strongly-typed TypeScript interfaces, giving you autocomplete
and compile-time validation.

## Module Structure

```
grasshopper/
├── client/              # High-level GrasshopperClient class + response processor
├── solve.ts             # Low-level solve operation
├── io/                  # Input/output handling
│   ├── input/           # Input parsing: normalize-default, input-type-parsers, input-processors
│   └── output/          # Output response processing
├── data-tree/           # Data tree utilities (TreeBuilder)
├── scheduler/           # Solve scheduling (latest-wins / queue / parallel)
├── types.ts             # TypeScript type definitions
└── index.ts             # Public API exports
```

> Generic file zip/base64/download utilities live in [`core/files/`](../../core/files/)
> (not Grasshopper-specific); only `extractFileData` — which reads a Grasshopper
> response — stays here, in `io/output/`.

## Key Features

### Input Processing

- **Type Detection** - Automatically identifies Number, Text, Boolean, Geometry, etc.
- **Validation** - Enforces min/max bounds, required fields
- **Defaults** - Handles default values, including data trees

### Output Processing

- **Parsing** - Converts string responses to typed JavaScript objects
- **Data Trees** - Flattens or preserves Grasshopper's tree structure
- **Error Handling** - Captures and reports computation errors/warnings

### Compute Operations

- **Caching** - Optional server-side result caching
- **Timeouts** - Configurable request timeouts
- **Debug Mode** - Detailed logging for troubleshooting

## Usage Examples

### Basic Solve

```typescript
const { inputs } = await client.getIO('https://example.com/box.gh');

const inputTree = TreeBuilder.fromInputParams(inputs);
TreeBuilder.replaceTreeValue(inputTree, 'width', 5);
TreeBuilder.replaceTreeValue(inputTree, 'height', 10);
TreeBuilder.replaceTreeValue(inputTree, 'depth', 3);

const result = await client.solve('https://example.com/box.gh', inputTree);

// Extract parsed outputs (keyed by output parameter name)
const { values } = new GrasshopperResponseProcessor(result).getValues();
```

### Working with Data Trees

```typescript
// Single values and arrays both go through replaceTreeValue
TreeBuilder.replaceTreeValue(inputTree, 'count', 5);
TreeBuilder.replaceTreeValue(inputTree, 'points', [
	[0, 0, 0],
	[1, 1, 1],
	[2, 2, 2]
]);

// Read a value back out of a tree
const count = TreeBuilder.getTreeValue(inputTree, 'count');
```

See [`data-tree/README.md`](data-tree/README.md) for branch paths and multi-branch trees.

### Per-Call Options

```typescript
// Cancel or bound an individual solve without touching the client config
const controller = new AbortController();
const result = await client.solve(definitionUrl, inputTree, {
	signal: controller.signal,
	timeoutMs: 120_000
});
```

### Error Handling

```typescript
import { RhinoComputeError } from '@selvajs/compute';

try {
	const result = await client.solve(definitionUrl, inputTree);

	if (result.errors?.length) {
		console.error('Computation errors:', result.errors);
	}

	if (result.warnings?.length) {
		console.warn('Computation warnings:', result.warnings);
	}
} catch (error) {
	if (error instanceof RhinoComputeError) {
		console.error('Code:', error.code);
		console.error('Context:', error.context);
	}
}
```

## API Reference

### GrasshopperClient

High-level client for Grasshopper operations.

```typescript
const client = await GrasshopperClient.create(config);

// Fetch parsed definition metadata: { inputs, outputs, parseErrors }
await client.getIO(definition); // definition: URL string, base64 string, or Uint8Array

// Solve with a data tree
await client.solve(definition, dataTree, options?); // → GrasshopperComputeResponse

// Release resources (pending schedulers etc.)
await client.dispose();
```

## Advanced Topics

### Custom Input Parsers

See [`io/input/README.md`](io/input/README.md) for how to add support
for new Grasshopper parameter types (the `InputTypeParser` registry).

### Data Tree Manipulation

See [`data-tree/README.md`](data-tree/README.md) for utilities to work with
Grasshopper's data tree structure.

### Response Processing

See [`io/output/response-processors.ts`](io/output/response-processors.ts) for how output parsing
works.

## Configuration Options

```typescript
interface GrasshopperComputeConfig {
	// Required
	serverUrl: string;

	// Optional
	apiKey?: string;
	authToken?: string;
	timeoutMs?: number;
	debug?: boolean;
	suppressBrowserWarning?: boolean;

	// Grasshopper-specific
	cachesolve?: boolean;
	absolutetolerance?: number;
	angletolerance?: number;
	modelunits?: RhinoModelUnit;
}
```

## Related Documentation

- [Input Parsers](io/input/README.md) - Extending input type support
- [Core Types](types.ts) - Complete type definitions
- [Compute Fetch](../../core/compute-fetch/) - Low-level HTTP operations

## Examples

See [`examples/`](../../../examples/) for complete working examples, starting with
[`simple_example.ts`](../../../examples/simple_example.ts) (client creation → getIO → TreeBuilder →
solve → response processing).
