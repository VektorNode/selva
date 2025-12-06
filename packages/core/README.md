# @selva/core

TypeScript library for Rhino Compute integration with Grasshopper.

## Installation

```bash
npm install @selva/core
```

## Features

- Grasshopper definition solving via Rhino Compute
- Geometry parsing and serialization (rhino3dm)
- Three.js visualization helpers
- File format conversion utilities

## Usage

```typescript
import { GrasshopperClient } from '@selva/core/grasshopper';

const client = new GrasshopperClient({
  url: 'http://localhost:5000',
  apiKey: 'your-api-key'
});

const result = await client.solve('definition.gh', {
  'slider': 0.5
});
```

## Exports

- `@selva/core` - Full library
- `@selva/core/grasshopper` - Grasshopper client and types
- `@selva/core/visualization` - Three.js helpers
- `@selva/core/files` - File utilities
- `@selva/core/core` - Core utilities

## Requirements

- Node.js >= 16
- Optional: `three` >= 0.160.0 for visualization features

## License

MIT
