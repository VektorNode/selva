# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Selva is a cross-platform Rhino Grasshopper plugin with a SvelteKit web UI for building Grasshopper-driven web applications. It uses a dual-stack architecture:

- **Backend**: C# (.NET multi-target: net48/net7.0) - Grasshopper plugin
- **Frontend**: SvelteKit with TypeScript + Tailwind CSS
- **Communication**: WebSocket (port 8765) + embedded HTTP server

## Repository Structure

This is a monorepo with two distinct stacks:

### TypeScript/JavaScript Workspace (`packages/`)

- **`@selva/compute`** - Type-safe Rhino Compute client, Three.js helpers, file utilities (browser & Node.js)
- **`@selva/builder-app`** - Schema designer connected to Grasshopper via WebSocket (local dev mode)
- **`@selva/compute-app`** - Standalone app for solving Grasshopper definitions via Rhino.Compute (cloud mode)
- **`@selva/shared`** - Shared Svelte components, utilities, and theme styles (CSS + theme utilities)
- **`@selva/svelte-ui`** - Legacy UI components (being phased out)
- **`@selva/schemas`** - Schema definitions and code generators (TypeScript + C#)

### .NET Workspace (`Plugin/`)

- **`Selva.Core`** - Shared models and services (netstandard2.0)
- **`Selva.Grasshopper`** - Main plugin with components (net48/net7.0, outputs `.gha`)
- **`Selva.Tests`** - xUnit tests (net7.0)

## Common Development Commands

### JavaScript/TypeScript

```bash
# Install dependencies (required first step)
pnpm install

# Development servers
pnpm dev                    # Start builder-app dev server (http://localhost:5173)
pnpm dev:compute            # Start compute-app dev server

# Build commands
pnpm run build:all          # Build all packages in order
pnpm run build:shared    # Build shared UI components
pnpm run build:builder      # Build builder-app
pnpm run build:compute      # Build compute-app
pnpm run build:plugin       # Build production plugin with embedded web assets

# Type checking and linting
pnpm check                  # Run svelte-check on all packages
pnpm type-check             # TypeScript type check across workspace
pnpm lint                   # Lint all files
pnpm lint:fix               # Fix linting issues
pnpm format                 # Format code with Prettier
pnpm format:check           # Check formatting

# Testing (core package)
cd packages/compute && pnpm test          # Run vitest
cd packages/compute && pnpm test:watch    # Run vitest in watch mode

# Schema generation (run after modifying ui-schema.json)
cd packages/schemas && pnpm run generate:all    # Generate both TS and C# types
cd packages/schemas && pnpm run generate:ts     # Generate TypeScript only
cd packages/schemas && pnpm run generate:cs     # Generate C# only

# Clean and reinstall
pnpm clean:reinstall        # Remove all node_modules and reinstall
```

### .NET (Plugin)

```bash
cd Plugin

# Build
dotnet build                                    # Debug build
dotnet build --configuration Release            # Release build

# Test
dotnet test                                     # Run all tests
dotnet test --filter "FullyQualifiedName~SchemaMigrator"  # Run specific tests

# Clean
dotnet clean
```

## Architecture

### Type Safety End-to-End

A single schema (`packages/schemas/ui-schema.json`) generates both TypeScript types for the UI and C# types for the plugin, keeping the entire system in sync.

**Generated files:**

- TypeScript: `packages/shared/src/lib/types/generated/schema.ts`
- C#: `Plugin/Selva.Core/Models/UISchema.Generated.cs`

After modifying `ui-schema.json`, always run:

```bash
cd packages/schemas && pnpm run generate:all
```

### Web Application Modes

The web application supports two runtime modes:

1. **Local Mode (builder-app)**: Drag-and-drop schema designer connected to Grasshopper via WebSocket. Used during development with hot reload.
2. **Cloud Mode (compute-app)**: Standalone web app that solves Grasshopper definitions through Rhino.Compute. Used for production deployments.

### Production Build Process

The production build creates a **fully self-contained** `.gha` file:

1. Builds `@selva/builder-app` web assets
2. Copies built assets to `Plugin/Selva.Grasshopper/EmbeddedAssets/web/`
3. Embeds all web assets as `EmbeddedResource` in the plugin
4. Builds multi-targeted plugin (net48 for Rhino 7, net7.0 for Rhino 8)

Output: Single `.gha` file with no external dependencies. The LocalWebServer auto-allocates an HTTP port at runtime.

```bash
pnpm run build:plugin
```

### Development Workflow

**Recommended**: Web + Plugin in Dev Mode

Terminal 1:

```bash
cd packages/builder-app && pnpm dev
# Web app runs on http://localhost:5173
```

Terminal 2:

```bash
cd Plugin && dotnet build
# Then run in Visual Studio, Rider, or VS Code
# Plugin auto-connects to dev server via WebSocket (port 8765)
```

Benefits: Hot reload on web changes, debug plugin in IDE, fast iteration.

### Grasshopper Plugin Components

Located in `Plugin/Selva.Grasshopper/Features/`:

- **UIBuilder** - `UIBuilderComponent` for schema linking and WebSocket communication
- **Display** - `ThreeMaterial` for 3D web visualization configuration
- **FileIO** - `DataToFile`, `BlockToFile` for geometry export
- **ComputeIO** - `ValueListData`, `GetValueList` for interactive selections

### Core Package Architecture (`@selva/compute`)

Modular exports for tree-shaking:

- Main export: General utilities and types
- `/grasshopper`: Rhino Compute client, data tree handling, input/output parsers
- `/visualization`: Three.js helpers, WebDisplay utilities
- `/files`: File handling utilities
- `/core`: Low-level compute fetch and error handling

Key features:

- Discriminated unions for type-safe error handling
- Data tree parsing and serialization
- Three.js geometry conversion helpers
- Browser and Node.js compatible

## Code Style

- Write self-documenting code; add comments only for complex logic
- Keep code simple; avoid premature abstractions
- Only add error handling at system boundaries (user input, external APIs)

## Performance Notes

- Three.js is lazy-loaded only when 3D viewer is enabled
- `rhino-compute-core` (now `compute-rhino3d`) is dynamically imported when needed
- Use `@lucide/svelte` for all icons (tree-shakeable, no duplicates)
- Prefer consolidating utilities over creating new abstractions

## Installation to Grasshopper

After building the plugin, copy to your Grasshopper Libraries folder:

**Windows (Rhino 8):**

```bash
copy "Plugin\bin\Release\net7.0\Selva.gha" "%APPDATA%\Grasshopper\Libraries-8\"
```

**macOS (Rhino 8):**

```bash
cp Plugin/bin/Release/net7.0/Selva.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

Restart Rhino completely after installation.

## Requirements

- [pnpm](https://pnpm.io) >= 9.0.0 (Node.js package manager)
- Node.js >= 18.0.0
- .NET SDK 7.0+ (for plugin development)
- Rhino 8 (for using the plugin)
- Custom Rhino Compute fork: https://github.com/VektorNode/compute.rhino3d

## Environment Variables

Create `.env` in `packages/builder-app/` (required for build):

```
VITE_API_BASE=http://localhost:8765
```
