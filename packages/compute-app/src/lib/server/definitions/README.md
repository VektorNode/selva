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

### Filesystem

```bash
GH_DEFINITIONS_PATH=./definitions
# Reads from ./definitions/ + definitions-config.json
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
	// Path to definitions directory
	// Default: './definitions'
	definitionsPath?: string;

	// Allowed file types
	// Default: ['gh', 'ghx']
	supportedExtensions?: ('gh' | 'ghx')[];
}
```

### Examples

```typescript
// Default path
const container = getDefinitionContainer();

// Custom path
const container = getDefinitionContainer({
	definitionsPath: '/opt/grasshopper-defs'
});
```

## Configuration Priority

1. Explicit `definitionsPath` in config → Use that path
2. `GH_DEFINITIONS_PATH` environment variable → Use that path
3. Default → `./definitions`

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

| Variable              | Default         | Purpose                    |
| --------------------- | --------------- | -------------------------- |
| `GH_DEFINITIONS_PATH` | `./definitions` | Definitions directory path |

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

## Common Questions

**Q: Do I use loaders or containers?**
A: Containers in routes (99% of code). Loaders only for testing individual implementations.

**Q: How do I customize the definitions path?**
A: Set `GH_DEFINITIONS_PATH` environment variable or pass `definitionsPath` in config.
