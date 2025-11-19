# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComputeBuilder is a cross-platform Rhino Grasshopper plugin that enables web-based UIs for parametric models using a
dual-stack architecture:

- **Backend**: C# Grasshopper components (.NET multi-target: net48/net7.0)
- **Frontend**: SvelteKit web application (TypeScript, Tailwind CSS)
- **Communication**: WebSocket (port 8765) for real-time updates + session files for persistence

## Essential Commands

### C# Plugin Development

```bash
# Build for both Rhino 7 (net48) and Rhino 8 (net7.0)
dotnet build --configuration Release

# Development build
dotnet build

# Clean build artifacts
dotnet clean
```

**Output locations:**

- Rhino 7: `bin/Release/net48/ComputeBuilder.gha`
- Rhino 8: `bin/Release/net7.0/ComputeBuilder.gha`

### Installation to Grasshopper

**Windows (Rhino 7):**

```bash
copy "bin\Release\net48\ComputeBuilder.gha" "%APPDATA%\Grasshopper\Libraries\"
```

**Windows (Rhino 8):**

```bash
copy "bin\Release\net7.0\ComputeBuilder.gha" "%APPDATA%\Grasshopper\Libraries-8\"
```

**macOS (Rhino 8):**

```bash
cp bin/Release/net7.0/ComputeBuilder.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

After installation, restart Rhino completely.

### Web Application Development

```bash
cd web

# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type checking
npm run check

# Watch mode type checking
npm run check:watch
```

### Quick Development Setup

**Windows PowerShell:**

```powershell
.\start-dev.ps1
```

**macOS/Linux:**

```bash
./start-dev.sh
```

These scripts build the plugin, install it, and start the dev server.

## Architecture Overview

### WebSocket-First Communication Architecture

```
┌─────────────────────────────────────────────────┐
│  Grasshopper Plugin (C#)                        │
│  - UIBuilderComponent (orchestration)           │
│  - SchemaManager (parameter scanning)           │
│  - ValueApplicator (reflection-based updates)   │
│  - CommunicationHandler (WebSocket)             │
│  - PersistenceManager (session files)           │
│  - ClearContextDataComponent                    │
└──────────┬──────────────────────────────────────┘
           │
           │ WebSocket (real-time, port 8765)
           │ ─────────────────────────────►
           │ Session files (persistence only)
           ↓
┌─────────────────────────────────────────────────┐
│  Session Storage (Temp Directory)               │
│  - {sessionId}_schema.json (embedded in .gh)    │
│  - {sessionId}_values.json                      │
│  - {sessionId}_state.json                       │
│  - {sessionId}_available.json                   │
└──────────┬──────────────────────────────────────┘
           │ REST API (initial load only)
           │ WebSocket (real-time updates)
           ↓
┌─────────────────────────────────────────────────┐
│  SvelteKit Web App                              │
│  - /builder - Schema design                     │
│  - /preview - Interactive UI (WebSocket)        │
│  - /app - Rhino Compute demo                    │
│  - /api/* - Server routes (GET only)            │
└─────────────────────────────────────────────────┘
```

### Data Flow Sequence

**Schema Building:**

1. UIBuilderComponent scans Grasshopper document for `IGH_ContextualParameter` instances
2. Writes available parameters to `{sessionId}_available.json`
3. Opens browser to `/builder?session={sessionId}`
4. User configures UI schema in web app
5. Schema saved to `{sessionId}_schema.json`

**Interactive Mode (WebSocket-only):**

1. UIBuilderComponent loads schema and starts WebSocket server
2. Opens browser to `/preview?session={sessionId}`
3. Web UI connects via WebSocket
4. User modifies values in web UI
5. Values sent via WebSocket to CommunicationHandler
6. ValueApplicator applies values to Grasshopper parameters via reflection: `AssignContextualDataTree()`
7. Grasshopper recomputes automatically
8. CollectAndSendOutputs gathers results and broadcasts via WebSocket
9. Web UI updates display in real-time

### Session File Locations

**Windows:** `%TEMP%\ComputeBuilder\`
**macOS/Linux:** `/tmp/ComputeBuilder/`

Sessions auto-cleanup after 24 hours of inactivity.

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

The codebase maintains strict type alignment between:

- C# models in `Models/UISchema.cs`
- TypeScript types in `web/src/lib/types/schema.ts`

When adding new data structures, update BOTH files to maintain synchronization.

### Reflection for Parameter Assignment

Values are applied to Grasshopper parameters using reflection:

```csharp
var method = contextParam.GetType().GetMethod("AssignContextualDataTree");
method?.Invoke(contextParam, new object[] { dataTree });
```

This approach allows supporting multiple parameter types without strong coupling.

## Key File Responsibilities

### C# Components

**Components/UIBuilderComponent.cs** (~587 lines - REFACTORED)

- **Orchestration only** - delegates to specialized utilities
- Manages component lifecycle and .gh file persistence
- Coordinates between SchemaManager, ValueApplicator, CommunicationHandler, and PersistenceManager
- Event-driven document synchronization
- **WebSocket-only** - no file polling

**Components/ClearContextDataComponent.cs** (152 lines)

- Utility to clear contextual parameter data
- Resets parameters to initial state

### Core Utilities (NEW - Extracted from UIBuilderComponent)

**Utils/SchemaManager.cs** (~180 lines)

- Parameter scanning from Grasshopper documents
- Discovers `IGH_ContextualParameter` instances and output components
- Validates for duplicate parameter names
- Type mapping (dictionary-based for performance)

**Utils/ValueApplicator.cs** (~150 lines)

- Applies values from web UI to Grasshopper parameters
- Generic type-based value conversion (no duplicate methods)
- Reflection-based parameter assignment
- Tracks last applied values to prevent redundant updates

**Utils/CommunicationHandler.cs** (~140 lines)

- WebSocket server lifecycle management
- Real-time bidirectional communication
- Event-based message handling
- Output broadcasting to web clients

**Utils/PersistenceManager.cs** (~90 lines)

- Session file read/write operations
- Schema, values, state, and available parameters persistence
- Simplified interface for UIBuilderComponent

**Utils/SessionManager.cs** (92 lines)

- Session ID generation (8-character GUIDs)
- File path helpers
- JSON serialization wrappers
- Session cleanup for old files
- Path resolution for cross-platform compatibility

**Utils/WebSocketServer.cs** (285 lines)

- Async HttpListener-based WebSocket server
- Thread-safe client management
- Broadcast messaging
- Graceful shutdown handling

### Data Models

**Models/UISchema.cs** (386 lines)
All data structures shared between C# and web UI:

- `UISchema` - Complete UI definition
- `InputParameter` / `OutputParameter` - Parameter definitions with Compute-compatible metadata
- `InputConfig` / `OutputConfig` - Type-specific configurations
- `RuntimeValues` - Current parameter values
- `SessionState` - Session metadata
- `AvailableParameter` - Discovered Grasshopper parameters

**Compute-Style Metadata:**
Each parameter now includes Rhino Compute-compatible metadata:

- `paramType` - Grasshopper parameter type (Number, Point, Geometry, etc.)
- `atLeast` / `atMost` - Data access constraints
- `treeAccess` - Whether parameter accepts tree structures
- `minimum` / `maximum` - Value constraints (for numeric types)

**UI Builder Metadata:**
Additional metadata for enhanced UI building:

- `groupName` - Logical grouping (set manually in UI builder)
- `displayName` - Alternative display name
- `order` - Display order within groups
- `tooltip` / `description` - Help text
- `nickname` - Short identifier

### SvelteKit Application

**web/src/routes/api/** - Server-side API routes

- `schema/[sessionId]/+server.ts` - GET/POST schema
- `values/[sessionId]/+server.ts` - GET/POST values
- `state/[sessionId]/+server.ts` - GET state
- `available/[sessionId]/+server.ts` - GET available parameters

**web/src/routes/builder/+page.svelte** - Schema builder UI with drag-and-drop layout editor

**web/src/routes/preview/+page.svelte** - Interactive preview UI for session-based workflows

**web/src/routes/app/+page.svelte** - Rhino Compute integration demo (standalone mode)

**web/src/lib/api/client.ts** - REST API client

**web/src/lib/api/websocket.ts** - WebSocket client

**web/src/lib/components/ui/** - Reusable UI components:

- `InputControl.svelte` - Input parameter controls
- `OutputDisplay.svelte` - Output parameter displays
- `TabLayout.svelte` - Tabbed layout system
- `LegacyLayout.svelte` - Grid-based layout (fallback)

**web/src/lib/components/** - Drag-and-drop components:

- `DragDropContext.svelte` - Drag-and-drop state management
- `DraggableParameter.svelte` - Draggable parameter items
- `DropZone.svelte` - Drop target zones

## Communication Protocols

### WebSocket (Real-time Communication)

**ONLY communication method** - file polling has been removed for simplicity.

- **Port:** 8765
- **Protocol:** ws://localhost:8765
- **Connection:** CommunicationHandler manages lifecycle
- **Message Types:**
    - `ValueUpdateMessage` - Input value changes from web UI → Grasshopper
    - `OutputUpdateMessage` - Output data from Grasshopper → web UI
- **Reconnection:** Web client auto-reconnects with exponential backoff
- **Benefits:**
    - Real-time updates (no 500ms delay)
    - Bidirectional communication
    - Lower I/O overhead
    - Better user experience

### Session Files (Persistence Only)

Session files are used for:

- Initial page load (GET requests via REST API)
- Schema persistence (embedded in .gh files)
- Cross-session data sharing

**NOT used for:**

- ~~Real-time value updates~~ (WebSocket only)
- ~~Polling~~ (removed)

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

1. **Build C# plugin:**
   ```bash
   dotnet build --configuration Release
   ```

2. **Install to Grasshopper** (copy `.gha` file)

3. **Restart Rhino completely**

4. **Start web server:**
   ```bash
   cd web && npm run dev
   ```

5. **In Grasshopper:**
    - Add contextual parameter (e.g., Number Slider from IGH_ContextualParameter)
    - Add UIBuilderComponent
    - Set Enable = true
    - Browser opens automatically

6. **Verify communication:**
    - Check browser console (F12)
    - Check Grasshopper component messages
    - Inspect session files in temp directory

## Common Development Scenarios

### Adding New Input Type

1. Update `InputParameter.Type` enum in `Models/UISchema.cs`
2. Add corresponding TypeScript type in `web/src/lib/types/schema.ts`
3. Implement value serialization in `UIBuilderComponent.ApplyToContextualParameter()`
4. Create UI component in Svelte (preview route)
5. Update builder UI to allow configuration

### Adding New Output Type

1. Update `OutputParameter.Type` enum in `Models/UISchema.cs`
2. Add TypeScript type in `web/src/lib/types/schema.ts`
3. Implement output serialization in `GrasshopperDefinition.cs` (if needed)
4. Create display component in Svelte (preview route)
5. Update builder UI configuration

### Debugging Session Issues

1. Check session files in temp directory:
    - Windows: `%TEMP%\ComputeBuilder\`
    - macOS: `/tmp/ComputeBuilder/`

2. Verify file timestamps match component activity

3. Check browser network tab for API errors

4. Enable verbose logging in Grasshopper component messages

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

## Performance Considerations

- **Polling interval:** 500ms balances responsiveness and CPU usage
- **Session cleanup:** Runs on component initialization (24-hour threshold)
- **Parameter expiration:** Batch expiration to minimize Grasshopper recomputes
- **Value change detection:** Compares with `_lastAppliedValues` to prevent redundant updates

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

- ✅ Three.js 3D viewer for geometry visualization
- ✅ Drag-and-drop layout editor with group management
- ✅ Tabbed layout system with collapsible groups
- ✅ Rhino Compute integration support (`rhino-compute-core` package)
- ✅ Embedded schema persistence (schemas saved with .gh files)

## Future Extension Points

- Chart components (Chart.js for data visualization)
- Schema versioning and import/export
- Full Rhino Compute deployment workflows
- Authentication and multi-user support
- Real-time collaboration via WebSocket broadcasting
- Auto-generation of Compute API endpoints from schemas
