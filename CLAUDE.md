# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ComputeBuilder is a cross-platform Rhino Grasshopper plugin that enables web-based UIs for parametric models using a dual-stack architecture:

- **Backend**: C# Grasshopper components (.NET multi-target: net48/net7.0)
- **Frontend**: SvelteKit web application (TypeScript, Tailwind CSS)
- **Communication**: File-based session storage + WebSocket (port 8765)

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

### Three-Layer Communication Model

```
┌────────────────────────────────────────┐
│  Grasshopper Plugin (C#)               │
│  - UIBuilderComponent                  │
│  - ClearContextDataComponent           │
└──────────┬─────────────────────────────┘
           │ Reads/writes JSON files
           ↓
┌────────────────────────────────────────┐
│  Session Storage (Temp Directory)      │
│  - {sessionId}_schema.json             │
│  - {sessionId}_values.json             │
│  - {sessionId}_state.json              │
│  - {sessionId}_available.json          │
└──────────┬─────────────────────────────┘
           │ REST API + WebSocket
           ↓
┌────────────────────────────────────────┐
│  SvelteKit Web App                     │
│  - /builder - Schema design            │
│  - /preview - Interactive UI           │
│  - /api/* - Server routes              │
└────────────────────────────────────────┘
```

### Data Flow Sequence

**Schema Building:**
1. UIBuilderComponent scans Grasshopper document for `IGH_ContextualParameter` instances
2. Writes available parameters to `{sessionId}_available.json`
3. Opens browser to `/builder?session={sessionId}`
4. User configures UI schema in web app
5. Schema saved to `{sessionId}_schema.json`

**Interactive Mode:**
1. UIBuilderComponent loads schema
2. Opens browser to `/preview?session={sessionId}`
3. User modifies values in web UI
4. Values written to `{sessionId}_values.json`
5. Component reads values file (polling or WebSocket)
6. Applies values to Grasshopper parameters via reflection: `AssignContextualDataTree()`
7. Grasshopper recomputes automatically
8. Outputs written back to values file
9. Web UI updates display

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

This is enforced by `ParameterValidator.cs` and must be maintained in all validation logic.

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

**Components/UIBuilderComponent.cs** (546 lines)
- Unified component for both builder and interactive modes
- Manages session lifecycle
- Scans available parameters on enable/refresh
- Starts WebSocket server (port 8765)
- Applies values from web UI to Grasshopper parameters
- Handles file polling fallback

**Components/ClearContextDataComponent.cs** (152 lines)
- Utility to clear contextual parameter data
- Resets parameters to initial state

### Core Utilities

**Utils/SessionManager.cs** (142 lines)
- Session ID generation (8-character GUIDs)
- JSON file read/write operations
- Session cleanup for old files
- Path resolution for cross-platform compatibility

**Utils/ParameterValidator.cs** (56 lines)
- Validates parameters before use
- Enforces IGH_ContextualParameter requirement
- Returns descriptive error messages

**Utils/WebSocketServer.cs** (294 lines)
- Async HttpListener-based WebSocket server
- Thread-safe client management
- Broadcast messaging
- Graceful shutdown handling

### Data Models

**Models/UISchema.cs** (~300 lines)
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

**web/src/routes/builder/+page.svelte** - Schema builder UI

**web/src/routes/preview/+page.svelte** - Interactive preview UI

**web/src/lib/api/client.ts** - REST API client

**web/src/lib/api/websocket.ts** - WebSocket client

## Communication Protocols

### WebSocket (Primary)

- Port: 8765
- Message types:
  - `ValueUpdateMessage` - Input value changes from web UI
  - `OutputUpdateMessage` - Output data from Grasshopper
- Fallback: File-based polling if WebSocket unavailable

### File Polling (Fallback)

- Interval: 500ms
- Checks file modification timestamps
- Prevents duplicate reads with timestamp tracking

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
- `3d-viewer` - Three.js geometry viewer (planned)
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

## Future Extension Points

- 3D viewer integration (Three.js for geometry visualization)
- Chart components (Chart.js for data visualization)
- Drag-and-drop layout editor with group management
- Schema versioning and import/export
- Direct Rhino Compute integration for remote solving
- Authentication and multi-user support
- Real-time collaboration via WebSocket broadcasting
- Auto-generation of Compute API endpoints from schemas
