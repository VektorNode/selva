# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Style Guidelines

- Add only essential comments to code
- Avoid obvious or redundant comments
- Comment only complex logic, non-obvious decisions, or important warnings
- Prefer self-documenting code with clear variable/function names over comments

## Testing Philosophy

- Create tests that add value, not just tests for trivial functionality
- Focus on integration and workflow testing rather than unit tests for obvious code
- Use tests to document expected behavior and edge cases

## Project Overview

Selva is a cross-platform Rhino Grasshopper plugin that enables web-based UIs for parametric models using a
dual-stack architecture:

- **Backend**: C# Grasshopper components (.NET multi-target: net48/net7.0)
- **Frontend**: SvelteKit web application (TypeScript, Tailwind CSS)
- **Communication**: WebSocket (port 8765) for real-time updates + embedded HTTP server for UI delivery
- **Deployment**: Self-contained .gha file with embedded web assets (no external dependencies)

## Essential Commands

### Root-Level Commands (Monorepo)

```bash
# Install dependencies across all packages
pnpm install

# Build all packages in correct order (core → svelte-ui → web)
pnpm build:all

# Build production plugin with embedded web assets (recommended for deployment)
pnpm build:plugin

# Start web dev server for development (packages/builder → @selva/web)
pnpm dev

# Build specific package
pnpm --filter @selva/core build
pnpm --filter @selva/svelte-ui build
pnpm --filter @selva/web build

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run type checking
pnpm type-check

# Lint and format
pnpm lint
pnpm lint:fix
pnpm format
```

### Production Build (Recommended)

The `build:plugin` command orchestrates the complete production build process:

```bash
# From repository root - builds everything and creates production .gha files
pnpm build:plugin
```

**This command:**
1. Builds web application (`@selva/web`) as static assets
2. Copies web assets to `Plugin/EmbeddedAssets/web/`
3. Builds C# plugin with embedded resources for both Rhino 7 and Rhino 8
4. Outputs self-contained `.gha` files

**Output locations:**
- Rhino 7: `Plugin/bin/Release/net48/Selva.gha`
- Rhino 8: `Plugin/bin/Release/net7.0/Selva.gha`

### C# Plugin Development (Direct)

For plugin-only development without rebuilding web assets:

```bash
cd Plugin

# Build for both Rhino 7 (net48) and Rhino 8 (net7.0)
dotnet build --configuration Release

# Development build
dotnet build

# Clean build artifacts
dotnet clean
```

**Note:** Direct C# builds use existing embedded assets from `Plugin/EmbeddedAssets/web/`. Run `pnpm build:plugin` first if web assets need updating.

### Installation to Grasshopper

**Windows (Rhino 7):**

```bash
copy "Plugin\bin\Release\net48\Selva.gha" "%APPDATA%\Grasshopper\Libraries\"
```

**Windows (Rhino 8):**

```bash
copy "Plugin\bin\Release\net7.0\Selva.gha" "%APPDATA%\Grasshopper\Libraries-8\"
```

**macOS (Rhino 8):**

```bash
cp Plugin/bin/Release/net7.0/Selva.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

After installation, restart Rhino completely.

### Individual Package Development

#### @selva/core

```bash
# Build library
pnpm --filter @selva/core build

# Type check
pnpm --filter @selva/core run check

# Run tests
pnpm --filter @selva/core test
pnpm --filter @selva/core test:watch
```

#### @selva/svelte-ui

```bash
# Build component library
pnpm --filter @selva/svelte-ui build

# Type check
pnpm --filter @selva/svelte-ui run check

# Run tests
pnpm --filter @selva/svelte-ui test
```

#### @selva/web (builder application)

```bash
# Dev server (http://localhost:5173)
pnpm --filter @selva/web dev

# Build for production
pnpm --filter @selva/web build

# Preview production build
pnpm --filter @selva/web preview

# Type checking
pnpm --filter @selva/web run check
```

### Schema Generation (Single Source of Truth)

The project uses JSON Schema as the single source of truth for type definitions shared between C# and TypeScript.

```bash
# Generate both TypeScript and C# types from JSON Schema
./generate-schemas.sh

# Or manually:
cd packages/schemas
npm run generate:all
```

**Source:** `packages/schemas/ui-schema.json`

**Generated files:**
- TypeScript: `packages/builder/src/lib/types/generated/schema.ts`
- C#: `Plugin/Models/Generated/UISchema.Generated.cs`

**Workflow:**

1. Edit `packages/schemas/ui-schema.json` to modify type definitions
2. Run `./generate-schemas.sh` to regenerate both languages
3. Run `pnpm type-check` to verify TypeScript compilation
4. Run `dotnet build` in Plugin/ to verify C# compilation

**Important:** Never edit the generated files directly - they will be overwritten.

## Architecture Overview

### Hybrid Communication Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Grasshopper Plugin (.gha) - Self-Contained              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  C# Components                                     │  │
│  │  - UIBuilderComponent (orchestration)              │  │
│  │  - SchemaManager (parameter scanning)              │  │
│  │  - ValueApplicator (reflection-based updates)      │  │
│  │  - CommunicationHandler (WebSocket coordination)   │  │
│  │  - PersistenceManager (session files)              │  │
│  │  - ClearContextDataComponent                       │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Communication Layer                               │  │
│  │  - LocalWebServer (HTTP, serves embedded UI)       │  │
│  │  - WebSocketServer (real-time parameter updates)   │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Embedded Web Assets (EmbeddedResource)            │  │
│  │  - index.html, CSS, JS bundles                     │  │
│  │  - Svelte components (precompiled)                 │  │
│  └────────────────────────────────────────────────────┘  │
└──────────┬───────────────────────────┬───────────────────┘
           │                           │
           │ HTTP (UI delivery)        │ WebSocket (real-time, port 8765)
           │ Dynamic port              │ - Schema exchange
           ↓                           │ - Parameter value updates
┌─────────────────────────────────────────────────┐ - Output broadcasts
│  Browser (User's Default)                       │ - Metadata changes
│  - Loads UI via LocalWebServer HTTP endpoint    │
│  - Connects to WebSocket for real-time updates  │
│  - No external dependencies required            │
└─────────────────────────────────────────────────┘

Routes served by embedded web app:
  - / - Session hub/landing page
  - /builder - Schema design interface
  - /preview - Interactive UI (WebSocket-enabled)
  - /app - Rhino Compute demo

Data Storage:
  - Schema: Embedded in .gh file (GH_IWriter/GH_IReader)
  - Values: Embedded in .gh file (persisted with document)
  - No session files or temp storage for parameter data
```

### Data Flow Sequence

**Schema Building:**

1. UIBuilderComponent scans Grasshopper document for `IGH_ContextualParameter` instances
2. SchemaManager creates `AvailableParameters` structure
3. Starts LocalWebServer (HTTP) on dynamic port
4. Starts WebSocketServer on port 8765
5. Opens browser to `http://localhost:{port}/builder?session={sessionId}`
6. Browser loads web UI from embedded assets served by LocalWebServer
7. Web UI connects to WebSocket and receives available parameters
8. User configures UI schema in web app (drag-and-drop)
9. Schema sent via WebSocket to CommunicationHandler
10. Component saves schema to .gh file via `Write(GH_IWriter)` method

**Interactive Mode (Preview):**

1. UIBuilderComponent loads schema from .gh file via `Read(GH_IReader)` method
2. Starts LocalWebServer (HTTP) on dynamic port for UI delivery
3. Starts WebSocketServer on port 8765 for real-time communication
4. Opens browser to `http://localhost:{port}/preview?session={sessionId}`
5. Browser loads web UI from embedded assets
6. Web UI connects to WebSocket (ws://localhost:8765)
7. Component sends schema via WebSocket to browser
8. User modifies values in web UI
9. Values sent via WebSocket to CommunicationHandler
10. ValueApplicator applies values to Grasshopper parameters via reflection: `AssignContextualDataTree()`
11. Grasshopper recomputes automatically
12. CollectAndSendOutputs gathers results and broadcasts via WebSocket
13. Web UI updates display in real-time
14. Values persisted in .gh file on document save

**Development Mode:**

- Use external dev server (`pnpm dev` on port 5173) instead of LocalWebServer
- WebSocket still on port 8765 for all data exchange
- Schema and values still embedded in .gh file

### Temporary File Usage

**Temp Directory:** `%TEMP%\Selva\` (Windows) or `/tmp/Selva/` (macOS/Linux)

**Used ONLY for:**
- File format conversion (RhinoDocumentConverter) - creates temporary subdirectories for geometry processing
- NOT used for session data, schema, or values (all stored in .gh files and transmitted via WebSocket)

## Critical Development Rules

### Parameter Validation

**ONLY these parameter types are allowed:**

- Parameters implementing `IGH_ContextualParameter`
- `ContextPrintComponent` (for outputs)
- `ContextBakeComponent` (for outputs)

**NOT allowed:**

- Standard Grasshopper parameters (Param_Number, Param_String, etc.)
- Custom components without `IGH_ContextualParameter` interface

**Note:** Parameter validation is currently handled inline within the UIBuilderComponent and ClearContextDataComponent.
There is no separate `ParameterValidator.cs` utility file at this time.

### Type Safety Between C# and TypeScript

The codebase uses **JSON Schema as the single source of truth** for type definitions:

- **Source:** `packages/schemas/ui-schema.json`
- **Generated C#:** `Plugin/Models/Generated/UISchema.Generated.cs`
- **Generated TypeScript:** `packages/builder/src/lib/types/generated/schema.ts`

**Workflow for adding new types:**

1. Define the type in `packages/schemas/ui-schema.json`
2. Run `./generate-schemas.sh` to generate both C# and TypeScript
3. Import from the generated files in your code

The generator produces **discriminated unions** for layout items, enabling type-safe pattern matching in both languages.

### Reflection for Parameter Assignment

Values are applied to Grasshopper parameters using reflection:

```csharp
var method = contextParam.GetType().GetMethod("AssignContextualDataTree");
method?.Invoke(contextParam, new object[] { dataTree });
```

This approach allows supporting multiple parameter types without strong coupling.

## Key File Responsibilities

### C# Plugin (Plugin/)

**Features/UIBuilder/Components/GH_UIBuilderComponent.cs**

- **Orchestration only** - delegates to specialized services
- Manages component lifecycle and .gh file persistence
- Coordinates LocalWebServer (HTTP) and WebSocketServer
- Event-driven document synchronization
- Embeds schema data in .gh files for portability

**Features/UIBuilder/Services/Communication/LocalWebServer.cs** (NEW)

- Embedded HTTP server using `HttpListener`
- Serves web UI from assembly's embedded resources
- Dynamic port allocation (defaults to port 0 for auto-assignment)
- MIME-type aware response handling (HTML, CSS, JS, JSON, fonts, geometry files)
- Resource prefix: `Selva.EmbeddedAssets.web.`
- Enables self-contained deployment (no external web server needed)

**Features/UIBuilder/Services/Communication/WebSocketServer.cs**

- Real-time parameter value updates
- Fixed port 8765
- Handles bidirectional communication with web UI
- Broadcasts output updates to connected clients

**Features/UIBuilder/Services/Communication/CommunicationHandler.cs**

- Coordinates LocalWebServer and WebSocketServer lifecycles
- Routes messages between web UI and Grasshopper components
- Manages connection state and reconnection logic

**Components/Params/GH_Contextual_Value_List.cs**

- Custom parameter type implementing `IGH_ContextualParameter`
- Stores values from web UI
- Supports data tree structures

**Features/Display/ThreeDisplay.cs & ThreeDisplayGoo.cs**

- Converts geometry to Three.js-compatible format
- Handles compression and serialization for web transmission
- Manages material properties for web rendering

**Features/FileIO/Services/** - File and data handling

- `GH_DataToFile.cs` - Export geometry to various file formats
- `GH_Base64Parser.cs` - Handle Base64 encoding
- `RhinoDocumentConverter.cs` - Convert geometry between formats (recent fix: exception handling in Dispose)

**EmbeddedAssets/web/** - Web UI assets

- Contains built web application (index.html, CSS, JS bundles)
- Populated by `pnpm build:plugin` during production build
- Embedded as `EmbeddedResource` in Selva.csproj
- Served by LocalWebServer at runtime

### TypeScript Packages

#### packages/core

- **Purpose**: Type-safe Rhino Compute client library
- **Key files**: `src/core/`, `src/features/grasshopper/`
- **Responsibilities**: Grasshopper automation, Rhino Compute integration, data structures
- **No UI dependencies** - pure logic and types
- **Testing**: Test core integration workflows

#### packages/svelte-ui

- **Purpose**: Reusable Svelte UI components
- **Key directories**:
  - `src/lib/components/ui/` - Input/output controls
  - `src/lib/components/` - Layout and editor components
- **Responsibilities**: Rendering UI controls, parameter visualization
- **Dependencies**: Core package only
- **Testing**: Component behavior and rendering

#### packages/builder (package name: @selva/web)

**Build Configuration:**

- `svelte.config.js` - Uses `@sveltejs/adapter-static` for static site generation
- `vite.config.ts` - Vite build configuration
- Output directory: `build/` (copied to `Plugin/EmbeddedAssets/web/` during production build)
- SPA mode with fallback to `index.html` for client-side routing

**src/routes/** - SvelteKit page routes

- `/` (`+page.svelte`) - Session hub/landing page
- `/builder` - Schema design interface (drag-and-drop UI builder)
- `/preview` - Interactive UI preview (WebSocket-enabled)
- `/app` - Rhino Compute demo (separate app with server-side rendering)
- `api/schema/[sessionId]/+server.ts` - Schema persistence
- `api/values/[sessionId]/+server.ts` - Runtime values
- `api/state/[sessionId]/+server.ts` - Session state
- `api/available/[sessionId]/+server.ts` - Available parameters from Grasshopper

**src/lib/api/** - Client integration

- `client.ts` - REST API client for schema, values, state
- `websocket.ts` - WebSocket client for real-time updates with auto-reconnect

**src/lib/components/** - UI building blocks

- Drag-and-drop parameter management
- Layout editors (Tab, Grid)
- Parameter preview controls

### Data Models

**Plugin/Models/UISchema.cs** (shared via JSON Schema)

Type definitions available in both C# and TypeScript:

- `UISchema` - Complete UI definition
- `InputParameter` / `OutputParameter` - With Compute-compatible metadata
- `InputConfig` / `OutputConfig` - Type-specific configurations
- `RuntimeValues` - Current parameter values
- `SessionState` - Session metadata
- `AvailableParameter` - Discovered Grasshopper parameters

**Generated TypeScript**: `packages/builder/src/lib/types/generated/schema.ts`

## Communication Protocols

The system uses a **dual-layer communication model**:

### 1. HTTP (UI Delivery) - LocalWebServer

**Purpose:** Serve web UI from embedded assets

- **Implementation:** `LocalWebServer.cs` using `HttpListener`
- **Port:** Dynamic (auto-assigned, typically 0 for OS selection)
- **Resources:** Embedded in .gha as `Selva.EmbeddedAssets.web.*`
- **MIME Types Supported:**
  - `.html` → `text/html`
  - `.css` → `text/css`
  - `.js` → `application/javascript`
  - `.json` → `application/json`
  - `.woff2`, `.woff`, `.ttf` → font types
  - `.obj`, `.gltf`, `.glb`, `.stl` → geometry formats
- **Lifecycle:** Started by UIBuilderComponent, stopped on component disposal
- **Benefits:**
  - Self-contained deployment (no external web server)
  - Single .gha file contains everything
  - No network dependencies

### 2. WebSocket (All Data Exchange)

**Purpose:** Real-time bidirectional communication for ALL application data

- **Port:** 8765 (fixed)
- **Protocol:** ws://localhost:8765
- **Implementation:** `WebSocketServer.cs` coordinated by `CommunicationHandler.cs`
- **Connection:** Manages client connections with auto-reconnect (exponential backoff)

**Message Types:**
- **From Web UI → Grasshopper:**
  - `valueUpdate` - User changes parameter values
  - `saveSchema` - Save configured schema
  - `getCurrentValues` - Request current parameter values

- **From Grasshopper → Web UI:**
  - `outputUpdate` - Computation results and geometry
  - `metadataChange` - Parameter additions/removals
  - `solvingState` - Grasshopper computation status
  - `schemaUpdate` - Current schema definition
  - `availableParameters` - Discovered contextual parameters

**Benefits:**
- Real-time updates (no polling delay)
- Bidirectional communication
- Single connection for all data
- No file system I/O for data exchange
- Better user experience

### 3. Persistence (.gh File Storage)

**Purpose:** Long-term storage embedded in Grasshopper document

- **Schema:** Saved in .gh file via `Write(GH_IWriter)` method
- **Values:** Persisted parameter values saved with document
- **Migration:** Automatic schema version migration on `Read(GH_IReader)`
- **Serialization:** JSON format with custom `SchemaSerializationSettings`

**Benefits:**
- Schema travels with .gh file (portable)
- No external files to manage
- Version control friendly (text-based JSON in .gh)
- Automatic migration across schema versions

## Supported Input/Output Types

### UI Input Types (for web interface)

- `number` - Numeric input
- `slider` - Range slider
- `dropdown` - Select dropdown
- `text` - Text input
- `checkbox` - Boolean toggle
- `color` - Color picker

### UI Output Types (for web interface)

- `text` - Text display
- `number` - Numeric display
- `3d-viewer` - Three.js geometry viewer (implemented)
- `chart` - Data visualization (planned)

### Grasshopper Parameter Types (Compute-compatible)

The system now supports full Compute-style parameter types for better compatibility:

**Primitive Types:**

- `Number` - Double precision numbers
- `Integer` - Whole numbers
- `Boolean` - True/false values
- `Text` - String values

**Geometry Types:**

- `Point` - 3D points
- `Vector` - 3D vectors
- `Plane` - Construction planes
- `Line` - Linear segments
- `Circle` - Circular curves
- `Rectangle` - Rectangular boundaries
- `Box` - 3D boxes
- `Curve` - NURBS curves, polylines
- `Surface` - NURBS surfaces
- `Brep` - Boundary representations
- `Mesh` - Polygon meshes
- `SubD` - Subdivision surfaces
- `Geometry` - Generic geometry type

**Other:**

- `Generic` - Fallback for unrecognized types

## Testing Workflow

### Automated Testing

```bash
# Run all tests across all packages
pnpm test

# Run tests in watch mode (useful during development)
pnpm test:watch

# Run tests for a specific package
pnpm --filter @selva/core test
pnpm --filter @selva/svelte-ui test
pnpm --filter @selva/web test
```

### Manual Integration Testing

#### Option 1: Production Build Testing (Recommended)

1. **Build production plugin with embedded assets:**

   ```bash
   pnpm build:plugin
   ```

2. **Install to Grasshopper** (copy `.gha` file from appropriate bin directory)

   - Rhino 7: `Plugin/bin/Release/net48/Selva.gha` → `%APPDATA%\Grasshopper\Libraries\` (Windows)
   - Rhino 8: `Plugin/bin/Release/net7.0/Selva.gha` → `%APPDATA%\Grasshopper\Libraries-8\` (Windows)
   - Rhino 8: `Plugin/bin/Release/net7.0/Selva.gha` → `~/Library/Application Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/` (macOS)

3. **Restart Rhino completely**

4. **In Grasshopper:**
   - Add contextual parameter (e.g., Number Slider implementing `IGH_ContextualParameter`)
   - Add UIBuilderComponent
   - Set Enable = true
   - Browser opens automatically to `http://localhost:{dynamic_port}/builder?session={sessionId}`
   - Web UI is served from embedded assets (no external server needed)

5. **Verify communication:**
   - Check that LocalWebServer started (check component messages for port number)
   - Verify WebSocket connection in browser console (F12)
   - Check Grasshopper component messages
   - Verify schema is saved in .gh file (save and reopen document)

#### Option 2: Development Mode Testing

1. **Build C# plugin only:**

   ```bash
   cd Plugin && dotnet build --configuration Release
   ```

2. **Install to Grasshopper** (same as above)

3. **Restart Rhino completely**

4. **Start web dev server separately:**

   ```bash
   pnpm dev
   ```

   (This starts the builder at http://localhost:5173)

5. **In Grasshopper:**
   - Add contextual parameter
   - Add UIBuilderComponent
   - Set Enable = true
   - Manually navigate to `http://localhost:5173/builder?session={sessionId}`
   - Or configure component to use dev server URL

6. **Verify communication:**
   - WebSocket connection on port 8765
   - Browser console shows no errors
   - Schema/values persist when document is saved and reopened

### Schema Generation Testing

When making changes to parameter types:

```bash
# Generate TypeScript and C# from JSON Schema
./generate-schemas.sh

# Verify TypeScript compilation
pnpm type-check

# Verify C# compilation
cd Plugin && dotnet build
```

## Common Development Scenarios

### Adding New Input Type

1. Update `InputParameter.Type` enum in `packages/schemas/ui-schema.json`
2. Run `./generate-schemas.sh` to generate C# and TypeScript types
3. Implement value serialization in `UIBuilderComponent` or relevant service
4. Create UI component in Svelte (`packages/builder/src/routes/preview`)
5. Update builder UI to allow configuration (`packages/builder/src/routes/builder`)

### Adding New Output Type

1. Update `OutputParameter.Type` enum in `packages/schemas/ui-schema.json`
2. Run `./generate-schemas.sh` to generate C# and TypeScript types
3. Implement output serialization in relevant service (if needed)
4. Create display component in Svelte (`packages/builder/src/routes/preview`)
5. Update builder UI configuration

### Debugging Session Issues

1. **WebSocket Connection:**
   - Open browser console (F12) and check for WebSocket errors
   - Verify connection to `ws://localhost:8765`
   - Check for reconnection attempts (exponential backoff)

2. **Schema Persistence:**
   - Save and reopen .gh file to verify schema/values are embedded
   - Check component messages for serialization errors
   - Look for schema migration warnings

3. **Component Messages:**
   - Enable verbose logging in Grasshopper component
   - Check for parameter validation errors
   - Verify LocalWebServer port assignment

4. **Temp Directory (File Conversion Only):**
   - Windows: `%TEMP%\Selva\`
   - macOS: `/tmp/Selva/`
   - Only used for RhinoDocumentConverter, NOT for session data

## Platform-Specific Considerations

### Windows

- Uses `%TEMP%` for session storage
- Rhino 7 requires net48 build
- Rhino 8 supports both net48 and net7.0

### macOS

- Uses `/tmp/` for session storage
- Rhino 8 only (net7.0)
- File paths require escaping spaces in shell commands

### Cross-Platform

- All file paths use `Path.Combine()` for compatibility
- WebSocket server uses `HttpListener` (no platform-specific dependencies)
- JSON serialization handles path separators automatically

## Deployment Model

### Production Deployment (Self-Contained)

The production build creates a **fully self-contained** .gha file:

```
Selva.gha (single file)
├─ C# assemblies (.NET Framework 4.8 or .NET 7.0)
├─ Embedded web assets (HTML, CSS, JS)
└─ Required dependencies
```

**Key characteristics:**

- **No external dependencies** - Web UI is embedded in the .gha file
- **LocalWebServer** serves UI from embedded resources at runtime
- **Single file distribution** - Just copy .gha to Grasshopper Libraries folder
- **Dynamic port allocation** - HTTP server auto-selects available port
- **WebSocket on fixed port** - Port 8765 for real-time updates

**Build process:**

```bash
pnpm build:plugin
```

This command:
1. Builds `@selva/web` package as static assets (SvelteKit adapter-static)
2. Copies `packages/builder/build/` → `Plugin/EmbeddedAssets/web/`
3. Builds C# plugin with assets embedded as `EmbeddedResource`
4. Outputs `Selva.gha` for both Rhino 7 (net48) and Rhino 8 (net7.0)

**Embedded resource configuration** (Selva.csproj):

```xml
<ItemGroup>
  <EmbeddedResource Include="EmbeddedAssets\web\**\*.*">
    <LogicalName>Selva.EmbeddedAssets.web.%(RecursiveDir)%(FileName)%(Extension)</LogicalName>
  </EmbeddedResource>
</ItemGroup>
```

**Distribution:**

1. Build production .gha: `pnpm build:plugin`
2. Distribute single .gha file (from `Plugin/bin/Release/net48/` or `Plugin/bin/Release/net7.0/`)
3. Users copy to Grasshopper Libraries folder
4. Restart Rhino - plugin is ready to use

**No user setup required:**
- ❌ No web server installation
- ❌ No Node.js or npm required
- ❌ No separate web app deployment
- ✅ Just install .gha and restart Rhino

### Development Workflow

For active development, use external dev server for hot module replacement:

```bash
# Terminal 1: Start web dev server with HMR
pnpm dev

# Terminal 2: Build and install C# plugin
cd Plugin && dotnet build --configuration Release
# Copy .gha to Grasshopper Libraries
# Restart Rhino
```

In development mode:
- Web UI runs on http://localhost:5173 (Vite dev server)
- WebSocket still on port 8765
- Hot module replacement for fast iteration
- Session files for data exchange

## Performance Considerations

### Backend (C# Plugin)

- **LocalWebServer startup:** Dynamic port allocation minimizes port conflicts
- **Embedded resource access:** Direct memory reads (no disk I/O after assembly load)
- **Session cleanup:** Runs on component initialization (24-hour threshold)
- **Parameter expiration:** Batch expiration to minimize Grasshopper recomputes
- **Value change detection:** Compares with `_lastAppliedValues` to prevent redundant updates
- **WebSocket lifecycle:** Started/stopped with component enable state

### Frontend (Web Application)

**Code Splitting & Lazy Loading:**

- Three.js (~580KB) is lazy-loaded only when 3D viewer is enabled
- `rhino-compute-core` is dynamically imported when needed
- SvelteKit automatically code-splits routes for optimal loading

**Bundle Optimization:**

- Standardized on `@lucide/svelte` for all icons (removed duplicate `@iconify/svelte`)
- Consolidated utility constants into single `constants.ts` file
- Removed unused icon components and deprecated code

**Icon Library:**

- **Primary**: `@lucide/svelte` - Used for all UI icons (lightweight, tree-shakeable)
- Component mapping:
  - Input parameters: `ArrowDownToLine`
  - Output parameters: `ArrowUpFromLine`
  - Drop zones: `MousePointerClick`
  - Delete actions: `Trash2`
  - Edit actions: `Pencil`

**Best Practices:**

- Prefer direct Lucide imports over custom icon wrapper components
- Use lazy loading for heavy dependencies (3D libraries, compute packages)
- Keep utility files consolidated to reduce import overhead

## Rhino Compute Compatibility

The schema system is designed to be compatible with Rhino Compute workflows:

**Compute-Compatible Features:**

- Parameter metadata matches Rhino Compute's structure (`paramType`, `atLeast`, `atMost`, `treeAccess`)
- Supports all standard Grasshopper geometry types (Point, Curve, Brep, Mesh, etc.)
- Maintains parameter constraints and access patterns
- Can be easily adapted to generate Compute-compatible API calls

**UI Builder Extensions:**

- `groupName` - Manual grouping for better UI organization (set in Svelte builder, not auto-detected)
- `displayName` - User-friendly labels
- `order` - Custom ordering within groups
- Additional help text via `tooltip` and `description`

This dual approach allows:

1. **Direct Compute integration** - Use the same parameter definitions for remote solving
2. **Enhanced UI building** - Add UI-specific metadata without breaking Compute compatibility

## Implemented Features

- ✅ **Self-contained deployment** - Embedded web server with static assets in .gha file
- ✅ **LocalWebServer** - HTTP server for UI delivery from embedded resources
- ✅ **WebSocket real-time updates** - Bidirectional parameter synchronization
- ✅ **Three.js 3D viewer** - Geometry visualization with compression
- ✅ **Drag-and-drop layout editor** - Visual UI builder with group management
- ✅ **Tabbed layout system** - Collapsible groups for organized UIs
- ✅ **Rhino Compute integration support** - `rhino-compute-core` package
- ✅ **Embedded schema persistence** - Schemas saved with .gh files
- ✅ **Production build automation** - `pnpm build:plugin` orchestrates full build
- ✅ **Cross-platform support** - Windows (Rhino 7/8) and macOS (Rhino 8)

## Future Extension Points

- Chart components (Chart.js for data visualization)
- Schema versioning and import/export
- Full Rhino Compute deployment workflows
- Authentication and multi-user support
- Real-time collaboration via WebSocket broadcasting
- Auto-generation of Compute API endpoints from schemas
