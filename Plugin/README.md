# Selva — Grasshopper plugin

Builds web UIs from a Grasshopper definition and bridges it to Rhino.Compute. Ships as one
self-contained `.gha` with the web assets embedded.

Features live under `Selva.GH/Features/`:

- **UIBuilder** — the `UI Builder` component, schema linking, and the WebSocket server
- **Display** — `ThreeMaterial` and the 3D web-visualization config
- **Drawing** — document-model drawing, rendered through `Selva.Drawing`
- **FileIO** — geometry and data export (`GH_DataToFileGeneric`, `GH_BlockToFile`)
- **ComputeIO** — interactive-selection params: value lists, colors, images, files

## Installation

Copy the `.gha` into the Grasshopper Libraries folder, then restart Rhino completely.

- **Rhino 8 (Windows):** `%APPDATA%\Grasshopper\Libraries-8\`
- **Rhino 8 (macOS):** `~/Library/Application Support/McNeel/Rhinoceros/8.0/Plug-ins/Grasshopper/Libraries/`
- **Rhino 9 (Windows):** `%APPDATA%\Grasshopper\Libraries-9\`

Rhino 7 is not supported.

## Usage

1. Add contextual parameters to the definition (e.g. Context Number Slider).
2. Drop the **UI Builder** component from the Selva tab.
3. Set **Enable** to `true` — the browser opens automatically.
4. Design the UI in the builder, then switch to preview.

## Building from source

```bash
pnpm build:plugin
```

Builds the web assets, embeds them, and multi-targets:
`Selva.GH/bin/Release/{net48,net7.0,net9.0}/Selva.gha`. Rhino 8 loads net48 + net7.0; Rhino 9 loads
net9.0.

For a debug loop, `cd Plugin && dotnet build` and run from your IDE alongside `pnpm dev:plugin` — the
plugin opens the dev-server URL and connects back over WebSocket.

## Development

- [STRUCTURE.md](../STRUCTURE.md) — layout, naming, and the OBSOLETE + upgrader procedure for
  changing a released component's params
- [plugin-context.md](../docs/contributing/plugin-context.md) — canvas wiring and schema identity; every rule in it
  fails silently
- [CHANGELOG.md](./CHANGELOG.md) — releases, upgraders, obsolete components
