# @selvajs/plugin-ui

UI for the Selva Grasshopper plugin — schema designer + preview. Embedded into `Selva.gha` and served from the plugin's local HTTP port at runtime; the dev server here is what the plugin connects to when iterating on the UI alongside Rhino. Not a standalone/deployable app.

## Routes

- `/builder` — drag-and-drop schema designer connected to Grasshopper via WebSocket
- `/preview` — live UI preview with real-time parameter control
- `/` — session management

## How it works

The plugin (`Selva.gha`) starts a WebSocket server on port 8765. The dev server connects to it, discovers Grasshopper parameters automatically, and persists the schema back into the `.gh` file. `/preview` re-renders on every parameter change.

## Development

```bash
pnpm install
pnpm run dev    # http://localhost:5173
```

No env vars required.

## Production

This package is built and embedded into `Selva.gha` by `pnpm build:plugin` — the plugin serves the assets from a local HTTP port at runtime. There is no standalone deployment.

For the deployable app, see [@selvajs/selva](../selva/).

## Related

- [@selvajs/ui](../ui/) — shared Svelte components and theme
- [@selvajs/schemas](../schemas/) — schema generators
- [Selva.gha plugin](../../Plugin/) — Grasshopper bridge
