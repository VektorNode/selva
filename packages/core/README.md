# Rhino Compute Core

[![npm version](https://img.shields.io/npm/v/rhino-compute-core)](https://www.npmjs.com/package/rhino-compute-core)
[![npm downloads](https://img.shields.io/npm/dm/rhino-compute-core)](https://www.npmjs.com/package/rhino-compute-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

A modern, type-safe TypeScript library for interacting with
[Rhino Compute](https://www.rhino3d.com/compute/) servers. Run Grasshopper definitions remotely,
process geometry, and build parametric web applications with full TypeScript support.

## Why Rhino Compute Core?

- **🎯 Type-Safe** - Full TypeScript support with discriminated unions and type inference
- **🚀 Modern API** - Clean, Promise-based interface built for async/await
- **🔧 Grasshopper First** - Specialized client for Grasshopper definitions with automatic I/O
  parsing
- **📦 Lightweight** - Zero dependencies, works in Node.js and browsers
- **🛡️ Error Handling** - Rich error types with context and suggested solutions
- **⚡ Developer Experience** - Auto-discovery of parameters, validation, and intelligent defaults

## Quick Start

### Installation

```bash
npm install @rhino-compute/core
# or
yarn add @rhino-compute/core
# or
pnpm add @rhino-compute/core
```

### Basic Usage

```typescript
import { GrasshopperClient } from '@rhino-compute/core';

// Initialize client
const client = new GrasshopperClient({
  serverUrl: 'https://compute.rhino3d.com',
  apiKey: 'YOUR_API_KEY', // Optional, for hosted servers
});

// Get definition metadata
const { inputs, outputs } = await client.getIO('https://example.com/definition.gh');

// Solve with values
const result = await client.solve('https://example.com/definition.gh', {
  radius: 10,
  height: 20,
  segments: 12,
});

// Access parsed results
console.log(result.data.mesh); // Typed geometry data
console.log(result.errors); // Computation errors (if any)
console.log(result.warnings); // Computation warnings (if any)
```

## Core Features

### 🎨 Grasshopper Integration

Work with Grasshopper definitions using a clean, intuitive API:

```typescript
// Discover inputs automatically
const { inputs } = await client.getIO(definitionUrl);

inputs.forEach((input) => {
  if (input.paramType === 'Number') {
    console.log(`${input.name}: ${input.minimum} - ${input.maximum}`);
  }
});

// Solve with type safety
const result = await client.solve(definitionUrl, {
  count: 5, // Single value
  points: [
    [0, 0, 0],
    [1, 1, 1],
  ], // Array
  values: {
    // Data tree
    '{0}': [1, 2, 3],
    '{1}': [4, 5, 6],
  },
});
```

### 🔍 Type-Safe Input Processing

Inputs are automatically parsed into strongly-typed interfaces:

```typescript
interface NumericInputType {
  paramType: 'Number' | 'Integer';
  name: string;
  description: string;
  minimum?: number;
  maximum?: number;
  default: number | number[] | DataTreeDefault<number>;
}

interface TextInputType {
  paramType: 'Text';
  name: string;
  description: string;
  default: string | string[] | DataTreeDefault<string>;
}

// Discriminated union ensures type safety
if (input.paramType === 'Number') {
  console.log(input.minimum); // TypeScript knows this exists
}
```

### 🌳 Data Tree Support

Full support for Grasshopper's hierarchical data structures:

```typescript
// Single values become {0} branch automatically
await client.solve(url, { count: 5 });

// Arrays are preserved
await client.solve(url, {
  points: [
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 2],
  ],
});

// Explicit tree paths
await client.solve(url, {
  values: {
    '{0}': [1, 2, 3],
    '{0;0}': [4, 5],
    '{1}': [6, 7, 8],
  },
});
```

### 🎛️ Input Grouping & Validation

Organize inputs for UI generation:

Currently only works with fork
**[TheVessen/compute.rhino3d ](https://github.com/TheVessen/compute.rhino3d)**

```typescript
import { groupInputs } from '@rhino-compute/core';

const { inputs } = await client.getIO(url);

const grouped = groupInputs(inputs, {
  showUngrouped: true,
  capitalize: true,
});

// Result:
// {
//   "Geometry": { inputs: [...] },
//   "Settings": { inputs: [...] },
//   "Advanced": { inputs: [...] }
// }
```

### 🛡️ Rich Error Handling

Detailed errors with context and solutions:

```typescript
import { RhinoComputeError, ErrorCodes } from '@rhino-compute/core';

try {
  const result = await client.solve(url, values);
} catch (error) {
  if (error instanceof RhinoComputeError) {
    console.log('Error Code:', error.code);
    console.log('Status:', error.statusCode);
    console.log('Context:', error.context);
    console.log('Solutions:', error.solutions);

    if (error.code === ErrorCodes.TIMEOUT_ERROR) {
      // Handle timeout specifically
    }
  }
}
```

## Related Packages

- **`@rhino-compute/ui`** - Svelte UI components for Grasshopper definitions
- **`@compuceraptor`** - Grasshopper plugin with helper components for display and file export
- [compute fork](https://github.com/TheVessen/compute.rhino3d) - To be able to use input grouping,
  and compuceraptor plugins use this branch of compute.

## Requirements

- Node.js 16+ or modern browser
- TypeScript 5.0+ (for type safety)
- Rhino Compute server (self-hosted or Local) see guid to setup
  [Deployment to Production Servers](https://developer.rhino3d.com/guides/compute/deploy-to-iis/)

## Performance Tips

1. **Use caching** - Enable `cachesolve: true` for repeated computations
2. **Set timeouts** - Prevent hanging requests with `timeoutMs`
3. **Batch operations** - Process multiple definitions in parallel
4. **Monitor size** - Large definitions may hit request size limits

## License

[MIT](./LICENSE.md)
