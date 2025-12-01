# Quick Start Guide

## Requirements

- [pnpm](https://pnpm.io) (Node.js package manager)
- .NET SDK 7.0+ (for plugin development)
- Rhino 7 or 8 (for using the plugin)

## Initial Setup

```bash
pnpm install
```

**Add .env to `packages/frontend`** (required for build):

```bash
echo "VITE_API_BASE=http://localhost:8765" > packages/frontend/.env
```

**Build all packages:**

```bash
pnpm run build:all
```

## Development Workflow

### Option 1: Web + Plugin in Dev Mode (Recommended for Development)

**Terminal 1: Start web dev server**

```bash
cd packages/builder
pnpm start
# Web app runs on http://localhost:5173
```

**Terminal 2: Build and run plugin in IDE**

```bash
cd Plugin
dotnet build
# Then run in Visual Studio Code, Rider, or Visual Studio
# The plugin will automatically connect to the dev server via WebSocket (port 8765)
```

Benefits:
- Hot reload on web changes (Vite dev server)
- Debug plugin in IDE
- Fast iteration

### Option 2: Standalone Self-Contained Plugin Build

For production deployment:

```bash
pnpm run build:plugin
```

This creates a self-contained `.gha` file with embedded web assets. Follow the instructions in the console for installing to Grasshopper.

## Installation to Grasshopper

After building, copy the plugin to your Grasshopper Libraries folder:

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

Restart Rhino completely after installation.

## Using Selva Components in Grasshopper

Once the plugin is installed, you can use:

- **UIBuilderComponent** — Design web UIs for your definitions (connects to `@selva/web`)
- **ThreeMaterial** — Configure materials for 3D web display
- **DataToFile** — Export geometry to various file formats
- **ValueListData** — Create interactive value selections

1. Add components to Grasshopper
2. Connect your parameters to **UIBuilderComponent**
3. Start the web dev server (`pnpm start` in `packages/frontend`)
4. The web UI will auto-discover your parameters via WebSocket
5. Design your UI in the browser
6. Changes trigger Grasshopper computation in real-time

## Troubleshooting

### Build Fails

- Ensure `.env` file exists in `packages/frontend` with `VITE_API_BASE=http://localhost:8765`
- Run `pnpm install` to ensure all dependencies are installed

### Plugin Won't Load

- Verify correct installation path for your Rhino version
- Restart Rhino completely (not just reopen file)
- Check that .NET SDK 7.0+ is installed: `dotnet --version`

### WebSocket Connection Issues

- Ensure port 8765 is not blocked by firewall
- Verify web dev server is running: `pnpm start` in `packages/frontend`
- Check browser console (F12) for connection errors

## Next Steps

- **Building web apps**: See [`@selva/core` README](../packages/core/README.md)
- **Using UI components**: See [`@selva/svelte-ui` README](../packages/svelte-ui/README.md)
- **Full architecture**: See [CLAUDE.md](../CLAUDE.md)
- **Plugin development**: See [Plugin/README.md](../Plugin/README.md)
