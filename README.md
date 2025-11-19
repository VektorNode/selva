# ComputeBuilder

A cross-platform Rhino Grasshopper plugin that enables users to create web-based UIs for their parametric models.

## Architecture

The system consists of three main components:

1. **Grasshopper Plugin (C#/.NET)** - Located in the root directory
    - Schema Builder Component: Opens browser interface for UI design
    - Interactive Component: Enables real-time preview and web deployment
    - Session-based communication via JSON files
    - Parameter validation (only IGH_ContextualParameter, ContextPrintComponent, ContextBakeComponent allowed)

2. **SvelteKit Application** - Located in `/web`
    - `/builder` route: Visual schema builder
    - `/preview` route: Interactive preview
    - API routes for schema/values CRUD
    - File-based session storage

3. **Session Storage** - Temporary JSON files
    - Located in system temp directory under `ComputeBuilder/`
    - Schema files: `{sessionId}_schema.json`
    - Values files: `{sessionId}_values.json`
    - State files: `{sessionId}_state.json`

## Setup Instructions

### 1. Build the Grasshopper Plugin

```bash
# Restore NuGet packages and build
cd c:\Users\felix\coding\ComputeBuilder
dotnet restore
dotnet build --configuration Release
```

The compiled `.gha` file will be in `bin/Release/net48/` (for Rhino 7) or `bin/Release/net7.0/` (for Rhino 8).

### 2. Install the Plugin in Grasshopper

**Windows:**

```bash
# Copy the .gha file to Grasshopper components folder
# For Rhino 7:
copy "bin\Release\net48\ComputeBuilder.gha" "%APPDATA%\Grasshopper\Libraries\"

# For Rhino 8:
copy "bin\Release\net7.0\ComputeBuilder.gha" "%APPDATA%\Grasshopper\Libraries-8\"
```

**macOS:**

```bash
# Copy to Grasshopper libraries
cp bin/Release/net7.0/ComputeBuilder.gha ~/Library/Application\ Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/
```

### 3. Set Up the SvelteKit Application

```bash
# Navigate to web directory
cd web

# Install dependencies (if not already done)
npm install

# Start the development server
npm run dev
```

The SvelteKit app will run on `http://localhost:5173`

## Usage Workflow

### Development in Grasshopper

1. **Create a Schema:**
    - Add the "Schema Builder" component to your canvas
    - Connect parameters you want to expose (must be IGH_ContextualParameter or Context components)
    - Set the "Open Builder" input to `true`
    - Browser opens to `localhost:5173/builder?session={id}`
    - Configure your UI in the browser
    - Click "Save" to update the schema

2. **Enable Interactive Preview:**
    - Add the "Interactive UI" component
    - Connect the "Session ID" from Schema Builder
    - Set "Enable" to `true`
    - Browser opens to `localhost:5173/preview?session={id}`
    - Interact with controls in the browser
    - Values update in Grasshopper in real-time
    - Grasshopper document recomputes automatically

### Parameter Validation

**CRITICAL:** Only these parameter types are allowed:

- Parameters implementing `IGH_ContextualParameter`
- `ContextPrintComponent`
- `ContextBakeComponent`

Connecting invalid parameters will result in errors and prevent schema generation.

## Project Structure

```
ComputeBuilder/
├── Components/
│   ├── SchemaBuilderComponent.cs    # Opens browser builder
│   └── InteractiveComponent.cs      # Enables preview mode
├── Models/
│   └── UISchema.cs                  # Data models
├── Utils/
│   ├── SessionManager.cs            # File-based storage
│   └── ParameterValidator.cs        # Parameter validation
├── web/                             # SvelteKit application
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api/
│   │   │   │   └── client.ts        # API client
│   │   │   └── types/
│   │   │       └── schema.ts        # TypeScript types
│   │   └── routes/
│   │       ├── api/                 # Backend API routes
│   │       │   ├── schema/[sessionId]/+server.ts
│   │       │   ├── values/[sessionId]/+server.ts
│   │       │   └── state/[sessionId]/+server.ts
│   │       ├── builder/             # Schema builder UI
│   │       │   └── +page.svelte
│   │       └── preview/             # Interactive preview UI
│   │           └── +page.svelte
│   ├── package.json
│   └── svelte.config.js
├── ComputeBuilder.csproj
├── ComputeBuilderInfo.cs
└── README.md
```

## Development Notes

### Session Management

Sessions are identified by unique 8-character IDs. Each session maintains three files:

- **Schema file**: Contains UI definition (inputs, outputs, layout)
- **Values file**: Contains current runtime values
- **State file**: Contains session metadata (active, mode, timestamp)

### Real-time Communication

The preview mode uses polling (500ms interval) to check for value updates:

- Web UI sends value changes → Values file
- Grasshopper reads values file → Updates parameters → Recomputes
- Grasshopper writes output → Values file
- Web UI polls values file → Updates display

### Cross-platform Compatibility

- Uses `HttpListener` and file-based communication (no WinForms/CefSharp)
- Works on both Windows and macOS
- Session files in platform-agnostic temp directory

## Next Steps

Now that the base infrastructure is set up, you can:

1. **Test the basic workflow:**
    - Build the plugin
    - Install in Grasshopper
    - Create a simple definition
    - Test builder and preview modes

2. **Extend input/output types:**
    - Add more input controls (range sliders, multi-select, etc.)
    - Add output visualizations (3D viewer with Three.js, charts)

3. **Enhance the builder:**
    - Drag-and-drop layout editor
    - Visual configuration for input/output options
    - Preview mode within builder

4. **Add production deployment:**
    - Rhino Compute integration
    - Deploy SvelteKit app to Vercel/Netlify
    - Environment-specific configuration

## Troubleshooting

**Browser doesn't open automatically:**

- Manually navigate to `http://localhost:5173/builder?session={id}` or `/preview?session={id}`
- Check that the SvelteKit dev server is running

**Schema not found:**

- Ensure Schema Builder component has "Open Builder" set to `true`
- Check temp directory for session files: `%TEMP%\ComputeBuilder\` (Windows) or `/tmp/ComputeBuilder/` (macOS)

**Invalid parameter errors:**

- Only connect parameters implementing IGH_ContextualParameter
- Check parameter type using Grasshopper's component info

**Values not updating:**

- Verify both components are enabled
- Check browser console for API errors
- Ensure session IDs match between components

## License

MIT License - Feel free to modify and extend for your needs.
