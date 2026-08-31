# DataTree Utilities

Utilities for working with Grasshopper's hierarchical data tree structure.

## Overview

Grasshopper uses a tree structure to organize data with branch paths like `{0}`, `{0;1}`, `{1;2;3}`. `TreeBuilder` provides a fluent API to create, manipulate, and convert data trees for use with Rhino Compute.

## Basic Usage

```typescript
import { TreeBuilder } from '@selvajs/compute/grasshopper';

// Create a simple flat tree
const tree = new TreeBuilder('MyParameter').appendFlat([1, 2, 3, 4, 5]).toComputeFormat();

// Create a multi-branch tree
const complexTree = new TreeBuilder('Points')
	.append([0], [{ x: 0, y: 0, z: 0 }])
	.append([0, 1], [{ x: 1, y: 1, z: 1 }])
	.append([1], [{ x: 2, y: 2, z: 2 }])
	.toComputeFormat();
```

## Common Use Cases

### Convert InputParams to DataTrees

The most common pattern—convert definition inputs to trees for solving:

```typescript
// Get inputs from a definition
const { inputs } = await client.getIO('https://example.com/definition.gh');

// Convert all inputs to trees (handles constraints, tree access, etc.)
const trees = TreeBuilder.fromInputParams(inputs);

// Send to compute
const result = await client.solve(definitionUrl, trees);
```

### Build Custom Trees

```typescript
const tree = new TreeBuilder('Values').fromDataTreeDefault({
	'{0}': [1, 2, 3],
	'{0;0}': [4, 5],
	'{1}': [6, 7, 8]
});

// Query the tree
const paths = tree.getPaths(); // ['{0}', '{0;0}', '{1}']
const values = tree.getPath([0, 0]); // [4, 5]
const allValues = tree.flatten(); // [1, 2, 3, 4, 5, 6, 7, 8]
```

### Modify Inputs Before Solving

```typescript
const { inputs } = await client.getIO('definition.gh');

// Override default values
const modifiedInputs = inputs.map((input) => {
	if (input.name === 'radius') return { ...input, default: 25 };
	if (input.name === 'height') return { ...input, default: 50 };
	return input;
});

// Numeric constraints are automatically applied
const trees = TreeBuilder.fromInputParams(modifiedInputs);
const result = await client.solve('definition.gh', trees);
```

## Best Practices

- **Use `TreeBuilder.fromInputParams()`** for most cases—it handles constraints, tree access, and formatting automatically.
- **Call `toComputeFormat()` before sending** to ensure compatibility with Rhino Compute.
- **Use the fluent API** for custom tree building when needed.
