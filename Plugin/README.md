# Selva - Grasshopper Plugin

A Grasshopper plugin for building web-based UIs and bridging Grasshopper definitions with Rhino Compute.

## Features

- **Web UI Builder** - Drag-and-drop interface for designing parameter controls
- **Real-time Updates** - WebSocket communication for instant parameter changes
- **3D Viewer** - Built-in Three.js geometry visualization
- **Rhino Compute Bridge** - Components for preparing data exchange with Rhino Compute
- **Self-Contained** - Single .gha file with embedded web assets

## Installation

Copy the `.gha` file to your Grasshopper Libraries folder:

- **Rhino 8 (Windows):** `%APPDATA%\Grasshopper\Libraries-8\`
- **Rhino 8 (macOS):** `~/Library/Application Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/`
- **Rhino 9 (Windows):** `%APPDATA%\Grasshopper\Libraries-9\`

Restart Rhino after installation. Rhino 7 is not supported.

## Usage

1. Add contextual parameters to your Grasshopper definition (e.g., Context Number Slider)
2. Add the **UI Builder** component from the Selva tab
3. Set **Enable** to `true` - browser opens automatically
4. Design your UI in the builder, then switch to preview mode

## Building from Source

```bash
# Build complete plugin with embedded web assets
pnpm build:plugin

# Output locations:
# - Rhino 8: Plugin/bin/Release/net7.0/Selva.gha
```

## Requirements

- Rhino 8 or 9 (Windows/macOS) — Rhino 7 is not supported
- Grasshopper

## Development

- [Project structure & conventions](../STRUCTURE.md) — including the obsolete-component naming convention
