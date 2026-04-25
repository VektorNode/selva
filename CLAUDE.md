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

- [selva-compute](https://www.npmjs.com/package/selva-compute) - (External npm package) Type-safe Rhino Compute client, Three.js helpers, file utilities
- **`@selva/config`** - Shared ESLint, Vite, and Prettier configuration
- **`@selva/builder-app`** - Schema designer connected to Grasshopper via WebSocket (local dev mode)
- **`@selva/compute-app`** - Standalone app for solving Grasshopper definitions via Rhino.Compute (cloud mode)
- **`@selva/shared`** - Shared Svelte components, utilities, and theme styles (CSS + theme utilities)
- **`@selva/schemas`** - Schema definitions and code generators (TypeScript + C#)
- **`@selva/platform`** - Pure TypeScript interfaces for platform providers (auth, definitions, compute, storage, organizations, projects) with conformance test suites
- **`selva-local-provider`** - Filesystem/JSON/HMAC implementations of `@selva/platform` interfaces for local development

### .NET Workspace (`Plugin/`)

- **`Selva.Core`** - Shared models and services (netstandard2.0)
- **`Selva.GH`** - Main plugin with components (net48/net7.0, outputs `.gha`)
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

# Testing (selva-compute external package)
# Run tests for the selva-compute npm package (development only)
# pnpm test                  # (When selva-compute is developed locally)
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
2. Copies built assets to `Plugin/Selva.GH/EmbeddedAssets/web/`
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

Located in `Plugin/Selva.GH/Features/`:

- **UIBuilder** - `UIBuilderComponent` for schema linking and WebSocket communication
- **Display** - `ThreeMaterial` for 3D web visualization configuration
- **FileIO** - `DataToFile`, `BlockToFile` for geometry export
- **ComputeIO** - `ValueListData`, `GetValueList` for interactive selections

### Core Package Architecture (`selva-compute`)

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
- Section headers use the format: `// ============================================================================` with title between two lines of equals signs

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

## Data Privacy & Compliance

**User data isolation is by design.** All authentication, credentials, and personal information (PII) are owned exclusively by the auth provider. Selva stores only:
- Opaque session tokens (in cookies)
- User ID and permissions (minimal authorization data)
- Optional provider-specific metadata (non-sensitive only)

This architecture means Selva has **zero exposure to EU data regulations, credentials, or company user records**. The provider handles all data residency, retention, and compliance.

## Requirements

- [pnpm](https://pnpm.io) >= 9.0.0 (Node.js package manager)
- Node.js >= 18.0.0
- .NET SDK 7.0+ (for plugin development)
- Rhino 8 (for using the plugin)
- Custom Rhino Compute fork: https://github.com/VektorNode/compute.rhino3d

## Environment Variables

The authoritative reference is [packages/compute-app/.env.example](packages/compute-app/.env.example) — every var the compute-app reads (provider, tenancy, flags, secrets, optional server config) is documented inline there. Don't duplicate that documentation here or in provider READMEs; link to `.env.example`.

The builder app needs no env vars (WebSocket on port 8765 by default).

Rhino.Compute server URL + API key are configured in `/admin/compute` and persisted via `IComputeServerStore` — not env vars.

### Platform Package (`@selva/platform`)

Core provider interfaces for Selva's pluggable architecture. All modules support Zod schema validation and are granular exports for tree-shaking.

| Module | Exports | Purpose |
|--------|---------|---------|
| `@selva/platform/auth` | `IAuthProvider`, `IPasswordAuth` | Identity verification, optional password capability, user management |
| `@selva/platform/data` | `IDataProvider`, `IOrgStore`, `IProjectStore`, `IDefinitionStore`, `IShareLinkStore`, `IInviteStore`, `IComputeServerStore` | Structured data storage (all methods take `RequestContext`) |
| `@selva/platform/storage` | `IStorageProvider` | Blob storage (get, put, delete, getPublicUrl) |
| `@selva/platform/definitions` | Types, schemas, `definitionPaths` | Definition record types + path helpers. (Service orchestration lives in compute-app; see `lib/server/definitions/DefinitionService.ts`.) |
| `@selva/platform/organizations` | — | `Organization`, `OrgMember`, `OrgRole` types + Zod schemas |
| `@selva/platform/projects` | — | `Project`, `ProjectMember`, `ProjectRole`, `ProjectVisibility` types + schemas |
| `@selva/platform/computeServer` | — | `ComputeServerConfig`, `resolveComputeServer()` helpers |
| `@selva/platform/testing` | `runXxxConformance` functions (one per store) | Vitest-based conformance suites for all stores |

**Local provider** (`selva-local-provider`) implements all interfaces using the filesystem:

- `LocalAuthProvider` — HMAC tokens + optional `users.json`
- `LocalDataProvider` — Wires all stores; reads/writes JSON config files
- `LocalStorageProvider` — Filesystem blobs, auto-transcodes images to WebP via sharp
- `LocalComputeServerStore` — `compute.config.json`

## Issues

When creating issues, use the templates in [.github/ISSUE_TEMPLATE/](/.github/ISSUE_TEMPLATE/)
