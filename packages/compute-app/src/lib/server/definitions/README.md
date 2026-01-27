# Definition Loading System (Dependency Injection)

A production-ready DI system for loading Grasshopper definitions from any source without changing application code.

## Quick Start

```typescript
import { getDefinitionContainer } from '$lib/server/definitions.server';

const container = getDefinitionContainer();
const definitions = await container.listDefinitions();
```

## How It Works

**Container** (what you use) → wraps → **Loader** (implementation detail)

- **Loaders**: Know HOW to fetch from a specific source (filesystem, environment vars, S3, etc.)
- **Container**: Provides a clean, unified API that doesn't care which loader is underneath

## Supported Sources

### Filesystem (Default)

```bash
GH_DEFINITIONS_PATH=./definitions
# Reads from ./definitions/ + definitions-config.json
```

### Environment Variables (Cloud-Ready)

```bash
DEFINITION_SOURCE=environment
GH_DEF_PREFIX=GH_DEF_
GH_DEF_solver.gh='{"metadata":{"displayName":"Solver"},"url":"https://..."}'
```

### Custom Sources (S3, Database, GraphQL, etc.)

```bash
DEFINITION_SOURCE=yoursource
# See "Creating a Custom Loader" section below
```

## Container API

```typescript
const container = getDefinitionContainer();

// Get all definitions
await container.listDefinitions(); // Definition[]

// Get specific definition
await container.getDefinition('solver.gh'); // Definition

// Load binary data
await container.loadDefinition('solver.gh'); // Uint8Array

// Get definition URL
await container.getDefinitionUrl('solver.gh'); // string

// Get first available
await container.getFirstDefinition(); // Definition | null
```

## Configuration

### DefinitionFactoryConfig

```typescript
interface DefinitionFactoryConfig {
	// Which loader: 'filesystem' or 'environment' (auto-detects if omitted)
	source?: 'filesystem' | 'environment';

	// Path to definitions directory (filesystem only)
	// Default: './definitions'
	definitionsPath?: string;

	// Allowed file types (filesystem only)
	// Default: ['gh', 'ghx']
	supportedExtensions?: ('gh' | 'ghx')[];
}
```

### Examples

```typescript
// Auto-detect (recommended)
const container = getDefinitionContainer();

// Custom filesystem path
const container = getDefinitionContainer({
	source: 'filesystem',
	definitionsPath: '/opt/grasshopper-defs'
});

// Environment loader
const container = getDefinitionContainer({
	source: 'environment'
});
```

## Auto-Detection Priority

1. `DEFINITION_SOURCE=environment` + `GH_DEF_PREFIX` → EnvironmentLoader
2. `GH_DEFINITIONS_PATH` set → FilesystemLoader
3. `GH_DEF_*` environment variables exist → EnvironmentLoader
4. Default → FilesystemLoader with `./definitions`

## Creating a Custom Loader

### 1. Create the Loader

`loaders/yourname.ts`:

```typescript
import type { IDefinitionLoader, Definition, DefinitionMetadata } from '../types';

export class YourDefinitionLoader implements IDefinitionLoader {
	constructor(private config: YourConfig) {}

	async listDefinitions(): Promise<Definition[]> {
		return [
			{
				filename: 'example.gh',
				fileType: 'gh',
				displayName: 'Example',
				description: 'An example'
			}
		];
	}

	async getMetadata(filename: string): Promise<DefinitionMetadata> {
		return { displayName: 'Example', description: 'An example' };
	}

	async loadDefinition(filename: string): Promise<Uint8Array> {
		const response = await fetch(`https://storage.example.com/${filename}`);
		return new Uint8Array(await response.arrayBuffer());
	}

	async getDefinitionUrl(filename: string): Promise<string> {
		return `https://storage.example.com/${filename}`;
	}
}
```

### 2. Register in Factory

`factory.ts`:

```typescript
import { YourDefinitionLoader } from './loaders/yourname';

// In createLoader() method, add:
case 'yourname':
  return new YourDefinitionLoader({ /* config */ });
```

### 3. Use It

```bash
DEFINITION_SOURCE=yourname
```

Routes work unchanged:

```typescript
const container = getDefinitionContainer();
const defs = await container.listDefinitions();
```

## File Types

- `.gh` - Grasshopper 7
- `.ghx` - Grasshopper 8

Both supported by all loaders.

## Security

- URLs kept server-side (never exposed to client)
- Filenames validated (no directory traversal)
- File types restricted (.gh, .ghx only)
- Only metadata sent to browser

## Testing

```typescript
import { FilesystemDefinitionLoader } from './loaders/filesystem';

const loader = new FilesystemDefinitionLoader({
	definitionsPath: './test-definitions'
});

const definitions = await loader.listDefinitions();
expect(definitions.length).toBeGreaterThan(0);
```

## Environment Variables Reference

| Variable              | Default         | Purpose                                        |
| --------------------- | --------------- | ---------------------------------------------- |
| `DEFINITION_SOURCE`   | auto-detect     | Source: `filesystem`, `environment`, or custom |
| `GH_DEFINITIONS_PATH` | `./definitions` | Filesystem loader path                         |
| `GH_DEF_PREFIX`       | `GH_DEF_`       | Prefix for env vars (environment loader)       |

## Architecture

```
Routes (your code)
    ↓
DefinitionContainer (unified API)
    ↓
IDefinitionLoader (interface)
    ↓
Loaders (implementations)
├─ FilesystemDefinitionLoader
├─ EnvironmentDefinitionLoader
└─ Your custom loaders
```

## Key Principles

✅ **Decoupled** - Interfaces separate from implementation
✅ **Extensible** - Add new sources without modifying routes
✅ **Testable** - Each loader tested independently
✅ **Type-safe** - Full TypeScript support
✅ **Secure** - URLs and tokens server-side only
✅ **Simple** - Single API for all sources

## Real-World Examples

### S3 Loader

See `loaders/EXAMPLE.md` for complete implementation.

### Database Loader

1. Implement `IDefinitionLoader` fetching from your DB
2. Add case in factory
3. Set `DEFINITION_SOURCE=database`

## Common Questions

**Q: Do I use loaders or containers?**
A: Containers in routes (99% of code). Loaders only for testing individual implementations.

**Q: How do I switch definition sources?**
A: Set `DEFINITION_SOURCE` env var. Routes work unchanged.

**Q: Can I use multiple sources?**
A: No, but you can switch between them via env vars at deployment time.

**Q: What if my definitions are on the internet?**
A: Use environment loader or create a custom loader that fetches from your endpoint.

**Q: How do I add S3 support?**
A: Create loader in `loaders/s3.ts`, implement `IDefinitionLoader`, register in factory.
